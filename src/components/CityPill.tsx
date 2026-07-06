import { useState } from "react";

// Topbar "Muscat" pill + its info popover — shared by Explore.tsx and
// Reservations.tsx so both browse tabs get the same real behavior instead
// of one working and one being a static, non-interactive lookalike.
export default function CityPill() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="pill" onClick={() => setOpen(true)}>
        <i className="icon-map-pin" /> Muscat
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
