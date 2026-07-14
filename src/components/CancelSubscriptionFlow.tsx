import { useState } from "react";
import { api, type CancelReason, type RetentionOffer } from "../api";

// Cancel flow: Trigger (SubscriptionCard's "Cancel subscription" button,
// which renders this) -> Survey -> Dynamic Offer -> Confirmation -> Done.
// Every reason is logged server-side regardless of whether the organizer is
// ultimately saved or cancels — see server/app.js's cancel/save/pause
// routes, which all write cancelReason/cancelFeedback.

const REASONS: { key: CancelReason; label: string }[] = [
  { key: "too_expensive", label: "Too expensive" },
  { key: "not_using", label: "Not using it enough" },
  { key: "missing_feature", label: "Missing a feature I need" },
  { key: "switching", label: "Switching to another tool" },
  { key: "technical_issues", label: "Technical issues / bugs" },
  { key: "temporary", label: "Temporary — don't need it right now" },
  { key: "other", label: "Other" },
];

// The dynamic save offer per reason — a discount/downgrade doesn't help
// someone who isn't using the product, and a pause doesn't help someone who
// can't afford it. "technical_issues" and "other" skip straight to
// confirmation instead of a mismatched offer.
type OfferKind = "discount" | "pause" | "feature_unlock" | "support" | "none";
const OFFER_BY_REASON: Record<CancelReason, OfferKind> = {
  too_expensive: "discount",
  switching: "discount",
  missing_feature: "feature_unlock",
  not_using: "pause",
  temporary: "pause",
  technical_issues: "support",
  other: "none",
};

type Step = "survey" | "offer" | "confirm" | "saved" | "paused" | "cancelled";

export default function CancelSubscriptionFlow({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [step, setStep] = useState<Step>("survey");
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [feedback, setFeedback] = useState("");
  const [pauseMonths, setPauseMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);

  function proceedFromSurvey() {
    if (!reason) return;
    setStep(OFFER_BY_REASON[reason] === "none" ? "confirm" : "offer");
  }

  async function acceptOffer(offer: RetentionOffer) {
    if (!reason) return;
    setBusy(true); setErr("");
    try {
      await api.acceptRetentionOffer(reason, offer, feedback || undefined);
      setStep("saved");
      onChanged();
    } catch (e: any) {
      setErr(e.message || "Couldn't apply that offer");
    } finally {
      setBusy(false);
    }
  }

  async function acceptPause() {
    if (!reason) return;
    setBusy(true); setErr("");
    try {
      await api.pauseSubscription(reason, pauseMonths, feedback || undefined);
      setStep("paused");
      onChanged();
    } catch (e: any) {
      setErr(e.message || "Couldn't pause the subscription");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!reason) return;
    setBusy(true); setErr("");
    try {
      const res = await api.cancelSubscription(reason, feedback || undefined);
      setPeriodEnd(res.currentPeriodEnd);
      setStep("cancelled");
      onChanged();
    } catch (e: any) {
      setErr(e.message || "Couldn't process the cancellation");
    } finally {
      setBusy(false);
    }
  }

  const offer = reason ? OFFER_BY_REASON[reason] : "none";

  return (
    <div className="modal-backdrop" onClick={step === "survey" ? onClose : undefined}>
      <div className="dash-card" style={{ padding: 20, maxWidth: 440, margin: "10vh auto" }} onClick={(e) => e.stopPropagation()}>
        {step === "survey" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>We're sorry to see you go</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>What's the main reason you're cancelling?</p>
            <div className="field" style={{ marginBottom: 12 }}>
              {REASONS.map((r) => (
                <label key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", cursor: "pointer" }}>
                  <input type="radio" name="cancel-reason" checked={reason === r.key} onChange={() => setReason(r.key)} style={{ width: "auto" }} />
                  <span style={{ fontSize: 14, color: "var(--text)" }}>{r.label}</span>
                </label>
              ))}
            </div>
            <div className="field">
              <label>Anything else? (optional)</label>
              <textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Tell us more…" />
            </div>
            <button className="btn" onClick={proceedFromSurvey} disabled={!reason}>Continue</button>
            <button className="btn glass" style={{ marginTop: 8 }} onClick={onClose}>Never mind, keep my subscription</button>
          </>
        )}

        {step === "offer" && offer === "discount" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>What if we could help?</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>We'd love to keep you. Here's a special offer:</p>
            {err && <p className="errline">{err}</p>}
            <div className="marketing-card" style={{ marginBottom: 14 }}>
              <div className="marketing-card-head"><b>25% off for the next 3 months</b></div>
              <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: 0 }}>Applied automatically once billing is live — no action needed after this.</p>
            </div>
            <button className="btn" onClick={() => acceptOffer("discount")} disabled={busy}>{busy ? "Applying…" : "Accept offer"}</button>
            <button className="btn glass" style={{ marginTop: 8 }} onClick={() => setStep("confirm")} disabled={busy}>No thanks, continue cancelling</button>
          </>
        )}

        {step === "offer" && offer === "pause" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>Pause instead of cancelling?</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>Your settings and data stay exactly as they are — pick back up whenever you're ready.</p>
            {err && <p className="errline">{err}</p>}
            <div className="field">
              <label>Pause for</label>
              <select value={pauseMonths} onChange={(e) => setPauseMonths(Number(e.target.value))}>
                <option value={1}>1 month</option>
                <option value={2}>2 months</option>
                <option value={3}>3 months</option>
              </select>
            </div>
            <button className="btn" onClick={acceptPause} disabled={busy}>{busy ? "Pausing…" : `Pause for ${pauseMonths} month${pauseMonths > 1 ? "s" : ""}`}</button>
            <button className="btn glass" style={{ marginTop: 8 }} onClick={() => setStep("confirm")} disabled={busy}>No thanks, continue cancelling</button>
          </>
        )}

        {step === "offer" && offer === "feature_unlock" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>Before you go</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>A lot of organizers cancel before trying everything Pro includes — want a quick tour of what you haven't used yet?</p>
            {err && <p className="errline">{err}</p>}
            <button className="btn" onClick={() => acceptOffer("feature_unlock")} disabled={busy}>{busy ? "One sec…" : "Show me what I'm missing"}</button>
            <button className="btn glass" style={{ marginTop: 8 }} onClick={() => setStep("confirm")} disabled={busy}>No thanks, continue cancelling</button>
          </>
        )}

        {step === "offer" && offer === "support" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>Let us fix this first</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>Technical issues shouldn't be why you leave — our team can look into this directly.</p>
            <a className="btn" href="mailto:support@weynevents.com" style={{ display: "block", textAlign: "center" }}>Contact support</a>
            <button className="btn glass" style={{ marginTop: 8 }} onClick={() => setStep("confirm")}>Continue cancelling anyway</button>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>Confirm cancellation</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>You'll keep Pro access until the end of your current billing period, then your plan drops to Free. You can undo this any time before then.</p>
            {err && <p className="errline">{err}</p>}
            <button className="btn" onClick={confirmCancel} disabled={busy} style={{ background: "var(--error)" }}>{busy ? "Cancelling…" : "Cancel my subscription"}</button>
            <button className="btn glass" style={{ marginTop: 8 }} onClick={onClose} disabled={busy}>Keep my subscription</button>
          </>
        )}

        {step === "saved" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>You're all set</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>Your offer has been applied — no changes to your subscription.</p>
            <button className="btn" onClick={onClose}>Done</button>
          </>
        )}

        {step === "paused" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>Subscription paused</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>You're paused for {pauseMonths} month{pauseMonths > 1 ? "s" : ""} — Pro features will come back automatically, or resume early any time from Settings.</p>
            <button className="btn" onClick={onClose}>Done</button>
          </>
        )}

        {step === "cancelled" && (
          <>
            <div className="date-head" style={{ padding: 0, marginBottom: 4 }}><h2>Subscription cancelled</h2></div>
            <p className="hint" style={{ margin: "0 0 14px" }}>
              {periodEnd ? `You'll keep Pro access until ${new Date(periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.` : "Your Pro access will end at the end of your current billing period."}
              {" "}Changed your mind? You can undo this from Settings any time before then.
            </p>
            <button className="btn" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
