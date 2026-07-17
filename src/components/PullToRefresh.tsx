import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { motion } from "motion/react";
import { pressSpring } from "../motion";

// Pull-to-refresh threshold (px of downward drag before releasing triggers a
// reload) and the visual cap (drag resists past this so the indicator never
// runs away from the finger).
const TRIGGER_PX = 64;
const MAX_PULL_PX = 96;

interface PullToRefreshProps {
  onRefresh: () => void;
  // Mirrors the underlying useAsync's `loading` — the indicator stays spun
  // up until this flips back to false, rather than tracking its own timer.
  refreshing: boolean;
  children: ReactNode;
}

// Only wraps a downward drag starting at scroll position 0 into a refresh —
// everything else (taps on category circles, search focus, normal scrolling)
// passes straight through untouched since it's plain touchmove tracking, not
// a capture-phase listener.
export default function PullToRefresh({ onRefresh, refreshing, children }: PullToRefreshProps) {
  const [pull, setPull] = useState(0);
  const dragging = useRef(false);
  const startY = useRef(0);
  const triggered = useRef(false);

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (refreshing) return;
    // Only arm the gesture when the page is already at the very top —
    // otherwise this is just a normal scroll and must not be touched.
    if ((document.scrollingElement?.scrollTop ?? 0) > 0) return;
    dragging.current = true;
    triggered.current = false;
    startY.current = e.touches[0].clientY;
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0) { setPull(0); return; }
    // Still at the top and actively pulling down — this is our gesture, not
    // a scroll, so take it over from here.
    if ((document.scrollingElement?.scrollTop ?? 0) > 0) { dragging.current = false; setPull(0); return; }
    e.preventDefault();
    // Rubber-band past the visual cap so the indicator never trails the
    // finger indefinitely.
    setPull(Math.min(MAX_PULL_PX, dy * 0.5));
  }

  function onTouchEnd() {
    if (!dragging.current) return;
    dragging.current = false;
    if (pull >= TRIGGER_PX && !triggered.current) {
      triggered.current = true;
      onRefresh();
      setPull(TRIGGER_PX * 0.8); // settle to a steady spinner height while it loads
    } else {
      setPull(0);
    }
  }

  // Once a triggered refresh actually finishes, drop the indicator.
  useEffect(() => {
    if (!refreshing && triggered.current) {
      triggered.current = false;
      setPull(0);
    }
  }, [refreshing]);

  const showSpin = refreshing || pull >= TRIGGER_PX;

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <motion.div
        className="ptr-indicator"
        style={{ height: pull, opacity: pull > 4 ? 1 : 0 }}
        transition={pressSpring}
      >
        <div className={"spin ptr-spin" + (showSpin ? " on" : "")} />
      </motion.div>
      <motion.div animate={{ y: refreshing ? Math.min(pull, TRIGGER_PX * 0.8) : pull }} transition={pull === 0 ? pressSpring : { duration: 0 }}>
        {children}
      </motion.div>
    </div>
  );
}
