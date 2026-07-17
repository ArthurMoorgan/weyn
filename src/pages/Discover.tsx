import { useMemo } from "react";
import { motion, MotionConfig } from "motion/react";
import { api, CATS, type Cat, type Weyn } from "../api";
import { useAsync } from "../hooks";
import { MotionLink } from "../motion";
import HorizontalRail from "../components/HorizontalRail";
import {
  getDateNightEvents,
  getFamilyWeekendEvents,
  getStudentFriendlyEvents,
  getLuxuryEvents,
  getAdventureEvents,
  getFreeEvents,
  getHiddenGemsEvents,
} from "../components/section-helpers";

const CAT_ICON: Record<Cat | "all", string> = {
  all: "layout-grid",
  music: "music",
  sports: "trophy",
  food: "utensils",
  culture: "theater",
  workshop: "hammer",
  community: "users",
};

export default function Discover() {
  const { data: eventsData, loading } = useAsync(() => api.listEvents(), [], { cacheKey: "events:all" });
  const events: Weyn[] = eventsData || [];

  const upcomingEvents = useMemo(
    () => (events || []).filter((e) => !e.cancelled && new Date(e.startsAt).getTime() > Date.now()),
    [events]
  );

  const collections = useMemo(
    () => {
      if (!upcomingEvents) return [];
      return [
        { name: "Date Night", events: getDateNightEvents(upcomingEvents), empty: "No date night events coming up" },
        { name: "Family Weekend", events: getFamilyWeekendEvents(upcomingEvents), empty: "No family events available" },
        { name: "Student Friendly", events: getStudentFriendlyEvents(upcomingEvents), empty: "No student-friendly events available" },
        { name: "Luxury", events: getLuxuryEvents(upcomingEvents), empty: "No luxury events coming up" },
        { name: "Free", events: getFreeEvents(upcomingEvents), empty: "No free events available" },
        { name: "Adventure", events: getAdventureEvents(upcomingEvents), empty: "No adventure events coming up" },
        { name: "Hidden Gems", events: getHiddenGemsEvents(upcomingEvents), empty: "No hidden gems available" },
      ];
    },
    [upcomingEvents]
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="discover">
        {/* Category Grid */}
        <motion.div className="discover-cats" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          {CATS.map((cat) => (
            <MotionLink
              key={cat.key}
              to={`/explore?cat=${cat.key}`}
              className="discover-cat-btn"
              aria-label={cat.label}
              title={cat.label}
            >
              <div className="discover-cat-icon">
                <i className={`icon-${CAT_ICON[cat.key as Cat | "all"]}`} />
              </div>
              <span className="discover-cat-label">{cat.label}</span>
            </MotionLink>
          ))}
        </motion.div>

        {/* Collection Rails */}
        <div className="discover-collections">
          {collections.map((col, idx) => (
            <motion.div
              key={col.name}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
            >
              <HorizontalRail
                title={col.name}
                events={col.events}
                loading={loading}
                emptyMessage={col.empty}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </MotionConfig>
  );
}
