// Weyn's signature loading animation — the same "W" swoosh mark used as
// the logo (see Logo.tsx's <Mark/>), but drawn with a live coral gradient
// and a continuous "flowing ink" stroke animation instead of sitting
// static. This is what should render anywhere the app is waiting on
// something (see .route-loading in index.css) instead of a blank box or a
// generic spinner — one reusable, on-brand loading moment everywhere.
export default function LoadingMark({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size * 1.24}
      height={size}
      viewBox="0 6 124 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="loading-mark"
      role="img"
      aria-label="Loading"
    >
      <defs>
        <linearGradient id="loadingMarkGrad" x1="12" y1="12" x2="112" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9C3D2A" />
          <stop offset="55%" stopColor="#C1503A" />
          <stop offset="100%" stopColor="#D2634C" />
        </linearGradient>
      </defs>
      <path
        className="loading-mark-stroke loading-mark-stroke-1"
        d="M22 29 C27 52 32 67 43 72 C52 76 57 61 60 46"
        stroke="url(#loadingMarkGrad)" strokeWidth="12.5" strokeLinecap="round" strokeLinejoin="round"
        pathLength={1}
      />
      <path
        className="loading-mark-stroke loading-mark-stroke-2"
        d="M60 46 C64 63 70 77 81 73 C93 69 98 50 101 32"
        stroke="url(#loadingMarkGrad)" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round"
        pathLength={1}
      />
      <circle className="loading-mark-dot" cx="101" cy="30" r="12.5" fill="url(#loadingMarkGrad)" />
    </svg>
  );
}
