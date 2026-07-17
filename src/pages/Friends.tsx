import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type FollowingUser } from "../api";
import { useAsync } from "../hooks";
import ThemeToggle from "../components/ThemeToggle";

export default function Friends() {
  const { data, loading, reload } = useAsync(() => api.getFollowingList(), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function unfollow(userId: string) {
    setBusy(userId);
    try {
      await api.unfollowUser(userId);
      reload();
    } catch (e) {
      console.error("Failed to unfollow:", e);
    } finally {
      setBusy(null);
    }
  }

  const list = data || [];

  return (
    <>
      <header className="topbar">
        <Link to="/you" className="topbar-back"><i className="icon-chevron-left" /></Link>
        <div className="brand"><span className="en">Friends</span></div>
        <div className="tb-right">
          <ThemeToggle />
        </div>
      </header>

      <div className="page-head">
        <h1>People you follow</h1>
        <p className="sub">{list.length === 0 ? "No one yet" : `${list.length} person${list.length === 1 ? "" : "s"}`}</p>
      </div>

      {loading && (
        <div style={{ padding: "0 16px" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 0",
              borderBottom: "1px solid var(--border)",
            }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "var(--border)",
                flexShrink: 0,
                animation: "pulse 2s infinite",
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  height: 16,
                  background: "var(--border)",
                  borderRadius: 4,
                  marginBottom: 8,
                  animation: "pulse 2s infinite",
                }} />
                <div style={{
                  height: 12,
                  background: "var(--border)",
                  borderRadius: 4,
                  width: "70%",
                  animation: "pulse 2s infinite",
                }} />
              </div>
              <div style={{
                width: 100,
                height: 32,
                background: "var(--border)",
                borderRadius: 6,
                flexShrink: 0,
                animation: "pulse 2s infinite",
              }} />
            </div>
          ))}
        </div>
      )}

      {!loading && list.length > 0 && (
        <div style={{ padding: "0 16px" }}>
          {list.map((user) => (
            <FriendItem
              key={user.id}
              user={user}
              onUnfollow={() => unfollow(user.id)}
              busy={busy === user.id}
            />
          ))}
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="empty">
          <div className="ic"><i className="icon-user" /></div>
          <p>
            <b style={{ color: "var(--text)" }}>No one yet.</b><br />
            Find friends on event detail or organizer pages.
          </p>
        </div>
      )}
    </>
  );
}

function FriendItem({ user, onUnfollow, busy }: {
  user: FollowingUser;
  onUnfollow: () => void;
  busy: boolean;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 0",
      borderBottom: "1px solid var(--border)",
    }}>
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.name}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
      ) : (
        <div style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-2)",
          flexShrink: 0,
        }}>
          <i className="icon-user" />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 500 }}>{user.name}</p>
        <p style={{
          margin: "4px 0 0",
          fontSize: 13,
          color: "var(--text-2)",
        }}>
          {user.followerCount} {user.followerCount === 1 ? "follower" : "followers"}
        </p>
      </div>

      <button
        onClick={onUnfollow}
        disabled={busy}
        className="chip on"
        style={{ flexShrink: 0 }}
      >
        <i className="icon-user-check" />
        Unfollow
      </button>
    </div>
  );
}
