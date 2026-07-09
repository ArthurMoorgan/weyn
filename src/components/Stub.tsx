import { Link } from "react-router-dom";
import { type Weyn, ticketsLeft, isSoldOut, isTonight, dayLabel, timeLabel } from "../api";
import { isSaved, toggleSave, useSaved } from "../store";
import AvatarStack from "./AvatarStack";

// Card variants — one component, three densities, so different Explore
// sections get genuinely different visual treatments (per the design brief:
// "not every event should use the same card"):
//   list    — dense horizontal row (thumbnail + text). Default. Airbnb-search
//             density: lots of events, minimal vertical space.
//   rail    — compact vertical card for horizontal-scroll rails.
//   feature — large hero card for the Featured rail.
type Variant = "list" | "rail" | "feature";

// The trailing stop uses the theme-aware --fallback-scrim CSS var (defined in
// src/index.css for both dark/light :root blocks) instead of a hardcoded hex,
// so this reads correctly in light mode too.
function fallbackGradient(color: string): string {
  return `linear-gradient(150deg, ${color}, ${color}B0 60%, var(--fallback-scrim))`;
}

// short "going" count — only shown when it's a real signal (>0), never a
// fabricated number
function attendance(e: Weyn): string | null {
  if (!e.sold || e.sold <= 0) return null;
  if (e.sold >= 1000) return `${(e.sold / 1000).toFixed(1).replace(/\.0$/, "")}k going`;
  return `${e.sold} going`;
}

const catLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

// Quick-save heart, overlaid directly on the card — every reference app we
// looked at (dark ticketing app, minimal discovery app, Airbnb) lets you
// save from the card itself, not just the detail page. stopPropagation so
// tapping it doesn't also navigate the surrounding <Link>.
function SaveHeart({ id, className = "" }: { id: string; className?: string }) {
  useSaved();
  const saved = isSaved(id);
  return (
    <button
      className={"ec-save" + (saved ? " on" : "") + (className ? " " + className : "")}
      onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); toggleSave(id); }}
      aria-label={saved ? "Saved — tap to remove" : "Save"}
      aria-pressed={saved}
    >
      <i className="icon-heart" />
    </button>
  );
}

export default function Stub({ e, ticket = false, variant = "list" }: { e: Weyn; ticket?: boolean; variant?: Variant }) {
  const left = ticketsLeft(e);
  const out = isSoldOut(e);
  const scarce = !out && left <= 12 && e.price > 0;
  const live = isTonight(e) && new Date(e.startsAt).getTime() <= Date.now() + 90 * 60e3;
  const going = attendance(e);
  const priceText = e.price === 0 ? "Free" : `${e.price} OMR`;

  const coverStyle: React.CSSProperties = e.image
    ? { backgroundImage: `url(${e.image})`, backgroundPosition: e.imageFocalPoint || "center" }
    : { background: fallbackGradient(e.color) };

  const statusBadge = ticket ? (
    <span className="ec-badge confirmed"><i className="icon-circle-check" />{e.cancelled ? "Cancelled" : "Confirmed"}</span>
  ) : out ? (
    <span className="ec-badge out">Sold out</span>
  ) : live ? (
    <span className="ec-badge live"><span className="pulse" />Live</span>
  ) : e.featured ? (
    <span className="ec-badge featured"><i className="icon-sparkles" />Featured</span>
  ) : null;

  // ---- dense horizontal list row (default) ----
  if (variant === "list") {
    return (
      <Link to={`/e/${e.id}`} className={"ec-row" + (ticket ? " ticket" : "")}>
        <div className="ec-thumb" style={coverStyle}>{!e.image && <span className="ec-glyph">{e.glyph}</span>}</div>
        <div className="ec-main">
          <div className="ec-top">
            <span className="ec-when">{dayLabel(e)} · {timeLabel(e)}</span>
            {statusBadge}
          </div>
          <h3 className="ec-title">{e.title}</h3>
          <div className="ec-meta">
            <span>{e.venue || e.area}</span>
            <span className="ec-dot">·</span>
            <span>{catLabel(e.cat)}</span>
            {going && <><span className="ec-dot">·</span><span>{going}</span></>}
          </div>
        </div>
        <div className="ec-side">
          <span className={"ec-price" + (e.price === 0 ? " free" : "")}>{priceText}</span>
          {!ticket && !out && (
            <span className={"ec-dist" + (scarce ? " scarce" : "")}>{scarce ? `${left} left` : `${e.distanceKm} km`}</span>
          )}
          {ticket && <span className="ec-dist">{e.area}</span>}
        </div>
      </Link>
    );
  }

  // ---- compact vertical card for horizontal rails ----
  if (variant === "rail") {
    return (
      <Link to={`/e/${e.id}`} className="ec-rail">
        <div className="ec-rail-cover" style={coverStyle}>
          {statusBadge}
          <SaveHeart id={e.id} />
          {!e.image && <span className="ec-glyph">{e.glyph}</span>}
        </div>
        <h3 className="ec-title">{e.title}</h3>
        <div className="ec-meta">
          <span>{dayLabel(e)}</span>
          <span className="ec-dot">·</span>
          <span className={e.price === 0 ? "ec-price free" : "ec-price"}>{priceText}</span>
        </div>
      </Link>
    );
  }

  // ---- large featured hero card ----
  return (
    <Link to={`/e/${e.id}`} className="ec-feature">
      <div className="ec-feature-cover" style={coverStyle}>
        {statusBadge}
        <SaveHeart id={e.id} className="ec-save-lg" />
        {!e.image && <span className="ec-glyph big">{e.glyph}</span>}
        <div className="ec-feature-body">
          <div className="ec-feature-toprow">
            <span className="ec-feature-organizer">{e.organizer}</span>
            <span className="ec-feature-cat">{catLabel(e.cat)}</span>
          </div>
          <h3 className="ec-feature-title">{e.title}</h3>
          <div className="ec-feature-meta">
            <span>{dayLabel(e)} · {timeLabel(e)}</span>
            <span className="ec-dot">·</span>
            <span>{e.venue || e.area}</span>
            <span className={"ec-price ec-price-pill" + (e.price === 0 ? " free" : "")}>{priceText}</span>
          </div>
          {e.sold > 0 && (
            <div className="ec-feature-social">
              <AvatarStack seed={e.id} count={e.sold} />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
