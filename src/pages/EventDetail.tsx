import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, CATS, ticketsLeft, isSoldOut, dayLabel, timeLabel, type Weyn } from "../api";
import { useAsync, useClosing } from "../hooks";
import { isSaved, toggleSave, useSaved, addTicket, getDeviceId, useAccount } from "../store";
import MiniMap from "../components/MiniMap";
import FollowButton from "../components/FollowButton";
import type { Collection } from "../api";
import { downloadEventIcs } from "../ics";

export default function EventDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  useSaved();
  const { data: e, loading, error, reload } = useAsync(() => api.getEvent(id!), [id]);
  const [booked, setBooked] = useState<Weyn | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookErr, setBookErr] = useState("");
  const [tierId, setTierId] = useState<string | null>(null);
  const [listSheet, setListSheet] = useState(false);
  const [shared, setShared] = useState(false);
  const account = useAccount();

  if (loading) return (
    <div className="detail">
      <div className="detail-skel-cover" />
      <div className="detail-skel-sheet">
        <div className="detail-skel-title" />
        <div className="detail-skel-line" />
        <div className="detail-skel-facts" />
      </div>
    </div>
  );
  if (error || !e) return (
    <div className="detail">
      <div className="empty" style={{ paddingTop: 120 }}>
        <div className="ic"><i className="icon-cloud-off" /></div>
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

  async function shareEvent(e: Weyn) {
    // The event page already has real server-side OG/Twitter meta tags
    // (see server/app.js's /e/:id route) — this is just giving users an
    // easy way to actually trigger a share, not building the preview itself.
    const url = window.location.href;
    const shareData = { title: e.title, text: `${e.title} — ${e.venue}, ${e.area}`, url };
    if (navigator.share) {
      try { await navigator.share(shareData); return; } catch { /* user cancelled — not an error */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch { /* clipboard blocked (e.g. insecure context) — nothing more we can do */ }
  }

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
        // only confirmed once payment succeeds (see /checkout/success), so
        // there's nothing to show optimistically here.
        const { checkoutUrl } = await api.checkoutEvent(ev.id, 1, getDeviceId(), account, selectedTier?.id);
        window.location.href = checkoutUrl;
        return;
      }
      // Free RSVP: flip the buy bar to "You're going" immediately — the
      // server call almost always succeeds, and waiting for it to paint
      // just makes a free RSVP feel slower than it is. Roll back to the
      // pre-book state (and undo the local ticket-list write) on failure.
      setBooked(ev);
      try {
        const confirmed = await api.bookEvent(ev.id, 1, getDeviceId(), account, selectedTier?.id);
        setBooked(confirmed);
        addTicket(ev.id);
      } catch (err: any) {
        setBooked(null);
        setBookErr(err.message || "Couldn't book");
      }
    }
    catch (err: any) { setBookErr(err.message || "Couldn't book"); }
    finally { setBooking(false); }
  }

  const coverStyle: React.CSSProperties = ev.image
    ? { backgroundImage: `url(${ev.image})`, backgroundPosition: ev.imageFocalPoint || "center" }
    : { background: ev.color };

  return (
    <div className="detail">
      <div className="detail-grid">
      <div className="cover" style={coverStyle}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><i className="icon-arrow-left" /></button>
        <div style={{ position: "relative", zIndex: 2, display: "flex", gap: 8 }}>
          <button className="icon-btn" onClick={() => shareEvent(ev)} aria-label="Share">
            <i className={(shared ? "icon-check" : "icon-share-2")} />
          </button>
          <button className={"icon-btn" + (saved ? " on" : "")} onClick={() => toggleSave(ev.id)} aria-label={saved ? "Saved — tap to remove" : "Save"} aria-pressed={saved}>
            <i className={(saved ? "icon-heart" : "icon-heart")} />
          </button>
          {account && (
            <button className="icon-btn" onClick={() => setListSheet(true)} aria-label="Add to a list">
              <i className="icon-folder-plus" />
            </button>
          )}
        </div>
        {!ev.image && <span className="glyph">{ev.glyph}</span>}
      </div>
      {listSheet && <AddToListSheet eventId={ev.id} onClose={() => setListSheet(false)} />}

      <div className="sheet glass">
        <span className={`catpill cat-${ev.cat}`}>{cat?.label}</span>
        <h1 style={{ marginTop: 12 }}>{ev.title}</h1>
        <div className="host-row">
          {ev.ownerId ? (
            <Link to={`/organizer/${ev.ownerId}`} className="host">Hosted by {ev.organizer}</Link>
          ) : (
            <p className="host">Hosted by {ev.organizer}</p>
          )}
          {ev.ownerId && <FollowButton organizerId={ev.ownerId} />}
        </div>

        {ev.tags.length > 0 && (
          <div className="tagrow">{ev.tags.map((t) => <span key={t} className="tg">{t}</span>)}</div>
        )}

        <div className="facts">
          <div className="fact"><i className="icon-calendar-days" /><div><b>{dayLabel(ev)} · {timeLabel(ev)}</b><span>Add to your calendar after you book</span></div></div>
          <div className="fact"><i className="icon-map-pin" /><div><b>{ev.venue}</b><span>{ev.area} · {ev.distanceKm} km away</span></div></div>
          {ev.ticketingType === "weyn" && !hasTiers && (
            <div className="fact"><i className="icon-ticket" /><div><b>{ev.price === 0 ? "Free entry" : `${ev.price} OMR per ticket`}</b><span>{out ? "Sold out" : ev.capacity >= 9000 ? "Open entry" : `${left} of ${ev.capacity} tickets left`}</span></div></div>
          )}
          {ev.ticketingType === "weyn" && hasTiers && (
            <div className="fact"><i className="icon-ticket" /><div><b>From {Math.min(...tiers.map((t) => t.price))} OMR</b><span>{tiers.length} ticket types available</span></div></div>
          )}
          {ev.ticketingType === "external" && (
            <div className="fact"><i className="icon-ticket" /><div><b>Tickets via external site</b><span>{ev.price === 0 ? "Free" : `${ev.price} OMR`}</span></div></div>
          )}
          {ev.ticketingType === "registration" && (
            <div className="fact"><i className="icon-clipboard-list" /><div><b>Registration required</b><span>{ev.price === 0 ? "Free" : `${ev.price} OMR`}</span></div></div>
          )}
          {ev.ticketingType === "cash" && (
            <div className="fact"><i className="icon-banknote" /><div><b>Pay at the door</b><span>{ev.price === 0 ? "Free" : `${ev.price} OMR, cash`}</span></div></div>
          )}
          {ev.minAge > 0 && <div className="fact"><i className="icon-shield" /><div><b>Ages {ev.minAge}+</b><span>{ev.refundPolicy}</span></div></div>}
        </div>

        <p className="blurb">{ev.blurb}</p>

        <div style={{ marginTop: 18 }}>
          <MiniMap lat={ev.lat} lng={ev.lng} />
          <a className="gmaps-link" href={`https://www.google.com/maps/search/?api=1&query=${ev.lat},${ev.lng}`} target="_blank" rel="noreferrer">
            <i className="icon-map" /> Open in Google Maps
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
      </div>

      <div className="buybar">
        {ev.cancelled ? (
          <button className="btn" disabled><i className="icon-ban" /> Event cancelled</button>
        ) : ev.ticketingType === "external" ? (
          <a className="btn" href={ev.externalTicketUrl || "#"} target="_blank" rel="noreferrer">
            <i className="icon-external-link" /> Visit ticket website
          </a>
        ) : ev.ticketingType === "registration" ? (
          <a className="btn" href={ev.externalTicketUrl || "#"} target="_blank" rel="noreferrer">
            <i className="icon-clipboard-list" /> Register now
          </a>
        ) : ev.ticketingType === "cash" ? (
          <div className="btn dark" style={{ cursor: "default" }}>
            <i className="icon-banknote" /> {ev.organizerContact ? `Contact: ${ev.organizerContact}` : "Pay at the door"}
          </div>
        ) : booked ? (
          <>
            <button className="btn done" disabled style={{ flex: 1 }}>
              <i className="icon-circle-check" /> {ev.price === 0 ? "You're going" : "Ticket reserved"}
            </button>
            <button className="btn glass sq" onClick={() => downloadEventIcs(ev)} aria-label="Add to calendar">
              <i className="icon-calendar-plus" />
            </button>
          </>
        ) : out ? (
          <button className="btn" disabled><i className="icon-ticket-x" /> Sold out</button>
        ) : (
          <>
            <div className="lead">
              <div className="p">{hasTiers && !selectedTier ? `From ${Math.min(...tiers.map((t) => t.price))} OMR` : payPrice === 0 ? "Free" : `${(payPrice + payFee).toFixed(2)} OMR`}</div>
              <div className="s">{hasTiers && !selectedTier ? "Pick a ticket type" : payPrice === 0 ? "RSVP to reserve" : "incl. 8% fee"}</div>
            </div>
            <button className="btn lg" style={{ width: "auto" }} onClick={book} disabled={booking || (hasTiers && !selectedTier)}>
              {booking ? "Booking…" : payPrice === 0 ? "RSVP" : "Get ticket"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AddToListSheet({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [lists, setLists] = useState<Collection[] | null>(null);
  const [name, setName] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const { closing, close } = useClosing(onClose);

  function load() {
    api.listMyCollections().then(setLists).catch(() => setLists([]));
  }
  useEffect(load, []);

  async function addTo(id: string) {
    await api.addToCollection(id, eventId);
    setAdded((s) => new Set(s).add(id));
  }

  async function createAndAdd() {
    if (!name.trim()) return;
    const c = await api.createCollection(name.trim());
    setName("");
    await addTo(c.id);
    load();
  }

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12 }}>Add to a list</h3>
        {lists === null ? (
          <>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          </>
        ) : (
          <>
            {lists.length > 0 && (
              <ul className="steps" style={{ marginBottom: 14 }}>
                {lists.map((c) => (
                  <li key={c.id}>
                    <i className="icon-list" />
                    <span>{c.name}</span>
                    <button className="copy-btn" style={{ marginLeft: "auto" }} onClick={() => addTo(c.id)} disabled={added.has(c.id)}>
                      {added.has(c.id) ? <><i className="icon-check" /> Added</> : "Add"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Or create a new list…" onKeyDown={(e) => e.key === "Enter" && createAndAdd()} />
              <button className="btn glass sm" onClick={createAndAdd} disabled={!name.trim()}>Create</button>
            </div>
          </>
        )}
        <button className="btn glass" style={{ marginTop: 14 }} onClick={close}>Done</button>
      </div>
    </div>
  );
}
