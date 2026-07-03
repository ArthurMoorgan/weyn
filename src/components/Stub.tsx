import { Link } from "react-router-dom";
import { type Weyn, ticketsLeft, isSoldOut, isTonight, dayLabel, timeLabel } from "../api";

// A handful of fixed gradient pairs (keyed off the event's own accent color so
// it stays deterministic per-event, not random-per-render) — used whenever
// there's no uploaded photo, instead of one flat color fill.
function fallbackGradient(color: string): string {
  return `linear-gradient(160deg, ${color}, ${color}CC 55%, #14151A66)`;
}

// `ticket`: this card represents something the viewer already booked/RSVP'd
// to (You screen), not something they're browsing — swaps the top badge for
// a confirmation chip and the CTA for "View ticket" instead of re-selling it.
export default function Stub({ e, ticket = false }: { e: Weyn; ticket?: boolean }) {
  const left = ticketsLeft(e);
  const out = isSoldOut(e);
  const scarce = !out && left <= 12 && e.price > 0;
  const live = isTonight(e) && new Date(e.startsAt).getTime() <= Date.now() + 90 * 60e3;

  const coverStyle: React.CSSProperties = e.image
    ? { backgroundImage: `url(${e.image})`, backgroundPosition: e.imageFocalPoint || "center" }
    : { background: fallbackGradient(e.color) };

  return (
    <Link to={`/e/${e.id}`} className={"card" + (ticket ? " ticket-card" : "")}>
      <div className="cover" style={coverStyle}>
        {/* only status signals live on the image — date/price/venue moved
            into the body below, per the "never place price in corners" rule */}
        <div className="cover-badges">
          {ticket ? (
            <span className="gbadge confirmed"><i className="ti ti-circle-check" />{e.cancelled ? "Cancelled" : "Confirmed"}</span>
          ) : out ? (
            <span className="gbadge out">Sold out</span>
          ) : live ? (
            <span className="gbadge live"><span className="pulse" />Live now</span>
          ) : null}
          {!ticket && e.featured && <span className="gbadge featured"><i className="ti ti-sparkles" />Featured</span>}
        </div>
        {!e.image && <span className="glyph">{e.glyph}</span>}
      </div>

      <div className="body">
        <div className="organizer-row">
          <span className="organizer-name">{e.organizer}</span>
          {e.organizerVerified && <i className="ti ti-rosette-discount-check verified-badge" title="Verified organizer" />}
        </div>
        <h3>{e.title}</h3>
        <div className="card-facts">
          <span className="cf">{dayLabel(e)} · {timeLabel(e)}</span>
          <span className="cf">{e.venue}</span>
        </div>
        <div className="row">
          {ticket ? (
            <span className="dist">{e.area}</span>
          ) : out ? (
            <span className="dist">Sold out</span>
          ) : scarce ? (
            <span className="dist scarce">{left} left</span>
          ) : (
            <span className="dist">{e.distanceKm} km away</span>
          )}
          <span className="row-right">
            <span className={"price-tag" + (e.price === 0 ? " free" : "")}>{e.price === 0 ? "Free" : `${e.price} OMR`}</span>
            <span className={"cta" + (out && !ticket ? " muted" : "")}>
              {ticket ? "View ticket" : out ? "Full" : e.price === 0 ? "RSVP" : "Get tickets"}
              <i className="ti ti-arrow-right" />
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}
