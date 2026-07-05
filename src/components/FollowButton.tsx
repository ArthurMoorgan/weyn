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
    // Optimistic: flip the UI immediately so following feels instant, then
    // reconcile with the server's real follower count. On failure, roll
    // both fields back to exactly what they were before the click.
    const prevFollowing = following;
    const prevCount = count;
    const nextFollowing = !following;
    setFollowing(nextFollowing);
    setCount((c) => (c === null ? c : Math.max(0, c + (nextFollowing ? 1 : -1))));
    setBusy(true);
    try {
      const r = nextFollowing ? await api.followOrganizer(organizerId) : await api.unfollowOrganizer(organizerId);
      setFollowing(nextFollowing);
      setCount(r.followerCount);
    } catch {
      setFollowing(prevFollowing);
      setCount(prevCount);
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
