import { SignInButton, SignUpButton, useClerk, useUser } from "@clerk/react";
import { useAccount } from "../store";

// Replaces the old GoogleLoginButton — Clerk owns the actual sign-in/sign-up
// UI (its own hosted modal), this just renders the same account-row markup
// once signed in (so no surrounding page needed a redesign) and Clerk's
// buttons in place of the old hand-rolled Google button when signed out.
export default function AccountWidget() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const account = useAccount();

  if (user && account) {
    return (
      <div className="account-row">
        {account.picture ? <img src={account.picture} alt="" className="account-pic" /> : <i className="icon-circle-user" />}
        <div className="account-info">
          <b>{account.name}</b>
          <span>{account.email}</span>
        </div>
        <button className="btn glass" style={{ width: "auto", padding: "8px 14px", fontSize: 13 }} onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
      <SignInButton mode="modal">
        <button className="btn" style={{ width: "auto", padding: "11px 20px" }}>Sign in</button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button className="btn glass" style={{ width: "auto", padding: "11px 20px" }}>Sign up</button>
      </SignUpButton>
    </div>
  );
}
