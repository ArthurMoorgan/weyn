import { useEffect, useState } from "react";
import { api } from "../api";
import { useAccount } from "../store";

// Follows an organizer (User.id, not display name — see schema.prisma's
// Follow comment). Renders nothing for the organizer's own event page or
// while signed out, since neither can meaningfully follow.
export default function FollowButton({ organizerId }: { organizerId: string }) {
  const account = useAccount();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account) { setFollowing(null); setCount(null); return; }
    let cancelled = false;
    api.getFollowStatus(organizerId).then((r) => {
      if (cancelled) return;
      setFollowing(r.following);
      setCount(r.followerCount);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [organizerId, account]);

  if (!account) return null;

  async function toggle() {
    setBusy(true);
    try {
      const r = following ? await api.unfollowOrganizer(organizerId) : await api.followOrganizer(organizerId);
      setFollowing(!following);
      setCount(r.followerCount);
    } catch {
      // no-op — button just stays in its previous state, safe to retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={"chip" + (following ? " on" : "")}
      onClick={toggle}
      disabled={busy || following === null}
    >
      <i className={(following ? "icon-user-check" : "icon-user-plus")} />
      {following ? "Following" : "Follow"}
      {count !== null && count > 0 ? ` · ${count}` : ""}
    </button>
  );
}
