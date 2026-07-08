import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { addTicket } from "../store";

// "organizer_payment" ticketing's own hosted page — reached when the
// organizer supplied transfer details instead of an external payment link
// (see POST /api/events/:id/organizer-checkout's redirectUrl branch). Shows
// the amount + the organizer's own instructions, lets the buyer say "I've
// sent it" (Booking.claimedPaidAt — a claim, not proof), then polls the same
// way CheckoutSuccess.tsx does for the organizer's manual confirmation to
// land, at which point the real ticket exists and this hands off to it.
export default function OrganizerPaymentCheckout() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const bookingId = params.get("booking");
  const accessToken = params.get("accessToken") || "";
  const [info, setInfo] = useState<{ eventTitle: string; amount: number; transferDetails: string | null; status: string; claimedPaidAt: string | null } | null>(null);
  const [err, setErr] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId || !accessToken) { setErr("Missing booking reference."); return; }
    let cancelled = false;
    let tries = 0;
    const poll = async () => {
      try {
        const data = await api.getOrganizerPaymentBooking(bookingId, accessToken);
        if (cancelled) return;
        setInfo(data);
        if (data.status === "paid") { addTicket((await api.getBooking(bookingId)).eventId, bookingId, accessToken); return; }
        if (++tries >= 40) return; // ~2 minutes of polling, then stop hammering the server
        setTimeout(poll, 3000);
      } catch (e: any) {
        if (!cancelled) setErr(e.message || "Couldn't load this booking.");
      }
    };
    poll();
    api.getBooking(bookingId).then((s) => setEventId(s.eventId)).catch(() => {});
    return () => { cancelled = true; };
  }, [bookingId, accessToken]);

  async function claim() {
    if (!bookingId) return;
    setClaiming(true);
    try {
      await api.claimPaymentSent(bookingId, accessToken);
      setInfo((prev) => (prev ? { ...prev, claimedPaidAt: new Date().toISOString() } : prev));
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="detail">
      <div className="sheet glass" style={{ marginTop: 60, textAlign: "left" }}>
        {err ? (
          <p className="errline">{err}</p>
        ) : !info ? (
          <div style={{ textAlign: "center" }}><div className="spin" /><p>Loading…</p></div>
        ) : info.status === "paid" ? (
          <div style={{ textAlign: "center" }}>
            <div className="ic"><i className="icon-circle-check" /></div>
            <h2>Payment confirmed</h2>
            <p>{info.eventTitle} — your ticket is ready.</p>
          </div>
        ) : (
          <>
            <h2 style={{ marginBottom: 4 }}>Pay for {info.eventTitle}</h2>
            <p className="hint" style={{ margin: "0 0 18px" }}>Amount due: <b>{info.amount.toFixed(2)} OMR</b></p>
            {info.transferDetails ? (
              <pre className="marketing-text" style={{ whiteSpace: "pre-wrap" }}>{info.transferDetails}</pre>
            ) : (
              <p style={{ color: "var(--text-2)" }}>The organizer hasn't added payment instructions yet — check back shortly or contact them directly.</p>
            )}
            {info.claimedPaidAt ? (
              <p className="hint" style={{ marginTop: 16, color: "var(--accent)" }}>
                <i className="icon-clock" /> We've told the organizer you've sent this — your ticket will appear here the moment they confirm it.
              </p>
            ) : (
              <button className="btn" style={{ marginTop: 16 }} onClick={claim} disabled={claiming}>
                {claiming ? "Letting them know…" : "I've sent the payment"}
              </button>
            )}
          </>
        )}
        <button
          className="btn glass"
          style={{ maxWidth: 240, margin: "20px auto 0" }}
          onClick={() => nav(eventId ? `/e/${eventId}` : "/")}
        >
          {info?.status === "paid" ? "View ticket" : "Back to event"}
        </button>
      </div>
    </div>
  );
}
