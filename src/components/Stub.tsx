import { Link } from "react-router-dom";
import { type Weyn, ticketsLeft, isSoldOut, isTonight, dayLabel, timeLabel } from "../api";

export default function Stub({ e }: { e: Weyn }) {
  const left = ticketsLeft(e);
  const out = isSoldOut(e);
  const scarce = !out && left <= 12 && e.price > 0;
  const live = isTonight(e) && new Date(e.startsAt).getTime() <= Date.now() + 90 * 60e3;

  const coverStyle: React.CSSProperties = e.image
    ? { backgroundImage: `url(${e.image})` }
    : { background: e.color };

  return (
    <Link to={`/e/${e.id}`} className="card">
      <div className="cover" style={coverStyle}>
        {out ? (
          <span className="gbadge out">Sold out</span>
        ) : live ? (
          <span className="gbadge live"><span className="pulse" />Live now</span>
        ) : (
          <span className="gbadge">{dayLabel(e)} · {timeLabel(e)}</span>
        )}
        <span className="price-tag">{e.price === 0 ? "Free" : `${e.price} OMR`}</span>
        {!e.image && <span className="glyph">{e.glyph}</span>}
      </div>

      <div className="body">
        <div className="meta-top">{e.venue} · {e.area}</div>
        <h3>{e.title}</h3>
        <div className="row">
          {out ? (
            <span className="dist"><i className="ti ti-ticket-off" /> Sold out</span>
          ) : scarce ? (
            <span className="dist scarce"><i className="ti ti-flame" /> {left} left</span>
          ) : (
            <span className="dist"><i className="ti ti-walk" /> {e.distanceKm} km away</span>
          )}
          <span className={"cta" + (out ? " muted" : "")}>
            {out ? "Full" : e.price === 0 ? "RSVP" : "Get tickets"}
            {!out && <i className="ti ti-arrow-right" />}
          </span>
        </div>
      </div>
    </Link>
  );
}
