import { useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, VENUE_CATS, type Reservation, type VenueAvailabilitySlot } from "../api";
import { useAsync } from "../hooks";
import MiniMap from "../components/MiniMap";
import Tooltip from "../components/Tooltip";

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function slotLabel(s: VenueAvailabilitySlot): string {
  return `${DAY_LABEL[s.dayOfWeek]} · ${s.startTime}–${s.endTime}`;
}

export default function VenueDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: venue, loading, error, reload } = useAsync(() => api.getVenue(id!), [id], { cacheKey: `venue:${id}` });

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [slotId, setSlotId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [capacityFull, setCapacityFull] = useState(false);
  const [confirmed, setConfirmed] = useState<Reservation | null>(null);
  const [shared, setShared] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  async function shareVenue() {
    if (!venue) return;
    const url = window.location.href;
    const shareData = { title: venue.name, text: `${venue.name} — ${venue.venue}, ${venue.area}`, url };
    if (navigator.share) {
      try { await navigator.share(shareData); return; } catch { /* user cancelled — not an error */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch { /* clipboard blocked (e.g. insecure context) — nothing more we can do */ }
  }

  const catLabel = useMemo(() => {
    if (!venue) return "";
    return VENUE_CATS.find((c) => c.key === venue.category)?.label || venue.category;
  }, [venue]);

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

  if (error || !venue) return (
    <div className="detail">
      <div className="empty" style={{ paddingTop: 120 }}>
        <div className="ic"><i className="icon-cloud-off" /></div>
        <p>{error || "Venue not found."}</p>
        <button className="btn glass" style={{ maxWidth: 200, margin: "0 auto 10px" }} onClick={reload}>Try again</button>
        <button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={() => nav("/")}>Back to Discover</button>
      </div>
    </div>
  );

  const cover = venue.coverImage || venue.photos?.[0] || null;
  const coverStyle: React.CSSProperties = cover
    ? { backgroundImage: `url(${cover})` }
    : { background: "var(--surface-2)" };

  const slides = [venue.coverImage, ...(venue.photos || [])].filter((s, i, arr): s is string => !!s && arr.indexOf(s) === i);
  const hasCarousel = slides.length > 1;

  function onTrackScroll() {
    const el = trackRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveSlide(idx);
  }

  async function submitReservation() {
    setSubmitErr("");
    setCapacityFull(false);
    if (!venue || !guestName.trim() || !guestEmail.trim() || !date || !time || partySize < 1) {
      setSubmitErr("Please fill in your name, email, date, time, and party size.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createReservation(venue.id, {
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim(),
        guestPhone: guestPhone.trim() || undefined,
        partySize,
        date,
        time,
        slotId: slotId || undefined,
        notes: notes.trim() || undefined,
      });
      setConfirmed(res);
    } catch (err: any) {
      const msg: string = err.message || "Couldn't make a reservation";
      if (/capacity/i.test(msg)) setCapacityFull(true);
      setSubmitErr(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="detail">
      <div className="detail-grid">
        <div className={"cover" + (hasCarousel ? " has-carousel" : "")} style={hasCarousel ? undefined : coverStyle}>
          {hasCarousel && (
            <>
              <div className="cover-carousel-track" ref={trackRef} onScroll={onTrackScroll}>
                {slides.map((src, i) => (
                  <div className="cover-carousel-slide" key={src + i} style={{ backgroundImage: `url(${src})` }} />
                ))}
              </div>
              <div className="cover-carousel-dots">
                {slides.map((_, i) => (
                  <span key={i} className={"cover-carousel-dot" + (i === activeSlide ? " on" : "")} />
                ))}
              </div>
            </>
          )}
          <Tooltip text="Back"><button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><i className="icon-arrow-left" /></button></Tooltip>
          <div style={{ position: "relative", zIndex: 2, display: "flex", gap: 8 }}>
            <Tooltip text="Share">
              <button className="icon-btn" onClick={shareVenue} aria-label="Share">
                <i className={shared ? "icon-check" : "icon-share-2"} />
              </button>
            </Tooltip>
          </div>
          {!hasCarousel && !cover && <span className="glyph"><i className="icon-map-pin" /></span>}
        </div>

        <div className="sheet glass">
          <span className="catpill venue-catpill">{catLabel}</span>
          <h1 style={{ marginTop: 12 }}>{venue.name}</h1>
          <div className="host-row">
            <p className="host">{venue.venue}</p>
            {venue.verified && (
              <span className="ec-badge confirmed"><i className="icon-badge-check" /> Verified</span>
            )}
          </div>

          {venue.tags.length > 0 && (
            <div className="tagrow">{venue.tags.map((t) => <span key={t} className="tg">{t}</span>)}</div>
          )}

          <div className="facts">
            <div className="fact"><i className="icon-map-pin" /><div><b>{venue.venue}</b><span>{venue.area}</span></div></div>
            <div className="fact"><i className="icon-banknote" /><div><b>{venue.priceRange}</b><span>Price range</span></div></div>
          </div>

          <p className="blurb">{venue.description}</p>

          <div style={{ marginTop: 18 }}>
            <MiniMap lat={venue.lat} lng={venue.lng} />
            <a className="gmaps-link" href={`https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`} target="_blank" rel="noreferrer">
              <i className="icon-map" /> Open in Google Maps
            </a>
          </div>

          {venue.slots.length > 0 && (
            <div className="tier-picker">
              <h3 className="tier-picker-title">Available slots</h3>
              {venue.slots.map((s, i) => {
                const key = s.id || `${s.dayOfWeek}-${s.startTime}-${i}`;
                return (
                  <button
                    key={key} type="button"
                    className={"tier-opt" + (slotId === key ? " on" : "")}
                    onClick={() => {
                      setSlotId(s.id || key);
                      setTime(s.startTime);
                    }}
                  >
                    <div className="tier-opt-main">
                      <b>{slotLabel(s)}</b>
                      <span>Capacity {s.capacity}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {confirmed ? (
            <div className="facts" style={{ marginTop: 18 }}>
              <div className="fact">
                <i className="icon-circle-check" />
                <div>
                  <b>Reservation confirmed</b>
                  <span>
                    {confirmed.partySize} guests on {confirmed.date} at {confirmed.time}. A confirmation has been sent to {confirmed.guestEmail}.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="field" style={{ marginTop: 22 }}>
              <h3 style={{ marginBottom: 12 }}>Make a reservation</h3>

              <div className="field">
                <label>Full name</label>
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
              <div className="field">
                <label>Phone (optional)</label>
                <input type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+968 9xxxxxxx" />
              </div>
              <div className="field">
                <label>Party size</label>
                <input type="number" min={1} value={partySize} onChange={(e) => setPartySize(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <div className="field">
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Time</label>
                <input type="time" value={time} onChange={(e) => { setTime(e.target.value); setSlotId(null); }} />
              </div>
              <div className="field">
                <label>Notes (optional)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything we should know?" rows={3} />
              </div>

              {capacityFull ? (
                <p className="errline">This slot is fully booked — please pick a different time or date.</p>
              ) : submitErr ? (
                <p className="errline">{submitErr}</p>
              ) : null}

              <button className="btn lg" onClick={submitReservation} disabled={submitting}>
                {submitting ? "Reserving…" : "Reserve"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
