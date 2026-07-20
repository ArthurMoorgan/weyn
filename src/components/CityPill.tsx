import { useState } from "react";

// Topbar "Muscat" pill + its info popover — shared by Explore.tsx and
// Reservations.tsx so both browse tabs get the same real behavior instead
// of one working and one being a static, non-interactive lookalike.
export default function CityPill() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="loc-pill" onClick={() => setOpen(true)} aria-label="Change city">
        <span className="loc-pill-pin"><i className="icon-map-pin" /></span>
        <span className="loc-pill-text">
          <span className="loc-pill-city">Muscat <i className="icon-chevron-down" /></span>
          <span className="loc-pill-sub">Muscat, Oman</span>
        </span>
      </button>
      {open && (
        <div className="city-popover-backdrop" onClick={() => setOpen(false)}>
          <div className="city-popover" onClick={(e) => e.stopPropagation()}>
            <div className="city-popover-head">
              <i className="icon-map-pin" />
              <b>Muscat</b>
              <button className="clearx" onClick={() => setOpen(false)} aria-label="Close"><i className="icon-x" /></button>
            </div>
            <p>Weyn currently covers events and venues across Muscat only.</p>
            <p className="t-caption">More cities are coming soon.</p>
          </div>
        </div>
      )}
    </>
  );
}
