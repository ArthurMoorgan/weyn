import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type BookingStatus } from "../api";
import { addTicket } from "../store";

// Thawani redirects here after payment. The redirect itself proves nothing
// (the tab could've been closed mid-flow) — the webhook is the real source
// of truth, so we poll GET /api/bookings/:id until it flips to "paid" (that
// route also re-checks Thawani directly as a fallback if the webhook never
// arrives, see server/index.js).
export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const bookingId = params.get("booking");
  const accessToken = params.get("accessToken") || undefined;
  const [status, setStatus] = useState<BookingStatus | null>(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    let tries = 0;
    const poll = async () => {
      try {
        const s = await api.getBooking(bookingId);
        if (cancelled) return;
        setStatus(s);
        if (s.status === "paid") { if (bookingId) addTicket(s.eventId, bookingId, accessToken); return; }
        if (s.status !== "pending" || ++tries >= 8) return;
        setAttempts(tries);
        setTimeout(poll, 1500);
      } catch { /* keep last known status, stop polling */ }
    };
    poll();
    return () => { cancelled = true; };
  }, [bookingId]);

  return (
    <div className="detail">
      <div className="sheet glass" style={{ marginTop: 100, textAlign: "center" }}>
        {!bookingId ? (
          <p>Missing booking reference.</p>
        ) : status?.status === "paid" ? (
          <>
            <div className="ic"><i className="icon-circle-check" /></div>
            <h2>Payment confirmed</h2>
            <p>{status.eventTitle} — your ticket is ready.</p>
          </>
        ) : status?.status === "expired" || status?.status === "cancelled" ? (
          <>
            <div className="ic"><i className="icon-ticket-x" /></div>
            <h2>Payment not completed</h2>
          </>
        ) : (
          <>
            <div className="spin" />
            <p>Confirming your payment{attempts > 0 ? "…" : ""}</p>
          </>
        )}
        <button className="btn" style={{ maxWidth: 220, margin: "20px auto 0" }} onClick={() => nav(status?.eventId ? `/e/${status.eventId}${accessToken ? `?booking=${bookingId}&accessToken=${encodeURIComponent(accessToken)}` : ""}` : "/")}>
          {status?.status === "paid" ? "View ticket" : "Back to event"}
        </button>
      </div>
    </div>
  );
}
