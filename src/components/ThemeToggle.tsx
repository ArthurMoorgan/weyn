import { useTheme, toggleTheme } from "../store";

export default function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button className="theme-toggle" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title="Toggle theme">
      <i className={(dark ? "icon-sun" : "icon-moon-star")} />
    </button>
  );
}
