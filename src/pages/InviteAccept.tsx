import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "../store";
import AccountWidget from "../components/AccountWidget";

// Landing page for a team-invite copy-link (see server's EventTeamMember —
// Weyn has no email provider, so the organizer shares this URL themselves).
// Accepting requires being signed in; the invite is scoped to an event, not
// to matching the exact email it was addressed to.
export default function InviteAccept() {
  const { token } = useParams();
  const nav = useNavigate();
  const account = useAccount();
  const [state, setState] = useState<"idle" | "accepting" | "done" | "error">("idle");
  const [result, setResult] = useState<{ eventId: string; eventTitle: string; role: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account || !token || state !== "idle") return;
    setState("accepting");
    api.acceptInvite(token)
      .then((r) => { setResult(r); setState("done"); })
      .catch((e) => { setError(e.message || "This invite link is invalid or already used"); setState("error"); });
  }, [account, token, state]);

  return (
    <div className="detail">
      <div className="sheet glass" style={{ marginTop: 100, textAlign: "center" }}>
        {!token ? (
          <p>Missing invite link.</p>
        ) : !account ? (
          <>
            <div className="ic"><i className="icon-users-round" /></div>
            <h2>You've been invited to join an event team</h2>
            <p>Sign in to accept.</p>
            <div style={{ marginTop: 16 }}><AccountWidget /></div>
          </>
        ) : state === "accepting" ? (
          <>
            <div className="spin" />
            <p>Accepting invite…</p>
          </>
        ) : state === "done" && result ? (
          <>
            <div className="ic"><i className="icon-circle-check" /></div>
            <h2>You're in</h2>
            <p>You now have {result.role === "MANAGER" ? "manager" : "staff"} access to "{result.eventTitle}".</p>
            <button className="btn" style={{ maxWidth: 220, margin: "20px auto 0" }} onClick={() => nav("/you")}>Go to dashboard</button>
          </>
        ) : (
          <>
            <div className="ic"><i className="icon-ticket-x" /></div>
            <h2>Couldn't accept invite</h2>
            <p>{error}</p>
            <button className="btn glass" style={{ maxWidth: 220, margin: "20px auto 0" }} onClick={() => nav("/")}>Back home</button>
          </>
        )}
      </div>
    </div>
  );
}
