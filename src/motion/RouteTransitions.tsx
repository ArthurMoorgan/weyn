import { Suspense, type ReactNode } from "react";
import { Routes, useLocation } from "react-router-dom";
import { AnimatePresence, LayoutGroup, motion, type Variants } from "motion/react";
import { pageTransition, pageVariants, usePrefersReducedMotion } from "./index";
import PageLoadBar from "./PageLoadBar";
import Skeleton from "../components/Skeleton";

// The 3 bottom-tab pages (Discover/Tickets/You) — plus every drilled subpage
// and the /organizer and /venue-os dashboards — all render through the SAME
// persistent <App/> layout, which display-toggles the tabs via .tab-page CSS
// instead of remounting them. So all of those paths collapse to one shared
// "shell" key here, which does two things:
//   1. Switching among the tabs (or drilling in) never re-keys the motion.div,
//      so the page transition doesn't fire and double-animate against the
//      .tab-page CSS — the CSS owns that motion.
//   2. <App/> (and OrganizerLayout, which refetches on mount) stays mounted
//      across all its child routes, exactly mirroring React Router's own
//      layout-route boundary — so no warm tab-page is thrown away and no
//      dashboard skeleton flashes on an intra-shell navigation.
// Only leaving the shell for a standalone page (/e/:id, /checkout/*, …), or
// moving between two standalone pages, re-keys the wrapper and animates. The
// intra-shell transitions (drill-in, organizer section→section) are the job
// of a nested <AnimatePresence> around those layouts' own <Outlet/>, where the
// swapped content isn't persistent.
// /venues and /host/events used to be here (a bare tab-swap, no page
// transition) — both are now reached by tapping a home-hub tile and should
// get a real page transition + the tapped icon's layoutId morph into the
// destination's header, so they're normal re-keyed routes like any other.
const SHELL_EXACT = new Set(["/", "/tickets", "/you", "/concierge", "/saved", "/host/venue", "/admin"]);
// Everything under /organizer/* is a shell dashboard route EXCEPT
// /organizer/:id (a public profile), which is a standalone page — same
// static-segment-vs-dynamic split main.tsx's route table relies on.
const ORG_SECTIONS = new Set(["events", "attendees", "marketing", "workflows", "ai-studio", "settings"]);

function routeGroupKey(pathname: string): string {
  const shell =
    SHELL_EXACT.has(pathname) ||
    pathname === "/organizer" ||
    pathname === "/venue-os" ||
    pathname.startsWith("/venue-os/") ||
    (pathname.startsWith("/organizer/") && ORG_SECTIONS.has(pathname.split("/")[2]));
  return shell ? "shell" : pathname;
}

const reducedVariants: Variants = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

export default function RouteTransitions({ children }: { children: ReactNode }) {
  const location = useLocation();
  const reduce = usePrefersReducedMotion();

  return (
    // LayoutGroup gives the exiting page's tapped card cover and the entering
    // EventDetail hero a shared layout context, so their matching
    // layoutId={`event-cover-<id>`} pair up into a morph across the
    // AnimatePresence swap (see Stub.tsx / Explore.tsx / EventDetail.tsx). When
    // the ids don't pair (any other navigation), the target chunk isn't mounted
    // yet, or reduced-motion neutralizes layout animation, nothing morphs and
    // the directional page transition below just plays — the morph is additive.
    <LayoutGroup>
      <PageLoadBar />
      {/* mode="wait" so the outgoing page finishes exiting before the next
          mounts — that ordering is also what keeps a lazy route's Suspense
          fallback from flashing mid-transition: the exit runs on the
          already-loaded old page, and the Skeleton (if the new chunk is still
          downloading) only appears once inside the freshly-mounted page.
          initial={false} skips an entry animation on first paint (the splash
          screen already covers that). */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={routeGroupKey(location.pathname)}
          variants={reduce ? reducedVariants : pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={reduce ? { duration: 0 } : pageTransition}
        >
          <Suspense fallback={<Skeleton variant="generic" />}>
            {/* Frozen location so the exiting page keeps rendering its own route
                while the next one is matched against the new URL. */}
            <Routes location={location}>{children}</Routes>
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </LayoutGroup>
  );
}
