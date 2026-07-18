import { motion } from "motion/react";
import { type Weyn } from "../api";
import Stub from "./Stub";

interface HorizontalRailProps {
  title: string;
  count?: number;
  events: Weyn[];
  loading?: boolean;
  emptyMessage: string;
  renderItem?: (event: Weyn, index: number) => React.ReactNode;
}

export default function HorizontalRail({
  title,
  count,
  events,
  loading = false,
  emptyMessage,
  renderItem,
}: HorizontalRailProps) {
  return (
    <section className="home-feed-section">
      <div className="home-feed-title">
        <h2>{title}</h2>
        {count !== undefined && <span className="ex-sub">{count} found</span>}
      </div>

      {loading ? (
        <div className="horizontal-rail">
          {Array.from({ length: 4 }).map((_, i) => (
            <motion.div key={i} style={{ opacity: 0.5, flex: "0 0 auto" }}>
              <Stub e={stubPlaceholder} variant="rail" />
            </motion.div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 16px", color: "var(--text-2)" }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>
            <i className="icon-inbox" />
          </div>
          <p style={{ margin: 0, fontSize: 14 }}>{emptyMessage}</p>
        </div>
      ) : (
        <div className="horizontal-rail">
          {events.map((event, index) =>
            renderItem ? (
              <motion.div key={event.id} style={{ flex: "0 0 auto" }}>
                {renderItem(event, index)}
              </motion.div>
            ) : (
              <motion.div key={event.id} style={{ flex: "0 0 auto" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                <Stub e={event} variant="rail" />
              </motion.div>
            )
          )}
        </div>
      )}
    </section>
  );
}

// Placeholder event for skeleton loading — using minimal valid shape
// to avoid runtime errors.
const stubPlaceholder: Weyn = {
  id: "placeholder",
  title: "Loading...",
  organizer: "",
  cat: "music",
  startsAt: new Date().toISOString(),
  endsAt: null,
  venue: "",
  area: "",
  lat: 0,
  lng: 0,
  distanceKm: 0,
  price: 0,
  capacity: 0,
  sold: 0,
  image: null,
  color: "#3A3A3A", // mirrors tokens.css's --cat-music; unused for styling (see Stub.tsx's greyscale-system note), placeholder-shape only
  glyph: "music",
  blurb: "",
  tags: [],
  refundPolicy: "",
  minAge: 0,
  ticketingType: "weyn",
  externalTicketUrl: null,
  organizerContact: null,
};
