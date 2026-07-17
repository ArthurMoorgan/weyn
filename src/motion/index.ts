import { useEffect, useState } from "react";
import type { Transition, Variants } from "motion/react";

// Capacitor's WKWebView/Chromium both implement matchMedia fine, but this
// still guards the SSR-less-but-module-eval-before-mount edge (module import
// order, tests) the same way store.ts guards `window` — cheap and matches
// house style rather than assuming a browser global is always present.
const QUERY = "(prefers-reduced-motion: reduce)";

// Subscribes to the OS-level reduced-motion setting so components (and the
// root MotionConfig in main.tsx) can react to it live if the user flips it
// mid-session, not just at first paint.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(QUERY).matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

// Snappy, interruptible — for anything driven by a press/tap (buttons,
// cards, the Pressable primitive).
export const pressSpring: Transition = { type: "spring", stiffness: 420, damping: 28 };

// Softer/slower — for content revealing itself (cards entering a list,
// sheets settling into place) rather than responding to a gesture.
export const settleSpring: Transition = { type: "spring", stiffness: 260, damping: 30 };

// Fade + slight scale/translate for route-level transitions when a shared
// element (layoutId) can't pair up with the outgoing page.
export const pageTransition: Transition = { duration: 0.22, ease: [0.4, 0, 0.2, 1] };
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.99 },
};

// Stagger a list's children in after the container mounts — e.g. Explore's
// event feed.
export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
};
export const staggerChild: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: settleSpring },
};

export { MotionButton, MotionNavLink, MotionLink, usePressable } from "./Pressable";
