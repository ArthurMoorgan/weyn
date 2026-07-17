// Uber-style 3D category icons — real monochrome silver/white product
// renders (soft studio lighting, contact shadows), generated as one sprite
// sheet, chroma-keyed to transparency, and sliced into per-category WebP
// assets in public/icons3d/ (~8-16KB each, 256×256 with alpha).
//
// Replaces the earlier hand-drawn SVG pseudo-3D set, which read as flat
// clip-art next to the Uber reference. Same component API as before, so
// call sites (Discover's category circles, Stub's fallback event covers)
// didn't need to change.

export type Icon3DName =
  | "all" | "music" | "sports" | "food" | "culture" | "workshop" | "community";

export default function Icon3D({ name, size = 40 }: { name: Icon3DName; size?: number }) {
  return (
    <img
      src={`/icons3d/${name}.webp`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
