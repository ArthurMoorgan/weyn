import type { ReactNode } from "react";

// Lightweight sticky top bar mounted on Discover/Tickets/You pages to carry
// the UserAvatar now that /you is gone from the bottom tab bar.
export default function PageTopBar({ children }: { children: ReactNode }) {
  return (
    <div className="page-top-bar">
      {children}
    </div>
  );
}
