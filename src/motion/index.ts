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

// Route-level transition for when a shared element (layoutId) can't pair up
// with the outgoing page. Opacity never moves — a clear horizontal push (the
// incoming page slides in from the right, the outgoing one slides out to the
// left, like iOS's navigation push) instead. A small vertical nudge read too
// close to a fade to register as real motion; this is unmistakably a slide.
export const pageTransition: Transition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] };
export const pageVariants: Variants = {
  initial: { x: 56 },
  animate: { x: 0 },
  exit: { x: -56 },
};

// Cross-fade + slight scale for swapping a panel's body in place (dashboard
// tab switches) — no y-translate, since the surrounding chrome (nav, header)
// stays put and only the content underneath it changes. Under reduced motion
// MotionConfig drops the scale and leaves a plain fade.
export const tabSwitchVariants: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
};

// The app shell surfacing up as the splash lifts off it — paired with the
// splash exit (index.html keyframes + splash.ts timing) so the handoff reads
// as one continuous motion rather than a hard swap. Driven with settleSpring.
export const shellEntrance: Variants = {
  hidden: { opacity: 0, scale: 0.985, y: 10 },
  shown: { opacity: 1, scale: 1, y: 0 },
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
