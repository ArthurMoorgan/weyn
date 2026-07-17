import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { api, isPast, type Weyn } from "../api";
import { useAccount } from "../store";
import { useAsync } from "../hooks";
import { getRecentlyViewed } from "../hooks/useRecentlyViewed";
import { settleSpring } from "../motion";
import HorizontalRail from "./HorizontalRail";
import FollowButton from "./FollowButton";
import { getPopularOrganizers } from "./section-helpers";

/**
 * HomeFeed — Personalized discovery sections for Explore/Discover.
 *
 * Architecture:
 * - All sections derive from one listEvents() call + optional API endpoints
 * - Sections are client-side filtered/sorted; no redundant API calls
 * - HorizontalRail is reusable for any scrollable event list section
 *
 * Current sections (✓ implemented):
 * 1. Recently Viewed — from localStorage history
 * 2. Friends Are Going — from followingFeed() API call (auth-gated)
 * 3. Popular Organizers — derived from all events (counts)
 *
 * Future sections (backend work needed — see ../../BACKEND_TODO.md):
 * - AI Recommendations: needs recommendation engine (event views, saves, follows)
 * - Because You Liked: needs saved/liked events endpoint
 * - Deep-linking: section titles clickable to filtered Search (?sort=trending, ?filter=following)
 * - Pull-to-Refresh: native iOS/Android feel via Capacitor (web version works)
 *
 * See BACKEND_TODO.md for full implementation details & priority roadmap.
 */

interface HomeFeedProps {
  events?: Weyn[];
  loading?: boolean;
  isAuthenticated?: boolean;
}

export default function HomeFeed({ events: _events, loading: _loading, isAuthenticated: _isAuthenticated }: HomeFeedProps = {}) {
  const account = useAccount();
  const [followingFeedError, setFollowingFeedError] = useState<string | null>(null);

  // Fetch all events to filter recently viewed from
  const { data: allEvents } = useAsync(
    () => api.listEvents().catch(() => []),
    [],
    { cacheKey: "all-events" }
  );

  // Fetch following feed if authenticated
  const { data: followingEvents, loading: followingLoading } = useAsync(
    async () => {
      if (!account) return [];
      try {
        const events = await api.followingFeed();
        return events.filter((e) => !e.cancelled && !isPast(e));
      } catch (error) {
        setFollowingFeedError((error as Error)?.message || "Failed to load following feed");
        return [];
      }
    },
    [account?.id],
    { cacheKey: account ? "following-feed" : undefined }
  );

  // Get recently viewed events
  const recentIds = getRecentlyViewed();
  const recentlyViewedEvents = recentIds
    .map((id) => allEvents?.find((e) => e.id === id))
    .filter((e): e is Weyn => e !== undefined && !isPast(e));

  // Derive popular organizers from all events
  const popularOrganizers = useMemo(
    () => (allEvents ? getPopularOrganizers(allEvents) : []),
    [allEvents]
  );

  // Render sections: Recently Viewed, Friends Are Going (auth-gated), then Popular Organizers
  return (
    <>
      {/* Section 0: Recently Viewed */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...settleSpring, delay: 0 * 0.05 }}
      >
        {recentlyViewedEvents.length > 0 ? (
          <HorizontalRail
            title="Recently Viewed"
            events={recentlyViewedEvents}
            emptyMessage="Events you've viewed will appear here."
          />
        ) : (
          <section className="home-feed-section">
            <div className="home-feed-title">
              <h2>Recently Viewed</h2>
            </div>
            <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-2)" }}>
              <div style={{ fontSize: 26, marginBottom: 16 }}>
                <i className="icon-history" />
              </div>
              <p>Browse events to see them here.</p>
            </div>
          </section>
        )}
      </motion.div>

      {/* TODO: Section 0.5 — AI Recommendations (placeholder)
          Stub ready; needs backend recommendation engine
          Should insert here with: delay: 0.5 * 0.05
          See BACKEND_TODO.md for engine requirements (event views, saves, follows)
      */}

      {/* Section 1: Friends Are Going */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...settleSpring, delay: 1 * 0.05 }}
      >
        {account ? (
          <HorizontalRail
            title="Friends Are Going"
            events={followingEvents || []}
            loading={followingLoading}
            emptyMessage={followingFeedError ? "Couldn't load following feed" : "Follow organizers to see their events here."}
          />
        ) : (
          <section className="home-feed-section">
            <div className="home-feed-title">
              <h2>Friends Are Going</h2>
            </div>
            <div style={{ textAlign: "center", padding: "20px", color: "var(--text-2)" }}>
              <p>Sign in to see events from organizers you follow.</p>
            </div>
          </section>
        )}
      </motion.div>

      {/* TODO: Section 1.5 — Because You Liked (optional)
          Requires: saved/liked events endpoint (GET /user/saved-events)
          Deferred until saving/likes feature is prioritized
          See BACKEND_TODO.md for full requirements
      */}

      {/* Section 2: Popular Organizers */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...settleSpring, delay: 2 * 0.05 }}
      >
        {popularOrganizers.length > 0 ? (
          <section className="home-feed-section">
            <div className="home-feed-title">
              {/* TODO: Make titles deep-linkable to filtered Search views
                  "Popular Organizers" → /search?type=organizer
                  "Recently Viewed" → filtered list view of recently-viewed
                  Requires: backend filter/type params on Search endpoint
                  See BACKEND_TODO.md "Section Title Deep-Linking"
              */}
              <h2>Popular Organizers</h2>
            </div>
            <div className="organizers-list">
              {popularOrganizers.map((org) => (
                <div key={org.name} className="organizer-item">
                  <div className="organizer-info">
                    <Link
                      to={org.ownerId ? `/organizer/${org.ownerId}` : `/?q=${encodeURIComponent(org.name)}`}
                      className="organizer-name"
                    >
                      {org.name}
                    </Link>
                    <span className="organizer-count">
                      {org.eventCount} {org.eventCount === 1 ? "event" : "events"}
                    </span>
                  </div>
                  {org.ownerId && <FollowButton organizerId={org.ownerId} />}
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="home-feed-section">
            <div className="home-feed-title">
              <h2>Popular Organizers</h2>
            </div>
            <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-2)" }}>
              <div style={{ fontSize: 26, marginBottom: 16 }}>
                <i className="icon-sparkles" />
              </div>
              <p>Top organizers will appear here.</p>
            </div>
          </section>
        )}
      </motion.div>
    </>
  );
}
