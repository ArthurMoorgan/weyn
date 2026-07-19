import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// Sticky top bar for pushed pages (Tickets / You). With the mobile bottom
// tab bar gone (nav lives in the home hub), these pages are reached from the
// home top strip and need their own way back — so a back-to-home control sits
// on the left, the page's own action (usually the avatar) on the right. Pass
// `back={false}` for a genuine root screen that shouldn't offer one.
export default function PageTopBar({ children, back = true }: { children?: ReactNode; back?: boolean }) {
  return (
    <div className="page-top-bar">
      {back ? (
        <Link to="/" className="page-top-back" aria-label="Back to home">
          <i className="icon-arrow-left" />
        </Link>
      ) : <span />}
      {children}
    </div>
  );
}
