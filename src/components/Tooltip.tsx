import type { ReactNode } from "react";

// Simple CSS-only tooltip. Shown on :hover/:focus-within — no JS state, no
// positioning library. On touch devices, :hover is naturally inert, so this
// is a desktop-only enhancement and never conflicts with tap handlers on the
// wrapped trigger.
export default function Tooltip({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  return (
    <span className={className ? `tooltip-wrap ${className}` : "tooltip-wrap"}>
      {children}
      <span className="tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
