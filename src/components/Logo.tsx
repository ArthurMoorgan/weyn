// Weyn custom "W" symbol — a fine left swoosh and a bold right swoosh that
// sweeps up into a bulbous top-right head. Inherits `currentColor`.

export function Mark({ size = 26, gradient = false }: { size?: number; gradient?: boolean }) {
  const c = gradient ? "url(#weynGrad)" : "currentColor";
  return (
    <svg width={size * 1.24} height={size} viewBox="0 6 124 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {gradient && (
        <defs>
          <linearGradient id="weynGrad" x1="12" y1="12" x2="112" y2="92" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF385C" />
            <stop offset="1" stopColor="#E31C5F" />
          </linearGradient>
        </defs>
      )}
      {/* fine left swoosh */}
      <path d="M22 29 C27 52 32 67 43 72 C52 76 57 61 60 46"
        stroke={c} strokeWidth="12.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* bold right swoosh */}
      <path d="M60 46 C64 63 70 77 81 73 C93 69 98 50 101 32"
        stroke={c} strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />
      {/* bulbous head terminal */}
      <circle cx="101" cy="30" r="12.5" fill={c} />
    </svg>
  );
}

export default function Logo({ size = 26, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="logo">
      <Mark size={size} />
      {wordmark && <span className="wm">Weyn</span>}
    </span>
  );
}
