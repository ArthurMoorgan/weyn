import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAccount, setAccount, clearAccount } from "../store";

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || "";

declare global {
  interface Window { google?: any }
}

let scriptPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (!CLIENT_ID) return Promise.reject(new Error("no client id"));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google sign-in script failed to load"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function GoogleLoginButton() {
  const account = useAccount();
  const btnRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (account || !CLIENT_ID || !btnRef.current) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !btnRef.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async (resp: { credential: string }) => {
            try {
              const acc = await api.googleAuth(resp.credential);
              setAccount(acc, acc.sessionToken);
            } catch (e: any) {
              setErr(e.message || "Sign-in failed");
            }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, { theme: "outline", size: "medium", shape: "pill" });
      })
      .catch(() => setErr("Couldn't load Google sign-in"));
    return () => { cancelled = true; };
  }, [account]);

  if (!CLIENT_ID) {
    return (
      <p className="hint" style={{ margin: "6px 0 0" }}>
        Sign-in isn't configured yet — set <code>VITE_GOOGLE_CLIENT_ID</code> to enable Google login.
      </p>
    );
  }

  if (account) {
    return (
      <div className="account-row">
        {account.picture ? <img src={account.picture} alt="" className="account-pic" /> : <i className="ti ti-user-circle" />}
        <div className="account-info">
          <b>{account.name}</b>
          <span>{account.email}</span>
        </div>
        <button className="btn glass" style={{ width: "auto", padding: "8px 14px", fontSize: 13 }} onClick={clearAccount}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div>
      <div ref={btnRef} />
      {err && <p className="errline" style={{ marginTop: 6 }}>{err}</p>}
    </div>
  );
}
