import { useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { api, dayLabel, timeLabel } from "../api";
import { useAsync } from "../hooks";
import { getDeviceId, useAccount } from "../store";
import Tooltip from "../components/Tooltip";

// The Editorial handoff's checkout screen: order summary, a promo code row,
// a payment section, and a sticky "Pay" footer — inserted between tier/seat
// selection (EventDetail) and the existing hosted-checkout hand-off, which
// this page still performs at the end (see api.checkoutEvent). Reached only
// for paid Weyn-hosted tickets (see EventDetail's buy button); free RSVP and
// organizer_payment keep booking directly, they never had a "checkout" step.
type CheckoutState = { tierId?: string | null; qty?: number; selectedSeatId?: string | null; inviteCode?: string };

export default function Checkout() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const account = useAccount();
  const state = (location.state || {}) as CheckoutState;
  const { data: ev, loading, error } = useAsync(() => api.getEvent(id!), [id], { cacheKey: `event:${id}` });

  const [promoInput, setPromoInput] = useState("");
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoErr, setPromoErr] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountType: "percent" | "flat"; discountValue: number } | null>(null);
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState("");

  if (loading) return <div className="route-loading" aria-busy="true" />;
  if (error || !ev) return <p className="errline" style={{ padding: 16 }}>Couldn't load this event.</p>;

  const tiers = ev.tiers || [];
  const tierId = state.tierId ?? null;
  const selectedTier = tierId ? tiers.find((t) => t.id === tierId) || null : null;
  const qty = Math.max(1, state.qty ?? 1);
  const unitPrice = selectedTier ? selectedTier.price : ev.price;

  // A direct/refreshed visit with no selection state to work from — send
  // back to the event page to pick a tier/seat rather than showing a blank
  // or wrongly-priced checkout.
  if ((tiers.length > 0 && !selectedTier) || unitPrice <= 0) {
    return (
      <div className="detail" style={{ padding: 16 }}>
        <p className="sub">Pick a ticket first.</p>
        <Link to={`/e/${ev.id}`} className="btn" style={{ marginTop: 12, width: "auto" }}>Back to event</Link>
      </div>
    );
  }

  const subtotal = +(unitPrice * qty).toFixed(2);
  const discount = appliedPromo
    ? +(appliedPromo.discountType === "percent"
        ? subtotal * (appliedPromo.discountValue / 100)
        : Math.min(subtotal, appliedPromo.discountValue * qty)
      ).toFixed(2)
    : 0;
  const discountedSubtotal = +(subtotal - discount).toFixed(2);
  const fee = +(discountedSubtotal * 0.08).toFixed(2);
  const total = +(discountedSubtotal + fee).toFixed(2);

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    setPromoApplying(true); setPromoErr("");
    try {
      const promo = await api.validatePromoCode(ev!.id, code);
      setAppliedPromo(promo);
    } catch (err: any) {
      setAppliedPromo(null);
      setPromoErr(err.message || "Invalid promo code");
    } finally {
      setPromoApplying(false);
    }
  }

  async function pay() {
    setPaying(true); setPayErr("");
    try {
      const { checkoutUrl } = await api.checkoutEvent(ev!.id, qty, getDeviceId(), account, selectedTier?.id, state.inviteCode, appliedPromo?.code);
      window.location.href = checkoutUrl;
    } catch (err: any) {
      setPayErr(err.message || "Couldn't start checkout");
      setPaying(false);
    }
  }

  return (
    <div className="detail" style={{ paddingBottom: 110 }}>
      <header className="topbar">
        <div className="brand">
          <Tooltip text="Back"><button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><i className="icon-arrow-left" /></button></Tooltip>
          <h1 style={{ font: "var(--t-section)", fontSize: 20 }}>Checkout</h1>
        </div>
      </header>

      <div className="sheet glass" style={{ marginTop: 8 }}>
        <div className="order-line">
          <div className="order-line-thumb" style={ev.image ? { backgroundImage: `url(${ev.image})` } : { background: ev.color }} />
          <div className="order-line-info">
            <b>{ev.title}</b>
            <span>{dayLabel(ev)} · {timeLabel(ev)}</span>
            <span>{ev.venue}</span>
          </div>
        </div>
        {/* Plain rows, no card/box background — pixel-checked against the
            handoff, which has no fee-box surface around these lines. */}
        <div className="checkout-lines" style={{ borderTop: "1px solid var(--hair)", paddingTop: 14, marginTop: 14 }}>
          <div className="ln"><span>{qty} × {selectedTier ? selectedTier.name : "Ticket"}</span><span>{subtotal.toFixed(2)} OMR</span></div>
          {appliedPromo && (
            <div className="ln"><span>Promo · {appliedPromo.code}</span><span>−{discount.toFixed(2)} OMR</span></div>
          )}
        </div>

        <div className="field" style={{ marginTop: 16 }}>
          {/* Handoff spec: one pill field with "Promo code" placeholder and
              an inline coral text link ("Apply") on the right — not a
              separate input + button pair. */}
          <div className="promo-row">
            <input
              value={promoInput}
              onChange={(e) => { setPromoInput(e.target.value); setPromoErr(""); }}
              placeholder="Promo code"
              disabled={!!appliedPromo}
            />
            {appliedPromo ? (
              <button type="button" className="promo-row-action" onClick={() => { setAppliedPromo(null); setPromoInput(""); }}>Remove</button>
            ) : (
              <button type="button" className="promo-row-action" onClick={applyPromo} disabled={promoApplying || !promoInput.trim()}>
                {promoApplying ? "Applying…" : "Apply"}
              </button>
            )}
          </div>
          {promoErr && <p className="errline" style={{ marginTop: 6 }}>{promoErr}</p>}
        </div>

        <h3 className="tier-picker-title" style={{ marginTop: 20 }}>Payment</h3>
        {/* No stored-card system exists yet — showing a real saved-card row
            here would be fabricated data. The buyer enters payment details
            on the hosted checkout page after tapping Pay below. */}
        <div className="payment-row">
          <i className="icon-credit-card" />
          <div>
            <b>Card, Apple Pay, or bank transfer</b>
            <span>You'll enter payment details on the next screen</span>
          </div>
        </div>

        <div className="checkout-lines" style={{ marginTop: 20 }}>
          <div className="ln"><span>Subtotal</span><span>{discountedSubtotal.toFixed(2)} OMR</span></div>
          <div className="ln"><span>Service fee</span><span>{fee.toFixed(2)} OMR</span></div>
        </div>
        {payErr && <p className="errline" style={{ marginTop: 14 }}>{payErr}</p>}
      </div>

      <div className="buybar">
        <button className="btn lg" onClick={pay} disabled={paying}>
          {paying ? "Starting checkout…" : `Pay ${total.toFixed(2)} OMR`}
        </button>
      </div>
    </div>
  );
}
