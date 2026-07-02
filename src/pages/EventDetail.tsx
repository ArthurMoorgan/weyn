import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, CATS, ticketsLeft, isSoldOut, dayLabel, timeLabel, type Weyn } from "../api";
import { useAsync } from "../hooks";
import { isSaved, toggleSave, useSaved, addTicket, getDeviceId, getAccount } from "../store";
import MiniMap from "../components/MiniMap";

export default function EventDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  useSaved();
  const { data: e, loading, error, reload } = useAsync(() => api.getEvent(id!), [id]);
  const [booked, setBooked] = useState<Weyn | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookErr, setBookErr] = useState("");
  const [tierId, setTierId] = useState<string | null>(null);

  if (loading) return <div className="detail"><div className="spin" /></div>;
  if (error || !e) return (
    <div className="detail">
      <div className="empty" style={{ paddingTop: 120 }}>
        <div className="ic"><i className="ti ti-cloud-off" /></div>
        <p>{error || "Event not found."}</p>
        <button className="btn glass" style={{ maxWidth: 200, margin: "0 auto 10px" }} onClick={reload}>Try again</button>
        <button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={() => nav("/")}>Back to Explore</button>
      </div>
    </div>
  );

  const ev = booked || e;
  const cat = CATS.find((c) => c.key === ev.cat);
  const saved = isSaved(ev.id);
  const out = isSoldOut(ev);
  const left = ticketsLeft(ev);

  const tiers = ev.tiers || [];
  const hasTiers = tiers.length > 0;
  const selectedTier = hasTiers ? tiers.find((t) => t.id === tierId) || null : null;
  const tierLeft = (t: { capacity: number; sold: number }) => Math.max(0, t.capacity - t.sold);
  // price the buyer actually pays: selected tier if tiered, else the flat price
  const payPrice = hasTiers ? (selectedTier?.price ?? 0) : ev.price;
  const payFee = +(payPrice * 0.08).toFixed(2);

  async function book() {
    if (hasTiers && !selectedTier) { setBookErr("Choose a ticket type first."); return; }
    setBooking(true); setBookErr("");
    try {
      if (payPrice > 0) {
        // paid ticket: redirect to Thawani's hosted checkout — the booking is
        // only confirmed once payment succeeds (see /checkout/success)
        const { checkoutUrl } = await api.checkoutEvent(ev.id, 1, getDeviceId(), getAccount(), selectedTier?.id);
        window.location.href = checkoutUrl;
        return;
      }
      setBooked(await api.bookEvent(ev.id, 1, getDeviceId(), getAccount(), selectedTier?.id));
      addTicket(ev.id);
    }
    catch (err: any) { setBookErr(err.message || "Couldn't book"); }
    finally { setBooking(false); }
  }

  const coverStyle: React.CSSProperties = ev.image ? { backgroundImage: `url(${ev.image})` } : { background: ev.color };

  return (
    <div className="detail">
      <div className="cover" style={coverStyle}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><i className="ti ti-arrow-left" /></button>
        <button className={"icon-btn" + (saved ? " on" : "")} onClick={() => toggleSave(ev.id)} aria-label="Save">
          <i className={"ti " + (saved ? "ti-heart-filled" : "ti-heart")} />
        </button>
        {!ev.image && <span className="glyph">{ev.glyph}</span>}
      </div>

      <div className="sheet glass">
        <span className="catpill">{cat?.label}</span>
        <h1 style={{ marginTop: 12 }}>{ev.title}</h1>
        <p className="host">Hosted by {ev.organizer}</p>

        {ev.tags.length > 0 && (
          <div className="tagrow">{ev.tags.map((t) => <span key={t} className="tg">{t}</span>)}</div>
        )}

        <div className="facts">
          <div className="fact"><i className="ti ti-calendar-event" /><div><b>{dayLabel(ev)} · {timeLabel(ev)}</b><span>Add to your calendar after you book</span></div></div>
          <div className="fact"><i className="ti ti-map-pin" /><div><b>{ev.venue}</b><span>{ev.area} · {ev.distanceKm} km away</span></div></div>
          {ev.ticketingType === "weyn" && !hasTiers && (
            <div className="fact"><i className="ti ti-ticket" /><div><b>{ev.price === 0 ? "Free entry" : `${ev.price} OMR per ticket`}</b><span>{out ? "Sold out" : ev.capacity >= 9000 ? "Open entry" : `${left} of ${ev.capacity} tickets left`}</span></div></div>
          )}
          {ev.ticketingType === "weyn" && hasTiers && (
            <div className="fact"><i className="ti ti-ticket" /><div><b>From {Math.min(...tiers.map((t) => t.price))} OMR</b><span>{tiers.length} ticket types available</span></div></div>
          )}
          {ev.ticketingType === "external" && (
            <div className="fact"><i className="ti ti-ticket" /><div><b>Tickets via external site</b><span>{ev.price === 0 ? "Free" : `${ev.price} OMR`}</span></div></div>
          )}
          {ev.ticketingType === "registration" && (
            <div className="fact"><i className="ti ti-clipboard-list" /><div><b>Registration required</b><span>{ev.price === 0 ? "Free" : `${ev.price} OMR`}</span></div></div>
          )}
          {ev.ticketingType === "cash" && (
            <div className="fact"><i className="ti ti-cash" /><div><b>Pay at the door</b><span>{ev.price === 0 ? "Free" : `${ev.price} OMR, cash`}</span></div></div>
          )}
          {ev.minAge > 0 && <div className="fact"><i className="ti ti-shield" /><div><b>Ages {ev.minAge}+</b><span>{ev.refundPolicy}</span></div></div>}
        </div>

        <p className="blurb">{ev.blurb}</p>

        <div style={{ marginTop: 18 }}>
          <MiniMap lat={ev.lat} lng={ev.lng} />
          <a className="gmaps-link" href={`https://www.google.com/maps/search/?api=1&query=${ev.lat},${ev.lng}`} target="_blank" rel="noreferrer">
            <i className="ti ti-map-2" /> Open in Google Maps
          </a>
        </div>

        {ev.ticketingType === "weyn" && hasTiers && !booked && (
          <div className="tier-picker">
            <h3 className="tier-picker-title">Choose your ticket</h3>
            {tiers.map((t) => {
              const soldOut = tierLeft(t) <= 0;
              return (
                <button
                  key={t.id} type="button" disabled={soldOut}
                  className={"tier-opt" + (tierId === t.id ? " on" : "") + (soldOut ? " soldout" : "")}
                  onClick={() => { setTierId(t.id); setBookErr(""); }}
                >
                  <div className="tier-opt-main">
                    <b>{t.name}</b>
                    <span>{soldOut ? "Sold out" : `${tierLeft(t)} left`}</span>
                  </div>
                  <div className="tier-opt-price">{t.price === 0 ? "Free" : `${t.price} OMR`}</div>
                </button>
              );
            })}
          </div>
        )}

        {ev.ticketingType === "weyn" && payPrice > 0 && !out && (
          <div className="fee-box">
            <div className="ln"><span>Ticket{selectedTier ? ` · ${selectedTier.name}` : ""}</span><span>{payPrice.toFixed(2)} OMR</span></div>
            <div className="ln"><span>Weyn service fee (8%)</span><span>{payFee.toFixed(2)} OMR</span></div>
            <div className="ln total"><span>Total</span><span>{(payPrice + payFee).toFixed(2)} OMR</span></div>
          </div>
        )}
        {bookErr && <p className="errline" style={{ marginTop: 14 }}>{bookErr}</p>}
      </div>

      <div className="buybar">
        {ev.cancelled ? (
          <button className="btn" disabled><i className="ti ti-ban" /> Event cancelled</button>
        ) : ev.ticketingType === "external" ? (
          <a className="btn" href={ev.externalTicketUrl || "#"} target="_blank" rel="noreferrer">
            <i className="ti ti-external-link" /> Visit ticket website
          </a>
        ) : ev.ticketingType === "registration" ? (
          <a className="btn" href={ev.externalTicketUrl || "#"} target="_blank" rel="noreferrer">
            <i className="ti ti-clipboard-list" /> Register now
          </a>
        ) : ev.ticketingType === "cash" ? (
          <div className="btn dark" style={{ cursor: "default" }}>
            <i className="ti ti-cash" /> {ev.organizerContact ? `Contact: ${ev.organizerContact}` : "Pay at the door"}
          </div>
        ) : booked ? (
          <button className="btn done" disabled>
            <i className="ti ti-circle-check" /> {ev.price === 0 ? "You're going" : "Ticket reserved"}
          </button>
        ) : out ? (
          <button className="btn" disabled><i className="ti ti-ticket-off" /> Sold out</button>
        ) : (
          <>
            <div className="lead">
              <div className="p">{hasTiers && !selectedTier ? `From ${Math.min(...tiers.map((t) => t.price))} OMR` : payPrice === 0 ? "Free" : `${(payPrice + payFee).toFixed(2)} OMR`}</div>
              <div className="s">{hasTiers && !selectedTier ? "Pick a ticket type" : payPrice === 0 ? "RSVP to reserve" : "incl. 8% fee"}</div>
            </div>
            <button className="btn" style={{ width: "auto", padding: "14px 26px" }} onClick={book} disabled={booking || (hasTiers && !selectedTier)}>
              {booking ? "Booking…" : payPrice === 0 ? "RSVP" : "Get ticket"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
