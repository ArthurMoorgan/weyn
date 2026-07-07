import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "../store";
import ThemeToggle from "../components/ThemeToggle";
import Tooltip from "../components/Tooltip";

// A real support surface — the app previously had none at all: no FAQ, no
// contact path, nothing but a single "Flagged — contact support" label on
// You.tsx with no page for that label to point to. FAQ answers real
// questions this app's own flows raise (tickets/QR, refunds, venue
// applications, account deletion) rather than generic boilerplate.
const FAQ: { q: string; a: string }[] = [
  { q: "Where's my ticket / QR code?", a: "Open the event from My Tickets on your Profile tab — your ticket and its QR code are shown there once your booking is confirmed." },
  { q: "Can I get a refund?", a: "Refund policy is set per event by the organizer and shown on the event page before you book. For a specific booking, contact us below with your booking reference and we'll help." },
  { q: "I applied to host a venue — how long does review take?", a: "Every venue application is checked by hand before it goes live, usually within a few business days. You'll get an email (and a notification, if enabled) the moment it's approved." },
  { q: "How do I delete my account?", a: "Go to Profile → Settings → Manage account → Delete account. This is permanent — it cancels any events you're hosting and can't be undone." },
  { q: "An event I'm going to got cancelled — now what?", a: "You'll see a \"Cancelled\" badge on that event and, if you paid, a refund is processed automatically. Reach out below if you don't see it within a few days." },
];

export default function Support() {
  const nav = useNavigate();
  const account = useAccount();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (!subject.trim() || !message.trim()) return;
    setBusy(true); setErr("");
    try {
      await api.contactSupport({ subject: subject.trim(), message: message.trim() });
      setSent(true);
    } catch (e: any) {
      setErr(e.message || "Couldn't send your message. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <Tooltip text="Back"><button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><i className="icon-arrow-left" /></button></Tooltip>
        <div className="brand"><span className="en">Support</span></div>
        <div className="tb-right"><ThemeToggle /></div>
      </header>

      <div className="page-head compact">
        <h1>How can we help?</h1>
        <p className="sub">Answers to common questions, or reach the Weyn team directly.</p>
      </div>

      <section style={{ padding: "0 16px" }}>
        <div className="date-head" style={{ padding: "8px 0" }}><h2>Frequently asked</h2></div>
        <div className="faq-list">
          {FAQ.map((f, i) => (
            <details key={i} className="faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section style={{ padding: "20px 16px 32px" }}>
        <div className="date-head" style={{ padding: "8px 0" }}><h2>Contact us</h2></div>
        {sent ? (
          <div className="onboard-cta">
            <b>Message sent</b>
            <span>We'll get back to you at {account?.email || "your email"} as soon as we can.</span>
          </div>
        ) : (
          <>
            <div className="field">
              <label>Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's this about?" />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what's going on — include a booking reference or venue name if relevant." />
            </div>
            {err && <p className="errline">{err}</p>}
            <button className="btn lg" disabled={busy || !subject.trim() || !message.trim()} onClick={send}>
              {busy ? "Sending…" : "Send message"}
            </button>
            <p className="sub" style={{ marginTop: 10 }}>
              Prefer email? Write to <a href="mailto:support@weynevents.com">support@weynevents.com</a> directly.
            </p>
          </>
        )}
      </section>
    </>
  );
}
