import { useId } from "react";

// Hand-built pseudo-3D icon set — monochrome "graphite clay" renders drawn
// as layered SVG gradients (Uber-style service tiles, minus the hue). One
// consistent light source (upper-left), a soft contact shadow, silver
// top-lit faces over darker extrusion sides. Strictly greyscale so they sit
// inside the monochrome system on both themes; crisp at any size (vector),
// zero image weight, no external assets.
//
// Used on Discover's category circles and as the fallback event-cover mark
// (replacing the flat emoji glyphs that used to render there).

export type Icon3DName =
  | "all" | "music" | "sports" | "food" | "culture" | "cars" | "workshop" | "community";

// Shared material stops — a single grey family, tuned so the shapes read as
// one object under one light, not flat vector fills.
const LIT = ["#EDEDED", "#B9B9B9", "#8A8A8A"]; // top-lit face: light → mid → shaded
const SIDE = ["#5A5A5A", "#333333"]; // extrusion / side faces
const DARK = ["#4A4A4A", "#262626"]; // darker secondary object

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-lit`} x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stopColor={LIT[0]} />
        <stop offset="0.55" stopColor={LIT[1]} />
        <stop offset="1" stopColor={LIT[2]} />
      </linearGradient>
      <linearGradient id={`${id}-side`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={SIDE[0]} />
        <stop offset="1" stopColor={SIDE[1]} />
      </linearGradient>
      <linearGradient id={`${id}-dark`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor={DARK[0]} />
        <stop offset="1" stopColor={DARK[1]} />
      </linearGradient>
      {/* offset-center radial = the classic lit sphere/dome read */}
      <radialGradient id={`${id}-ball`} cx="0.32" cy="0.28" r="0.85">
        <stop offset="0" stopColor="#F2F2F2" />
        <stop offset="0.45" stopColor="#ADADAD" />
        <stop offset="1" stopColor="#5E5E5E" />
      </radialGradient>
      <radialGradient id={`${id}-ball-dark`} cx="0.32" cy="0.28" r="0.9">
        <stop offset="0" stopColor="#8F8F8F" />
        <stop offset="1" stopColor="#2E2E2E" />
      </radialGradient>
      <filter id={`${id}-blur`} x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
    </defs>
  );
}

function Shadow({ id, w = 34 }: { id: string; w?: number }) {
  return (
    <ellipse cx="32" cy="55" rx={w / 2} ry="4" fill="#000" opacity="0.28" filter={`url(#${id}-blur)`} />
  );
}

function paths(name: Icon3DName, id: string) {
  const lit = `url(#${id}-lit)`;
  const side = `url(#${id}-side)`;
  const dark = `url(#${id}-dark)`;
  const ball = `url(#${id}-ball)`;
  const ballDark = `url(#${id}-ball-dark)`;

  switch (name) {
    case "all": // 2×2 cluster of rounded tiles, one dark for depth
      return (
        <>
          <Shadow id={id} w={36} />
          <rect x="12" y="12" width="18" height="18" rx="5" fill={lit} />
          <rect x="34" y="12" width="18" height="18" rx="5" fill={dark} />
          <rect x="12" y="34" width="18" height="18" rx="5" fill={dark} />
          <rect x="34" y="34" width="18" height="18" rx="5" fill={lit} />
          <rect x="14" y="13.5" width="14" height="3.5" rx="1.75" fill="#fff" opacity="0.55" />
          <rect x="36" y="35.5" width="14" height="3.5" rx="1.75" fill="#fff" opacity="0.4" />
        </>
      );
    case "music": // headphones
      return (
        <>
          <Shadow id={id} w={34} />
          <path d="M14 40 v-6 a18 18 0 0 1 36 0 v6" fill="none" stroke={side} strokeWidth="6" strokeLinecap="round" />
          <path d="M14 39 v-5.5 a18 18 0 0 1 36 0 V39" fill="none" stroke={lit} strokeWidth="3.4" strokeLinecap="round" />
          <rect x="8" y="36" width="12" height="17" rx="6" fill={ballDark} />
          <rect x="44" y="36" width="12" height="17" rx="6" fill={ballDark} />
          <rect x="10" y="38" width="8" height="13" rx="4" fill={ball} />
          <rect x="46" y="38" width="8" height="13" rx="4" fill={ball} />
          <rect x="11.5" y="39.5" width="3" height="5" rx="1.5" fill="#fff" opacity="0.5" />
          <rect x="47.5" y="39.5" width="3" height="5" rx="1.5" fill="#fff" opacity="0.5" />
        </>
      );
    case "sports": // trophy
      return (
        <>
          <Shadow id={id} w={30} />
          <path d="M18 12 h28 v10 a14 14 0 0 1 -28 0 z" fill={lit} />
          <path d="M18 14 c-6 0 -9 4 -8 8 c1 5 5 8 10 8" fill="none" stroke={side} strokeWidth="4" strokeLinecap="round" />
          <path d="M46 14 c6 0 9 4 8 8 c-1 5 -5 8 -10 8" fill="none" stroke={side} strokeWidth="4" strokeLinecap="round" />
          <rect x="29" y="34" width="6" height="8" fill={side} />
          <path d="M22 48 a10 5 0 0 1 20 0 v3 h-20 z" fill={dark} />
          <rect x="20" y="13.5" width="10" height="4" rx="2" fill="#fff" opacity="0.5" />
        </>
      );
    case "food": // cloche + plate
      return (
        <>
          <Shadow id={id} w={42} />
          <circle cx="32" cy="18" r="3.4" fill={ball} />
          <path d="M12 44 a20 20 0 0 1 40 0 z" fill={ball} />
          <path d="M16 41 a16 16 0 0 1 12 -18" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.45" />
          <rect x="8" y="44" width="48" height="5.5" rx="2.75" fill={dark} />
        </>
      );
    case "culture": // theater mask
      return (
        <>
          <Shadow id={id} w={30} />
          <path d="M32 10 c9 3 14 3 18 1 v22 a18 20 0 0 1 -36 0 V11 c4 2 9 2 18 -1 z" fill={ball} />
          <path d="M22 26 a4.4 5 0 0 1 6.5 0" fill="none" stroke="#262626" strokeWidth="3" strokeLinecap="round" />
          <path d="M35.5 26 a4.4 5 0 0 1 6.5 0" fill="none" stroke="#262626" strokeWidth="3" strokeLinecap="round" />
          <path d="M24 38 a9.5 8 0 0 0 16 0" fill="#262626" />
        </>
      );
    case "cars": // rounded car, side view
      return (
        <>
          <Shadow id={id} w={44} />
          <path d="M10 42 v-6 c0 -3 2 -5 5 -5 l4 -1 6 -8 c1.4 -1.8 3 -2.5 5.4 -2.5 h8 c2.4 0 4.4 0.9 5.8 2.7 L50 30 c4 1 6 3 6 6.5 V42 c0 1.7 -1.3 3 -3 3 H13 c-1.7 0 -3 -1.3 -3 -3 z" fill={lit} />
          <path d="M27 22.5 h7.5 c1.5 0 2.7 0.6 3.6 1.7 L42.5 30 H24.5 l4 -6 c0.6 -1 1.4 -1.5 2.5 -1.5 z" fill={dark} transform="translate(-2 0)" />
          <circle cx="21" cy="44" r="6" fill={ballDark} />
          <circle cx="21" cy="44" r="2.6" fill={ball} />
          <circle cx="45" cy="44" r="6" fill={ballDark} />
          <circle cx="45" cy="44" r="2.6" fill={ball} />
          <rect x="14" y="33" width="12" height="3" rx="1.5" fill="#fff" opacity="0.4" />
        </>
      );
    case "workshop": // wrench, diagonal
      return (
        <>
          <Shadow id={id} w={32} />
          <g transform="rotate(43 32 32)">
            <rect x="28.5" y="18" width="7" height="30" rx="3.5" fill={side} />
            <path d="M32 6 a11 11 0 0 1 11 11 c0 3.6 -1.8 6.8 -4.5 8.8 l-13 0 C22.8 23.8 21 20.6 21 17 A11 11 0 0 1 32 6 z M27 12 v7 h10 v-7 z" fillRule="evenodd" fill={lit} />
            <circle cx="32" cy="48" r="6.5" fill={ball} />
          </g>
        </>
      );
    case "community": // two speech bubbles
      return (
        <>
          <Shadow id={id} w={38} />
          <path d="M30 14 h18 a8 8 0 0 1 8 8 v8 a8 8 0 0 1 -8 8 h-2 l1 7 -9 -7 h-8 a8 8 0 0 1 -8 -8 v-8 a8 8 0 0 1 8 -8 z" fill={dark} />
          <path d="M14 22 h18 a8 8 0 0 1 8 8 v8 a8 8 0 0 1 -8 8 h-9 l-9 7 1 -7 h-1 a8 8 0 0 1 -8 -8 v-8 a8 8 0 0 1 8 -8 z" fill={ball} />
          <circle cx="17.5" cy="30" r="2" fill="#3A3A3A" />
          <circle cx="23" cy="30" r="2" fill="#3A3A3A" />
          <circle cx="28.5" cy="30" r="2" fill="#3A3A3A" />
        </>
      );
  }
}

export default function Icon3D({ name, size = 40 }: { name: Icon3DName; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <Defs id={id} />
      {paths(name, id)}
    </svg>
  );
}
