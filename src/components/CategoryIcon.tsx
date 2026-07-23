// Replaces the old Icon3D (glossy 3D per-category product renders) with a
// flat, monochrome-ink glyph — matching the coolicons pack now powering the
// rest of the app's iconography (see ikonate.css). coolicons has no
// dedicated music/sports/food/workshop icons, so those four keep the
// existing Lucide-derived glyph already in ikonate.css (a real gap in that
// specific pack, not a reason to force a wrong-metaphor substitute); "all",
// "culture" and "community" now render actual coolicons assets.
export type CategoryName =
  | "all" | "music" | "sports" | "food" | "culture" | "workshop" | "community";

const CATEGORY_ICON: Record<CategoryName, string> = {
  all: "layout-grid",
  music: "music",
  sports: "trophy",
  food: "utensils",
  culture: "palette",
  workshop: "hammer",
  community: "users",
};

export default function CategoryIcon({ name, size = 40 }: { name: CategoryName; size?: number }) {
  return (
    <span
      className={`icon-${CATEGORY_ICON[name]}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
