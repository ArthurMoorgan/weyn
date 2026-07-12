import { useTheme, toggleTheme } from "../store";

// A physical sliding pill switch, not an icon button — per the design
// handoff's skeuomorphic-details spec: inset track (looks pressed in), a
// glossy circular thumb that slides between the two ends, sun/moon icons
// crossfading underneath it as it passes.
export default function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      data-on={dark}
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title="Toggle theme"
    >
      <span className="theme-toggle-track">
        <i className="icon-sun theme-toggle-ic sun" />
        <i className="icon-moon-star theme-toggle-ic moon" />
        <span className="theme-toggle-thumb" />
      </span>
    </button>
  );
}
