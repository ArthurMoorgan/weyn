import { Link } from "react-router-dom";
import { Mark } from "../components/Logo";

// Branded 404 — before this, any unknown path rendered a bare black screen
// (the route tree simply had no catch-all), which reads as a crash. Every
// dead end needs a way back.
export default function NotFound() {
  return (
    <div className="notfound">
      <Mark size={40} />
      <h1>Page not found</h1>
      <p>That link doesn't go anywhere — it may have moved or never existed.</p>
      <Link to="/" className="btn" style={{ width: "auto", padding: "12px 24px" }}>
        Back to Discover
      </Link>
    </div>
  );
}
