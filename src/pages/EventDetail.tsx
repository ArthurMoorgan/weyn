import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion } from "motion/react";
import { api, CATS, ticketsLeft, isSoldOut, dayLabel, timeLabel, captureUtmFromUrl, type Weyn, type CheckoutFormField } from "../api";
import CheckoutFormFields from "../components/CheckoutFormFields";
import { useAsync, useClosing } from "../hooks";
import { addRecentlyViewed } from "../hooks/useRecentlyViewed";
import { isSaved, toggleSave, useSaved, addTicket, ticketFor, getDeviceId, useAccount } from "../store";
import MiniMap from "../components/MiniMap";
import FollowButton from "../components/FollowButton";
import TicketSheet from "../components/TicketSheet";
import FloorPlanCanvas from "../components/FloorPlanCanvas";
import WhosGoing from "../components/WhosGoing";
import type { Collection } from "../api";
import { downloadEventIcs } from "../ics";
import Tooltip from "../components/Tooltip";
import { capture } from "../posthog";

export default function EventDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  useSaved();
  const { data: e, loading, error, reload } = useAsync(() => api.getEvent(id!), [id], { cacheKey: `event:${id}` });
  const [booked, setBooked] = useState<Weyn | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookErr, setBookErr] = useState("");
  const [tierId, setTierId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [listSheet, setListSheet] = useState(false);
  const [ticketSheet, setTicketSheet] = useState(false);
  const [shared, setShared] = useState(false);
  const account = useAccount();
  const [activeSlide, setActiveSlide] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [contactSheet, setContactSheet] = useState(false);
  const [inviteSheet, setInviteSheet] = useState(false);

  // Restores the "you're going / ticket reserved" bar on a return visit —
  // previously `booked` only ever got set optimistically inside book()
  // itself, so navigating away and back showed the normal buy button again
  // even though the user already had a real ticket. Also covers arriving
  // here straight from CheckoutSuccess's "View ticket" link
  // (?booking=&accessToken= in the URL) on a device where localStorage
  // doesn't have the record yet — e.g. the link was forwarded/opened
  // elsewhere — by persisting it the first time it's seen.
  useEffect(() => {
    if (!e) return;
    addRecentlyViewed(e.id);
    const urlBooking = searchParams.get("booking");
    const urlToken = searchParams.get("accessToken") || undefined;
    if (urlBooking && !ticketFor(e.id)) addTicket(e.id, urlBooking, urlToken);
    if (ticketFor(e.id)) setBooked(e);
    captureUtmFromUrl(e.id);
  }, [e, searchParams]);

  // "organizer_payment" tickets don't exist yet the moment a booking is
  // created — the organizer has to manually confirm the payment first (see
  // PendingPaymentsPanel in the organizer dashboard). Without this check,
  // `booked` alone would show a "View ticket" button that opens a real ticket
  // sheet with nothing in it yet.
  const [orgPayStatus, setOrgPayStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!e || e.ticketingType !== "organizer_payment") return;
    const rec = ticketFor(e.id);
    if (!rec?.bookingId) return;
    let cancelled = false;
    api.getBooking(rec.bookingId).then((s) => { if (!cancelled) setOrgPayStatus(s.status); }).catch(() => {});
    return () => { cancelled = true; };
  }, [e?.id]);

  // Rules-of-Hooks fix: these two hooks used to live below the loading/error
  // early returns (right where `tiers`/`payPrice` are recomputed further
  // down for the actual booking UI). On the very first render `loading` is
  // true, so the function returned before ever reaching them — no hooks
  // called. Once `e` arrived and `loading` flipped false, the SAME render
  // now called two more hooks than the previous one did, which is exactly
  // "Rendered more hooks than during the previous render" (React error
  // #310): every single event-page view crashed into the ErrorBoundary's
  // "Something went wrong — reloading usually fixes it" screen the moment
  // its data finished loading, tickets included. Hooks can never sit after
  // a conditional return; hoisted here (using `e` directly, not the
  // `booked`-aware `ev` derived below — `booked` can't be set yet this
  // early in the component's life) so they run on every render regardless
  // of loading state.
  const seatMapQuery = useAsync(
    () => (e ? api.eventSeatMap(e.id).then((p) => (p.mode === "seat" ? p : null)).catch(() => null) : Promise.resolve(null)),
    [e?.id]
  );
  const venueQuery = useAsync(
    () => (e?.venueProfileId ? api.getEventVenue(e.venueProfileId).catch(() => null) : Promise.resolve(null)),
    [e?.venueProfileId]
  );
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string | boolean>>({});

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
  // price the buyer actually pays: selected tier if tiered, else the flat price,
  // multiplied by the quantity stepper (see .qty-stepper below) — the API
  // already accepted a quantity param everywhere, it just always got a
  // hardcoded 1 before this.
  const unitPrice = hasTiers ? (selectedTier?.price ?? 0) : ev.price;
  const payPrice = +(unitPrice * qty).toFixed(2);
  const payFee = +(payPrice * 0.08).toFixed(2);
  const maxQty = hasTiers && selectedTier ? Math.min(10, tierLeft(selectedTier)) : 10;

  // The organizer's shared link is /e/:id?invite=CODE — this is the only
  // place a signed-out visitor's browser ever has the code, so it has to
  // be read from the URL, not fetched (GET /api/events/:id never returns
  // inviteCode to a non-owner, see server/app.js).
  const inviteCode = searchParams.get("invite") || undefined;

  // seatMapQuery/selectedSeatId are declared above the loading/error early
  // returns now (see the comment there) — this is just where they used to
  // live, before assigned seating existed on the free-RSVP path (Thawani
  // paid checkout doesn't have a seat-hold-with-expiry mechanism yet; see
  // server/app.js's POST /api/events/:id/book comment).

  async function book() {
    if (hasTiers && !selectedTier) { setBookErr("Choose a ticket type first."); return; }
    if (seatMapQuery.data && !selectedSeatId) { setBookErr("Pick a seat first."); return; }
    const missingField = (ev.checkoutFormFields || []).find((f) => f.required && f.type !== "checkbox" && !String(customFieldValues[f.id] || "").trim());
    if (missingField) { setBookErr(`${missingField.label} is required.`); return; }
    setBooking(true); setBookErr("");
    try {
      if (ev.ticketingType === "organizer_payment") {
        // Buyer pays the organizer directly (their own payment link, or our
        // hosted transfer-instructions page) — the ticket doesn't exist yet,
        // the organizer has to manually confirm the payment first (see
        // EventWorkspace's Attendees tab / PendingPaymentsPanel).
        const { bookingId, accessToken, redirectUrl } = await api.organizerPaymentCheckout(ev.id, qty, getDeviceId(), account, selectedTier?.id, inviteCode);
        addTicket(ev.id, bookingId, accessToken);
        window.location.href = redirectUrl;
        return;
      }
      if (payPrice > 0) {
        // paid ticket: redirect to Thawani's hosted checkout — the booking is
        // only confirmed once payment succeeds (see /checkout/success), so
        // there's nothing to show optimistically here.
        const { checkoutUrl } = await api.checkoutEvent(ev.id, qty, getDeviceId(), account, selectedTier?.id, inviteCode, undefined, undefined, customFieldValues);
        window.location.href = checkoutUrl;
        return;
      }
      // Free RSVP: flip the buy bar to "You're going" immediately — the
      // server call almost always succeeds, and waiting for it to paint
      // just makes a free RSVP feel slower than it is. Roll back to the
      // pre-book state (and undo the local ticket-list write) on failure.
      setBooked(ev);
      try {
        const confirmed = await api.bookEvent(ev.id, qty, getDeviceId(), account, selectedTier?.id, inviteCode, selectedSeatId ? [selectedSeatId] : undefined, customFieldValues);
        setBooked(confirmed);
        addTicket(ev.id, confirmed.bookingId, confirmed.accessToken);
        capture("ticket_booked", { eventId: ev.id, bookingId: confirmed.bookingId, paid: false });
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

  const slides = [ev.image, ...(ev.gallery || [])].filter((s): s is string => !!s);
  const hasCarousel = slides.length > 1;

  function onTrackScroll() {
    const el = trackRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveSlide(idx);
  }

  // "customEventThemes" — overrides the app's default purple accent (CTA
  // button, active states, buy bar) on this one event's page only, via a
  // scoped CSS custom-property override rather than touching the global
  // theme. React's CSSProperties type doesn't know about custom properties,
  // hence the cast.
  const themeStyle = ev.accentColor ? ({
    "--accent": ev.accentColor, "--primary": ev.accentColor,
    "--primary-hover": ev.accentColor, "--primary-pressed": ev.accentColor,
  } as React.CSSProperties) : undefined;

  return (
    <div className="detail" style={themeStyle}>
      <div className="detail-grid">
      <motion.div layoutId={`event-cover-${ev.id}`} className={"cover" + (hasCarousel ? " has-carousel" : "")} style={hasCarousel ? undefined : coverStyle}>
        {hasCarousel && (
          <>
            <div className="cover-carousel-track" ref={trackRef} onScroll={onTrackScroll}>
              {slides.map((src, i) => (
                <div className="cover-carousel-slide" key={src + i} style={{ backgroundImage: `url(${src})`, backgroundPosition: i === 0 ? (ev.imageFocalPoint || "center") : "center" }} />
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
            <button className="icon-btn" onClick={() => shareEvent(ev)} aria-label="Share">
              <i className={(shared ? "icon-check" : "icon-share-2")} />
            </button>
          </Tooltip>
          <Tooltip text={saved ? "Saved — tap to remove" : "Save"}>
            <button className={"icon-btn" + (saved ? " on" : "")} onClick={() => toggleSave(ev.id)} aria-label={saved ? "Saved — tap to remove" : "Save"} aria-pressed={saved}>
              <i className={(saved ? "icon-heart" : "icon-heart")} />
            </button>
          </Tooltip>
          {account && (
            <Tooltip text="Add to a list">
              <button className="icon-btn" onClick={() => setListSheet(true)} aria-label="Add to a list">
                <i className="icon-folder-plus" />
              </button>
            </Tooltip>
          )}
          {account && (
            <Tooltip text="Invite friends">
              <button className="icon-btn" onClick={() => setInviteSheet(true)} aria-label="Invite friends">
                <i className="icon-send" />
              </button>
            </Tooltip>
          )}
        </div>
        {!hasCarousel && !ev.image && <span className="glyph">{ev.glyph}</span>}
      </motion.div>
      {listSheet && <AddToListSheet eventId={ev.id} onClose={() => setListSheet(false)} />}
      {ticketSheet && (() => {
        const rec = ticketFor(ev.id);
        return rec?.bookingId ? (
          <TicketSheet eventTitle={ev.title} bookingId={rec.bookingId} accessToken={rec.accessToken} venue={ev.venue} dateLabel={`${dayLabel(ev)} · ${timeLabel(ev)}`} lat={ev.lat} lng={ev.lng} onClose={() => setTicketSheet(false)} />
        ) : null;
      })()}
      {contactSheet && ev.organizerContact && <ContactOrganizerSheet contact={ev.organizerContact} onClose={() => setContactSheet(false)} />}
      {inviteSheet && <InviteFriendsSheet eventId={ev.id} eventTitle={ev.title} onClose={() => setInviteSheet(false)} />}

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
          {ev.organizerContact && (
            <Tooltip text="Contact organizer">
              <button className="icon-btn" onClick={() => setContactSheet(true)} aria-label="Contact organizer">
                <i className="icon-mail" />
              </button>
            </Tooltip>
          )}
        </div>

        {ev.tags.length > 0 && (
          <div className="tagrow">{ev.tags.map((t) => <span key={t} className="tg">{t}</span>)}</div>
        )}

        <div className="facts">
          <div className="fact"><i className="icon-calendar-days" /><div><b>{dayLabel(ev)} · {timeLabel(ev)}</b><span>Add to your calendar after you book</span></div></div>
          <div className="fact"><i className="icon-map-pin" /><div><b>{ev.venue}</b><span>{ev.area} · {ev.distanceKm} km away</span></div></div>
          {ev.ticketingType === "weyn" && !hasTiers && (
            <div className="fact"><i className="icon-ticket" /><div><b>{ev.price === 0 ? "Free entry" : `${ev.price} ${ev.currency || "OMR"} per ticket`}</b><span>{out ? "Sold out" : ev.capacity >= 9000 ? "Open entry" : `${left} of ${ev.capacity} tickets left`}</span></div></div>
          )}
          {ev.ticketingType === "weyn" && hasTiers && (
            <div className="fact"><i className="icon-ticket" /><div><b>From {Math.min(...tiers.map((t) => t.price))} {ev.currency || "OMR"}</b><span>{tiers.length} ticket types available</span></div></div>
          )}
          {ev.ticketingType === "external" && (
            <div className="fact"><i className="icon-ticket" /><div><b>Tickets via external site</b><span>{ev.price === 0 ? "Free" : `${ev.price} ${ev.currency || "OMR"}`}</span></div></div>
          )}
          {ev.ticketingType === "registration" && (
            <div className="fact"><i className="icon-clipboard-list" /><div><b>Registration required</b><span>{ev.price === 0 ? "Free" : `${ev.price} ${ev.currency || "OMR"}`}</span></div></div>
          )}
          {ev.ticketingType === "cash" && (
            <div className="fact"><i className="icon-banknote" /><div><b>Pay at the door</b><span>{ev.price === 0 ? "Free" : `${ev.price} ${ev.currency || "OMR"}, cash`}</span></div></div>
          )}
          {ev.ticketingType === "organizer_payment" && (
            <div className="fact"><i className="icon-wallet" /><div><b>Pay the organizer directly</b><span>{ev.price} {ev.currency || "OMR"} · ticket issued once they confirm</span></div></div>
          )}
          {ev.minAge > 0 && <div className="fact"><i className="icon-shield" /><div><b>Ages {ev.minAge}+</b><span>{ev.refundPolicy}</span></div></div>}
        </div>

        <p className="blurb">{ev.blurb}</p>

        <div style={{ marginTop: 16 }}>
          <MiniMap lat={ev.lat} lng={ev.lng} />
          <a className="gmaps-link" href={`https://www.google.com/maps/search/?api=1&query=${ev.lat},${ev.lng}`} target="_blank" rel="noreferrer">
            <i className="icon-map" /> Open in Google Maps
          </a>
        </div>

        {venueQuery.data && (
          <div className="facts" style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 12 }}>Venue Details</h3>
            {venueQuery.data.parkingAvailable !== undefined && (
              <div className="fact">
                <i className="icon-parking" />
                <div>
                  <b>{venueQuery.data.parkingAvailable ? "Parking available" : "No parking"}</b>
                </div>
              </div>
            )}
            {venueQuery.data.accessibilityNotes && (
              <div className="fact">
                <i className="icon-accessibility" />
                <div>
                  <b>Accessibility</b>
                  <span>{venueQuery.data.accessibilityNotes}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {ev.ticketingType === "weyn" && hasTiers && !booked && (
          <div className="tier-picker">
            <h3 className="tier-picker-title">Select tickets</h3>
            {tiers.map((t) => {
              const soldOut = tierLeft(t) <= 0;
              const isSel = tierId === t.id;
              return (
                <div
                  key={t.id} role="button" tabIndex={soldOut ? -1 : 0} aria-disabled={soldOut}
                  className={"tier-opt" + (isSel ? " on" : "") + (soldOut ? " soldout" : "")}
                  onClick={() => { if (soldOut) return; setTierId(t.id); setQty(1); setBookErr(""); }}
                  onKeyDown={(ev2) => { if (!soldOut && (ev2.key === "Enter" || ev2.key === " ")) { ev2.preventDefault(); setTierId(t.id); setQty(1); setBookErr(""); } }}
                >
                  <div className="tier-opt-top">
                    <div className="tier-opt-main">
                      <b>{t.name}</b>
                      <span>{soldOut ? "Sold out" : `${tierLeft(t)} left`}</span>
                    </div>
                    <div className="tier-opt-price">{t.price === 0 ? "Free" : `${t.price} ${ev.currency || "OMR"}`}</div>
                  </div>
                  {isSel && !soldOut && (
                    <div className="qty-stepper" onClick={(ev2) => ev2.stopPropagation()}>
                      <button type="button" className="qty-btn" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer tickets">
                        <i className="icon-minus" />
                      </button>
                      <span className="qty-val">{qty}</span>
                      <button type="button" className="qty-btn accent" disabled={qty >= maxQty} onClick={() => setQty((q) => Math.min(maxQty, q + 1))} aria-label="More tickets">
                        <i className="icon-plus" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {seatMapQuery.data && !booked && (
          <div className="seat-picker">
            <h3 className="tier-picker-title">Pick your seat</h3>
            <div className="stage-pill">Stage</div>
            <FloorPlanCanvas
              tables={seatMapQuery.data.tables} mode="pick" seatMode
              selectedSeatIds={selectedSeatId ? [selectedSeatId] : []}
              onSeatClick={(seatId) => { setSelectedSeatId(seatId); setBookErr(""); }}
            />
            <div className="seat-legend">
              <span className="seat-legend-item"><i className="seat-legend-dot available" /> Available</span>
              <span className="seat-legend-item"><i className="seat-legend-dot selected" /> Selected</span>
              <span className="seat-legend-item"><i className="seat-legend-dot sold" /> Sold</span>
            </div>
          </div>
        )}

        {(ev.checkoutFormFields || []).length > 0 && !booked && (
          <CheckoutFormFields
            fields={ev.checkoutFormFields!}
            values={customFieldValues}
            onChange={(id, value) => setCustomFieldValues((prev) => ({ ...prev, [id]: value }))}
          />
        )}

        {ev.ticketingType === "weyn" && payPrice > 0 && !out && (
          <div className="fee-box">
            <div className="ln"><span>{qty} × {selectedTier ? selectedTier.name : "Ticket"}</span><span>{payPrice.toFixed(2)} {ev.currency || "OMR"}</span></div>
            <div className="ln"><span>Weyn service fee (8%)</span><span>{payFee.toFixed(2)} {ev.currency || "OMR"}</span></div>
            <div className="ln total"><span>Total</span><span>{(payPrice + payFee).toFixed(2)} {ev.currency || "OMR"}</span></div>
          </div>
        )}
        {bookErr && <p className="errline" style={{ marginTop: 12 }}>{bookErr}</p>}
        {/* "reducedWeynBranding" Pro feature hides this — see GET
            /api/events/:id's hideWeynBranding, derived server-side from the
            owner's plan so a free-tier organizer can't just omit it client-side. */}
        {!ev.hideWeynBranding && (
          <p style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-3)", marginTop: 16 }}>
            Powered by <a href="https://weynevents.com" style={{ color: "inherit" }}>Weyn</a>
          </p>
        )}
        {searchParams.get("feedback") === "1" && <FeedbackWidget eventId={ev.id} bookingId={ticketFor(ev.id)?.bookingId} />}

        <WhosGoing eventId={ev.id} currentUserId={account?.id} />
      </div>
      </div>

      <div className="buybar">
        {ev.cancelled ? (
          <button className="btn" disabled><i className="icon-ban" /> Event cancelled</button>
        ) : ev.inviteOnly && !inviteCode && !booked ? (
          <div className="btn dark" style={{ cursor: "default" }}>
            <i className="icon-lock" /> Invite-only — you need an invite link to book
          </div>
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
        ) : booked && ev.ticketingType === "organizer_payment" && orgPayStatus && orgPayStatus !== "paid" ? (
          <div className="btn dark" style={{ cursor: "default" }}>
            <i className="icon-clock" /> Payment pending organizer confirmation
          </div>
        ) : booked ? (
          <>
            {ticketFor(ev.id)?.bookingId ? (
              <button className="btn done" style={{ flex: 1 }} onClick={() => setTicketSheet(true)}>
                <i className="icon-qr-code" /> View ticket
              </button>
            ) : (
              <button className="btn done" disabled style={{ flex: 1 }}>
                <i className="icon-circle-check" /> {ev.price === 0 ? "You're going" : "Ticket reserved"}
              </button>
            )}
            <Tooltip text="Add to calendar">
              <button className="btn glass sq" onClick={() => downloadEventIcs(ev)} aria-label="Add to calendar">
                <i className="icon-calendar-plus" />
              </button>
            </Tooltip>
          </>
        ) : out ? (
          <button className="btn" disabled><i className="icon-ticket-x" /> Sold out</button>
        ) : (
          <>
            <div className="lead">
              <div className="p">{hasTiers && !selectedTier ? `From ${Math.min(...tiers.map((t) => t.price))} ${ev.currency || "OMR"}` : payPrice === 0 ? "Free" : `${(payPrice + payFee).toFixed(2)} ${ev.currency || "OMR"}`}</div>
              <div className="s">{hasTiers && !selectedTier ? "Pick a ticket type" : payPrice === 0 ? "RSVP to reserve" : "incl. 8% fee"}</div>
            </div>
            <button
              className="btn lg" style={{ width: "auto" }}
              onClick={() => {
                // Paid Weyn-hosted tickets go through the in-app checkout
                // review screen (order summary, promo code, pay) instead of
                // redirecting straight out — everything else (free RSVP,
                // organizer_payment's own external flow) keeps booking directly.
                if (ev.ticketingType === "weyn" && payPrice > 0) {
                  const missingField = (ev.checkoutFormFields || []).find((f) => f.required && f.type !== "checkbox" && !String(customFieldValues[f.id] || "").trim());
                  if (missingField) { setBookErr(`${missingField.label} is required.`); return; }
                  nav(`/e/${ev.id}/checkout`, { state: { tierId, qty, selectedSeatId, inviteCode, customFieldValues } });
                } else {
                  book();
                }
              }}
              disabled={booking || (hasTiers && !selectedTier) || !!(seatMapQuery.data && !selectedSeatId)}
            >
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
              <ul className="steps" style={{ marginBottom: 12 }}>
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
        <button className="btn glass" style={{ marginTop: 12 }} onClick={close}>Done</button>
      </div>
    </div>
  );
}

// Feedback Center — reached via a link the organizer shares (see
// EventWorkspace's Marketing tab), not surfaced to every visitor by default.
function FeedbackWidget({ eventId, bookingId }: { eventId: string; bookingId?: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!rating && !comment.trim()) return;
    setBusy(true); setErr("");
    try {
      await api.submitFeedback(eventId, { rating: rating || undefined, comment: comment.trim() || undefined, bookingId });
      setSent(true);
    } catch (e: any) {
      setErr(e.message || "Couldn't send feedback");
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p style={{ textAlign: "center", fontSize: 13.5, color: "var(--accent)", marginTop: 16 }}>Thanks for the feedback!</p>;

  return (
    <div className="dash-card" style={{ padding: 16, marginTop: 16 }}>
      <b style={{ display: "block", marginBottom: 8 }}>How was it?</b>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} aria-label={`${n} star`} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: n <= rating ? "var(--accent)" : "var(--text-3)" }}>★</button>
        ))}
      </div>
      <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything you'd like the organizer to know? (optional)" style={{ width: "100%", marginBottom: 8 }} />
      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={submit} disabled={busy || (!rating && !comment.trim())}>{busy ? "Sending…" : "Send feedback"}</button>
    </div>
  );
}

function ContactOrganizerSheet({ contact, onClose }: { contact: string; onClose: () => void }) {
  const { closing, close } = useClosing(onClose);
  const [copied, setCopied] = useState(false);

  const isEmail = contact.includes("@");
  const isPhone = /^\+?[\d\s\-()]+$/.test(contact);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(contact);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 16 }}>Contact organizer</h3>
        <p style={{ marginBottom: 12, color: "var(--text-2)", fontSize: 14 }}>{contact}</p>
        <ul className="steps">
          {isEmail && (
            <li>
              <i className="icon-mail" />
              <span>Send email</span>
              <a className="copy-btn" style={{ marginLeft: "auto" }} href={`mailto:${contact}`} rel="noreferrer">
                <i className="icon-arrow-up-right" />
              </a>
            </li>
          )}
          {isPhone && (
            <li>
              <i className="icon-phone" />
              <span>Call</span>
              <a className="copy-btn" style={{ marginLeft: "auto" }} href={`tel:${contact}`} rel="noreferrer">
                <i className="icon-arrow-up-right" />
              </a>
            </li>
          )}
          <li style={{ cursor: "pointer" }} onClick={copyToClipboard}>
            <i className="icon-copy" />
            <span>{copied ? "Copied!" : "Copy contact"}</span>
            {!copied && <i className="copy-btn" style={{ marginLeft: "auto", cursor: "pointer" }}>→</i>}
          </li>
        </ul>
        <button className="btn glass" style={{ marginTop: 12, width: "100%" }} onClick={close}>Done</button>
      </div>
    </div>
  );
}

function InviteFriendsSheet({ eventId, eventTitle, onClose }: { eventId: string; eventTitle: string; onClose: () => void }) {
  const { closing, close } = useClosing(onClose);
  const [copied, setCopied] = useState(false);

  const inviteLink = `/e/${eventId}`;

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12 }}>Invite friends</h3>
        <p style={{ marginBottom: 12, color: "var(--text-2)", fontSize: 14 }}>Event: <b>{eventTitle}</b></p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 12, backgroundColor: "var(--bg-2)", borderRadius: "var(--radius-sm)", marginBottom: 12 }}>
          <code style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>{inviteLink}</code>
          <button
            className="copy-btn"
            onClick={copyToClipboard}
            style={{ marginLeft: 8, flexShrink: 0 }}
            aria-label="Copy link"
          >
            {copied ? <><i className="icon-check" /> Copied</> : <i className="icon-copy" />}
          </button>
        </div>
        <button className="btn glass" style={{ width: "100%" }} onClick={close}>Done</button>
      </div>
    </div>
  );
}
