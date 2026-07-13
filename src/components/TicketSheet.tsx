import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api";
import { useClosing } from "../hooks";

// The one thing every ticketing app needs and this one didn't have: a place
// to actually SEE a ticket after booking. Free RSVP and paid checkout both
// issue real Ticket rows with a scannable code server-side (GET
// /api/bookings/:id/tickets), but nothing in the client ever rendered them —
// bookingId/accessToken were captured and then discarded. This is the
// missing terminal state for both booking flows.
type TicketRow = { code: string; checkedInAt: string | null };

export default function TicketSheet({
  eventTitle, bookingId, accessToken, venue, lat, lng, onClose,
}: { eventTitle: string; bookingId: string; accessToken?: string; venue?: string; lat?: number; lng?: number; onClose: () => void }) {
  const { closing, close } = useClosing(onClose);
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [walletToast, setWalletToast] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getBookingTickets(bookingId, accessToken)
      .then(async (rows) => {
        if (cancelled) return;
        setTickets(rows);
        const entries = await Promise.all(
          rows.map(async (t) => [t.code, await QRCode.toDataURL(t.code, { margin: 1, width: 320 })] as const)
        );
        if (!cancelled) setQrDataUrls(Object.fromEntries(entries));
      })
      .catch((e) => !cancelled && setErr(e.message || "Couldn't load your ticket."));
    return () => { cancelled = true; };
  }, [bookingId, accessToken]);

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>{eventTitle}</h3>
        <p className="sub" style={{ marginBottom: 16 }}>Show this at the door</p>

        {err && <p className="errline">{err}</p>}

        {!err && tickets === null && (
          <div className="detail-skel-cover" style={{ height: 200, borderRadius: 12, margin: "0 auto" }} />
        )}

        {tickets?.map((t) => (
          <div key={t.code} className="ticket-qr-card">
            {qrDataUrls[t.code] ? (
              <div className="qr-sticker">
                <img src={qrDataUrls[t.code]} alt="Ticket QR code" width={220} height={220} />
              </div>
            ) : (
              <div className="detail-skel-cover" style={{ height: 220, width: 220, borderRadius: 12, margin: "0 auto" }} />
            )}
            <div className="ticket-qr-code">{t.code}</div>
            {t.checkedInAt ? (
              <span className="ec-badge confirmed"><i className="icon-circle-check" /> Checked in</span>
            ) : (
              <span className="ec-badge featured"><i className="icon-ticket" /> Valid</span>
            )}
          </div>
        ))}

        {tickets && !err && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              className="btn"
              onClick={() => { setWalletToast(true); setTimeout(() => setWalletToast(false), 2200); }}
            >
              <i className="icon-wallet" /> Add to Wallet
            </button>
            {typeof lat === "number" && typeof lng === "number" && (
              <a
                className="btn glass"
                href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                target="_blank"
                rel="noreferrer"
                aria-label={venue ? `Directions to ${venue}` : "Directions"}
              >
                <i className="icon-map-pin" /> Directions
              </a>
            )}
          </div>
        )}

        {walletToast && <div className="toast"><i className="icon-info" /> Wallet passes are coming soon</div>}

        <button className="btn glass" style={{ marginTop: 8 }} onClick={close}>Close</button>
      </div>
    </div>
  );
}
