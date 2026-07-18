// Uber-style 3D category icons — colorful glossy product renders (soft
// studio lighting, one real hue per category), generated as one sprite
// sheet, color-keyed to transparency, and sliced into per-category WebP
// assets in public/icons3d/ (~8-16KB each, 256×256 with alpha). Replaced
// the original monochrome silver/white batch per direct user request —
// same component API, so call sites didn't need to change.

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
