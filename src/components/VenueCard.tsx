import { Link } from "react-router-dom";
import type { Venue } from "../api";

const CATEGORY_LABEL: Record<Venue["category"], string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  lounge: "Lounge",
  rooftop: "Rooftop",
  beach_club: "Beach Club",
  experience: "Experience",
};

// Grid card for the Reservations venue browser — mirrors Stub.tsx's
// rail-card visual language (cover image, badges over the image, meta row
// below) but as its own component since venues have different fields
// (area/price range/tags) than events.
export default function VenueCard({ venue }: { venue: Venue }) {
  const cover = venue.coverImage || venue.photos?.[0] || null;
  const coverStyle: React.CSSProperties = cover
    ? { backgroundImage: `url(${cover})` }
    : { background: "var(--surface-2)" };

  return (
    <Link to={`/reservations/${venue.id}`} className="ec-rail venue-card">
      <div className="ec-rail-cover" style={coverStyle}>
        {venue.verified && (
          <span className="ec-badge confirmed venue-verified"><i className="icon-badge-check" /> Verified</span>
        )}
        {!cover && <span className="ec-glyph"><i className="icon-map-pin" /></span>}
      </div>
      <h3 className="ec-title">{venue.name}</h3>
      <div className="ec-meta">
        <span className="catpill venue-catpill">{CATEGORY_LABEL[venue.category]}</span>
        <span className="ec-dot">·</span>
        <span>{venue.area}</span>
        <span className="ec-dot">·</span>
        <span>{venue.priceRange}</span>
      </div>
    </Link>
  );
}
