import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useClosing } from "../hooks";
import { MotionButton, settleSpring, usePrefersReducedMotion } from "../motion";
import { type Weyn } from "../api";

export default function EventPinSheet({
  event,
  open,
  onClose,
}: {
  event: Weyn | null;
  open: boolean;
  onClose: () => void;
}) {
  const { closing, close } = useClosing(onClose);
  const reducedMotion = usePrefersReducedMotion();
  const morphTransition = reducedMotion ? { duration: 0 } : settleSpring;

  // Close on ESC key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {open && event && (
        <motion.div
          key={`event-pin-${event.id}`}
          className={"sheet-backdrop" + (closing ? " closing" : "")}
          onClick={close}
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={morphTransition}
        >
          <motion.div
            className={"install-sheet glass" + (closing ? " closing" : "")}
            onClick={(e) => e.stopPropagation()}
            initial={reducedMotion ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={morphTransition}
          >
            <h3 style={{ marginBottom: 8 }}>{event.title}</h3>
            <p className="sub" style={{ marginBottom: 12 }}>
              {event.venue}
            </p>

            <div
              style={{
                padding: "12px",
                marginBottom: 16,
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                borderRadius: 8,
              }}
            >
              <p style={{ marginBottom: 8, fontSize: "0.9em" }}>
                {event.blurb}
              </p>
              {event.price > 0 && (
                <p style={{ marginTop: 8, fontWeight: 500 }}>
                  {event.price} OMR · {event.capacity - event.sold} spots left
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
              <a
                className="btn"
                href={`https://maps.google.com/dir?destination=${event.lat},${event.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                <i className="icon-map-pin" /> Get Directions
              </a>
              <a className="btn glass" href={`/e/${event.id}`}>
                <i className="icon-arrow-right" /> View Event
              </a>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
