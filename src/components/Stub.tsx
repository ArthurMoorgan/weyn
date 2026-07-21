import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { type Weyn, ticketsLeft, isSoldOut, isTonight, dayLabel, timeLabel } from "../api";
import { isSaved, toggleSave, useSaved } from "../store";
import { preloadEventDetail } from "../eventDetailChunk";
import { usePrefersReducedMotion, pressSpring } from "../motion";
import Icon3D from "./Icon3D";

// The whole card is tappable, so the card itself is the press target — a
// subtle shrink-on-press (much gentler than a button's 0.94, since a big
// editorial surface shouldn't leap around) makes every event card across the
// app — Explore, Search, Saved, Tickets — feel alive under the finger. The
// layoutId cover-morph lives on the inner motion.div, independent of this.
const MotionLink = motion.create(Link);

// Card variants — one component, four densities, so different surfaces get
// genuinely different visual treatments:
//   list    — dense horizontal row (thumbnail + text). Default. Airbnb-search
//             density: search results, tickets, saved lists.
//   card    — full-width editorial card (16:9 image on top, text below) —
//             the Explore list's unit. Image-forward without overlaying
//             text on the photo, so every cover reads clean regardless of
//             how busy the photo is.
//   rail    — compact vertical card for horizontal-scroll rails.
//   feature — large hero card (text overlaid on a scrimmed cover) for the
//             Featured rail / mobile spotlight.
type Variant = "list" | "card" | "rail" | "feature";

// Monochrome fallback covers: the server still stores a per-event hue in
// e.color, but the greyscale system ignores it — covers without photos get
// the category's grey (--cat-* tokens, all de-hued) with a soft diagonal
// ramp so the surface still reads as lit, not flat.
function fallbackGradient(cat: string): string {
  return `linear-gradient(150deg, var(--cat-${cat}, #3A3A3A), var(--fallback-scrim))`;
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
  const priceText = e.price === 0 ? "Free" : `${e.price} OMR`;

  const coverStyle: React.CSSProperties = e.image
    ? { backgroundImage: `url(${e.image})`, backgroundPosition: e.imageFocalPoint || "center" }
    : { background: fallbackGradient(e.cat) };

  // Warm the EventDetail chunk the instant this card is pressed or hovered,
  // so its hero (the layoutId morph target) is mounted in time for the
  // shared-element transition — spread onto every /e/:id <Link> below.
  const preload = { onPointerDown: preloadEventDetail, onMouseEnter: preloadEventDetail };

  // Press feedback, OS-reduced-motion aware (MotionConfig can't neutralize a
  // literal whileTap scale — same reason usePressable checks the hook).
  const reduced = usePrefersReducedMotion();
  const press = reduced ? {} : { whileTap: { scale: 0.985 }, transition: pressSpring };

  // Build status badges array: primary status (ticket/sold/live/featured) first,
  // then secondary signals (verified, selling-fast, only-X-left).
  const badges: React.ReactNode[] = [];

  if (ticket) {
    badges.push(
      <span key="ticket" className="ec-badge confirmed"><i className="icon-circle-check" />{e.cancelled ? "Cancelled" : "Confirmed"}</span>
    );
  } else if (out) {
    badges.push(
      <span key="sold" className="ec-badge out">Sold out</span>
    );
  } else if (live) {
    badges.push(
      <span key="live" className="ec-badge live"><span className="pulse" />Live</span>
    );
  } else if (e.featured) {
    badges.push(
      <span key="featured" className="ec-badge featured"><i className="icon-sparkles" />Featured</span>
    );
  }

  // Secondary badges (only if not ticket, not sold, not live)
  if (!ticket && !out && !live) {
    if (e.organizerVerified) {
      badges.push(
        <span key="verified" className="ec-badge verified"><i className="icon-badge-check" />Verified</span>
      );
    }
    if (left > 5 && left <= 20) {
      badges.push(
        <span key="selling-fast" className="ec-badge selling-fast"><span className="pulse" /><i className="icon-zap" />Selling fast</span>
      );
    }
    if (left > 0 && left <= 5) {
      badges.push(
        <span key="only-left" className="ec-badge only-left"><span className="pulse" /><i className="icon-warning" />{left} left</span>
      );
    }
  }

  // For list variant, render primary badge only in the text area
  const listBadge = variant === "list" ? badges[0] : null;

  // For cover variants (card/rail/feature), render all badges in a badge group
  const coverBadges = variant !== "list" && badges.length > 0 ? (
    <div className="ec-badge-group">{badges}</div>
  ) : null;

  // ---- dense horizontal list row (default) ----
  if (variant === "list") {
    return (
      <MotionLink to={`/e/${e.id}`} {...preload} {...press} className={"ec-row" + (ticket ? " ticket" : "")}>
        <motion.div layoutId={`event-cover-${e.id}`} className="ec-thumb" style={coverStyle}>{!e.image && <span className="ec-glyph"><Icon3D name={e.cat} size={48} /></span>}</motion.div>
        <div className="ec-main">
          <div className="ec-top">
            <span className="ec-when">{dayLabel(e)} · {timeLabel(e)}</span>
            {listBadge}
          </div>
          <h3 className="ec-title">{e.title}</h3>
          <div className="ec-meta">
            <span>{e.venue || e.area}</span>
            <span className="ec-dot">·</span>
            <span>{catLabel(e.cat)}</span>
          </div>
        </div>
        <div className="ec-side">
          <span className={"ec-price" + (e.price === 0 ? " free" : "")}>{priceText}</span>
          {!ticket && !out && (
            <span className={"ec-dist" + (scarce ? " scarce" : "")}>{scarce ? `${left} left` : `${e.distanceKm} km`}</span>
          )}
          {ticket && <span className="ec-dist">{e.area}</span>}
        </div>
      </MotionLink>
    );
  }

  // ---- full-width editorial card (image top, text below) ----
  if (variant === "card") {
    return (
      <MotionLink to={`/e/${e.id}`} {...preload} {...press} className="ec-card">
        <motion.div layoutId={`event-cover-${e.id}`} className="ec-card-cover" style={coverStyle}>
          {coverBadges}
          <SaveHeart id={e.id} />
          {!e.image && <span className="ec-glyph big"><Icon3D name={e.cat} size={76} /></span>}
          {scarce && <span className="ec-card-scarce">{left} left</span>}
        </motion.div>
        <div className="ec-card-body">
          <span className="ec-when">{dayLabel(e)} · {timeLabel(e)}</span>
          <h3 className="ec-title">{e.title}</h3>
          <div className="ec-meta">
            <span>{e.venue || e.area}</span>
            <span className="ec-dot">·</span>
            <span>{catLabel(e.cat)}</span>
            <span className={"ec-price" + (e.price === 0 ? " free" : "")}>{priceText}</span>
          </div>
        </div>
      </MotionLink>
    );
  }

  // ---- compact vertical card for horizontal rails ----
  if (variant === "rail") {
    return (
      <MotionLink to={`/e/${e.id}`} {...preload} {...press} className="ec-rail">
        <motion.div layoutId={`event-cover-${e.id}`} className="ec-rail-cover" style={coverStyle}>
          {coverBadges}
          <SaveHeart id={e.id} />
          {!e.image && <span className="ec-glyph"><Icon3D name={e.cat} size={48} /></span>}
        </motion.div>
        <h3 className="ec-title">{e.title}</h3>
        <div className="ec-meta">
          <span>{dayLabel(e)}</span>
          <span className="ec-dot">·</span>
          <span className={e.price === 0 ? "ec-price free" : "ec-price"}>{priceText}</span>
        </div>
      </MotionLink>
    );
  }

  // ---- large featured hero card ----
  return (
    <MotionLink to={`/e/${e.id}`} {...preload} {...press} className="ec-feature">
      <motion.div layoutId={`event-cover-${e.id}`} className="ec-feature-cover" style={coverStyle}>
        {coverBadges}
        <SaveHeart id={e.id} className="ec-save-lg" />
        {!e.image && <span className="ec-glyph big"><Icon3D name={e.cat} size={76} /></span>}
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
        </div>
      </motion.div>
    </MotionLink>
  );
}
