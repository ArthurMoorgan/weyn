import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser, useClerk } from "@clerk/react";
import { api } from "../api";
import ThemeToggle from "../components/ThemeToggle";
import Tooltip from "../components/Tooltip";

// The "proper accounts page" the Settings tab never had — Settings only
// ever showed a read-only name/email/avatar row (AccountWidget) with no way
// to actually change anything. Everything here talks straight to Clerk's
// `user` object (name, username, avatar, email, password, connected
// accounts) rather than pulling in Clerk's prebuilt <UserProfile/>: that
// component bundles its own account-deletion flow that bypasses our
// server-side cleanup (cancelling hosted events) in deleteAccount() below,
// and — like SignIn/SignUp before this page existed — is a heavy import to
// eagerly ship to every visitor. This file is lazy-loaded from main.tsx.
export default function Account() {
  const nav = useNavigate();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const fileRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [username, setUsername] = useState(user?.username || "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErr, setProfileErr] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarErr, setAvatarErr] = useState("");

  const [newEmail, setNewEmail] = useState("");
  const [emailStep, setEmailStep] = useState<"idle" | "code">("idle");
  const [emailCode, setEmailCode] = useState("");
  const [pendingEmailId, setPendingEmailId] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordErr, setPasswordErr] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [connectBusy, setConnectBusy] = useState(false);
  const [connectErr, setConnectErr] = useState("");

  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  if (!isLoaded) return <div className="route-loading" aria-busy="true" />;
  if (!user) return null;

  const hasPassword = user.passwordEnabled;
  const googleAccount = user.externalAccounts.find((a) => a.provider === "google");

  async function saveProfile() {
    setProfileBusy(true); setProfileErr(""); setProfileSaved(false);
    try {
      await user!.update({ firstName: firstName.trim(), lastName: lastName.trim(), username: username.trim() });
      setProfileSaved(true);
    } catch (e: any) {
      setProfileErr(e.errors?.[0]?.longMessage || e.message || "Couldn't save your profile.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarBusy(true); setAvatarErr("");
    try {
      await user!.setProfileImage({ file });
    } catch (err: any) {
      setAvatarErr(err.errors?.[0]?.longMessage || err.message || "Couldn't update your photo.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function startEmailChange() {
    if (!newEmail.trim()) return;
    setEmailBusy(true); setEmailErr("");
    try {
      const emailAddress = await user!.createEmailAddress({ email: newEmail.trim() });
      await emailAddress.prepareVerification({ strategy: "email_code" });
      setPendingEmailId(emailAddress.id);
      setEmailStep("code");
    } catch (e: any) {
      setEmailErr(e.errors?.[0]?.longMessage || e.message || "Couldn't start email verification.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function confirmEmailChange() {
    if (!pendingEmailId || !emailCode.trim()) return;
    setEmailBusy(true); setEmailErr("");
    try {
      const emailAddress = user!.emailAddresses.find((e) => e.id === pendingEmailId);
      if (!emailAddress) throw new Error("Verification expired — start again.");
      await emailAddress.attemptVerification({ code: emailCode.trim() });
      const oldPrimaryId = user!.primaryEmailAddressId;
      await user!.update({ primaryEmailAddressId: pendingEmailId });
      if (oldPrimaryId && oldPrimaryId !== pendingEmailId) {
        const old = user!.emailAddresses.find((e) => e.id === oldPrimaryId);
        await old?.destroy().catch(() => {});
      }
      setEmailStep("idle"); setNewEmail(""); setEmailCode(""); setPendingEmailId(null);
    } catch (e: any) {
      setEmailErr(e.errors?.[0]?.longMessage || e.message || "That code didn't work — check it and try again.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function savePassword() {
    setPasswordBusy(true); setPasswordErr(""); setPasswordSaved(false);
    try {
      await user!.updatePassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
        signOutOfOtherSessions: true,
      });
      setCurrentPassword(""); setNewPassword(""); setPasswordSaved(true);
    } catch (e: any) {
      setPasswordErr(e.errors?.[0]?.longMessage || e.message || "Couldn't update your password.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function connectGoogle() {
    setConnectBusy(true); setConnectErr("");
    try {
      const account = await user!.createExternalAccount({
        strategy: "oauth_google",
        redirectUrl: window.location.href,
      });
      const url = account.verification?.externalVerificationRedirectURL;
      if (url) window.location.href = String(url);
    } catch (e: any) {
      setConnectErr(e.errors?.[0]?.longMessage || e.message || "Couldn't connect Google.");
      setConnectBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!googleAccount) return;
    if (!confirm("Disconnect Google from your account?")) return;
    setConnectBusy(true); setConnectErr("");
    try {
      await googleAccount.destroy();
    } catch (e: any) {
      setConnectErr(e.errors?.[0]?.longMessage || e.message || "Couldn't disconnect Google.");
    } finally {
      setConnectBusy(false);
    }
  }

  async function deleteAccount() {
    if (!confirm("Delete your account? This cancels any events you're hosting and can't be undone.")) return;
    setDeleting(true); setDeleteErr("");
    try {
      await api.deleteAccount();
      await signOut();
      nav("/", { replace: true });
    } catch (e: any) {
      setDeleteErr(e.message || "Couldn't delete your account. Please try again, or contact support.");
      setDeleting(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <Tooltip text="Back"><button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><i className="icon-arrow-left" /></button></Tooltip>
        <div className="brand"><span className="en">Account</span></div>
        <div className="tb-right"><ThemeToggle /></div>
      </header>

      <div className="page-head compact">
        <h1>Your account</h1>
        <p className="sub">Manage your profile, sign-in, and security.</p>
      </div>

      <section style={{ padding: "0 var(--space-4) var(--space-2)" }}>
        <div className="date-head" style={{ padding: "var(--space-2) 0" }}><h2>Profile</h2></div>

        <div className="account-row" style={{ marginBottom: "var(--space-4)" }}>
          {user.imageUrl ? <img src={user.imageUrl} alt="" className="account-pic" /> : <i className="icon-circle-user" />}
          <div className="account-info">
            <b>{user.fullName || user.username || "You"}</b>
            <span>{user.primaryEmailAddress?.emailAddress}</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarPick} />
          <button className="btn glass" style={{ width: "auto", padding: "var(--space-2) 14px", fontSize: 13 }} disabled={avatarBusy} onClick={() => fileRef.current?.click()}>
            {avatarBusy ? "Uploading…" : "Change photo"}
          </button>
        </div>
        {avatarErr && <p className="errline">{avatarErr}</p>}

        <div className="field"><label>First name</label><input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
        <div className="field"><label>Last name</label><input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
        <div className="field"><label>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
        {profileErr && <p className="errline">{profileErr}</p>}
        {profileSaved && <p className="hint" style={{ color: "var(--success, #1a9e5c)" }}>Saved.</p>}
        <button className="btn" disabled={profileBusy} onClick={saveProfile}>{profileBusy ? "Saving…" : "Save profile"}</button>
      </section>

      <section style={{ padding: "var(--space-5) var(--space-4) var(--space-2)" }}>
        <div className="date-head" style={{ padding: "var(--space-2) 0" }}><h2>Email</h2></div>
        <p className="sub" style={{ marginBottom: "var(--space-3)" }}>Current: {user.primaryEmailAddress?.emailAddress}</p>

        {emailStep === "idle" ? (
          <>
            <div className="field"><label>New email address</label><input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@example.com" /></div>
            {emailErr && <p className="errline">{emailErr}</p>}
            <button className="btn" disabled={emailBusy || !newEmail.trim()} onClick={startEmailChange}>
              {emailBusy ? "Sending code…" : "Send verification code"}
            </button>
          </>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: "var(--space-2)" }}>We sent a code to {newEmail} — enter it below to make it your new sign-in email.</p>
            <div className="field"><label>Verification code</label><input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="123456" /></div>
            {emailErr && <p className="errline">{emailErr}</p>}
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <button className="btn" disabled={emailBusy || !emailCode.trim()} onClick={confirmEmailChange}>{emailBusy ? "Verifying…" : "Confirm"}</button>
              <button className="btn glass" disabled={emailBusy} onClick={() => { setEmailStep("idle"); setEmailCode(""); setPendingEmailId(null); }}>Cancel</button>
            </div>
          </>
        )}
      </section>

      <section style={{ padding: "var(--space-5) var(--space-4) var(--space-2)" }}>
        <div className="date-head" style={{ padding: "var(--space-2) 0" }}><h2>Password</h2></div>
        {hasPassword && <div className="field"><label>Current password</label><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></div>}
        <div className="field"><label>{hasPassword ? "New password" : "Set a password"}</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
        {passwordErr && <p className="errline">{passwordErr}</p>}
        {passwordSaved && <p className="hint" style={{ color: "var(--success, #1a9e5c)" }}>Password updated. Other devices have been signed out.</p>}
        <button className="btn" disabled={passwordBusy || !newPassword || (hasPassword && !currentPassword)} onClick={savePassword}>
          {passwordBusy ? "Updating…" : hasPassword ? "Update password" : "Set password"}
        </button>
      </section>

      <section style={{ padding: "var(--space-5) var(--space-4) var(--space-2)" }}>
        <div className="date-head" style={{ padding: "var(--space-2) 0" }}><h2>Connected accounts</h2></div>
        <div className="settings-row">
          <span><i className="icon-globe" style={{ marginRight: "var(--space-2)" }} />Google</span>
          {googleAccount ? (
            <button className="btn glass" style={{ width: "auto", padding: "var(--space-2) 14px", fontSize: 13 }} disabled={connectBusy} onClick={disconnectGoogle}>
              {connectBusy ? "…" : "Disconnect"}
            </button>
          ) : (
            <button className="btn glass" style={{ width: "auto", padding: "var(--space-2) 14px", fontSize: 13 }} disabled={connectBusy} onClick={connectGoogle}>
              {connectBusy ? "…" : "Connect"}
            </button>
          )}
        </div>
        {connectErr && <p className="errline">{connectErr}</p>}
      </section>

      <section style={{ padding: "var(--space-5) var(--space-4) var(--space-6)" }}>
        <div className="danger-zone">
          <b>Delete account</b>
          <p>Permanently deletes your account. Any events you're hosting are cancelled. This can't be undone.</p>
          {deleteErr && <p className="errline">{deleteErr}</p>}
          <button className="btn" style={{ borderColor: "var(--error)", color: "var(--error)" }} disabled={deleting} onClick={deleteAccount}>
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </section>
    </>
  );
}
