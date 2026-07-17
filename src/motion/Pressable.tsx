import { forwardRef } from "react";
import { motion, type HTMLMotionProps, type TargetAndTransition } from "motion/react";
import { NavLink, Link, type NavLinkProps, type LinkProps } from "react-router-dom";
import { usePrefersReducedMotion, pressSpring } from "./index";

// Shared tap/hover feel for anything the user presses — buttons, nav tabs,
// cards. MotionConfig's reducedMotion="user" (see main.tsx) already
// neutralizes transform animations OS-wide, but these are literal scale
// values handed to whileTap/whileHover, not animate/variants, so they fall
// outside that mechanism — hence the explicit hook check here too.
export function usePressable(): {
  whileTap: TargetAndTransition | undefined;
  whileHover: TargetAndTransition | undefined;
  transition: typeof pressSpring;
} {
  const reduced = usePrefersReducedMotion();
  return {
    whileTap: reduced ? undefined : { scale: 0.94 },
    whileHover: reduced ? undefined : { scale: 1.02 },
    transition: pressSpring,
  };
}

export const MotionButton = forwardRef<HTMLButtonElement, HTMLMotionProps<"button">>(
  function MotionButton(props, ref) {
    const { whileTap, whileHover, transition } = usePressable();
    return (
      <motion.button
        ref={ref}
        whileTap={whileTap}
        whileHover={whileHover}
        transition={transition}
        {...props}
      />
    );
  }
);

// motion.create(NavLink) rather than a hand-rolled wrapper — NavLink's
// className/children render-prop API (`({ isActive }) => ...`) is just
// forwarded through untouched, since motion.create only intercepts its own
// animation props before handing the rest to the wrapped component.
const MotionNavLinkBase = motion.create(NavLink);

// NavLink's DOM drag/animation event handlers (plain DOM event types) and
// its function-form `style` (`(props: NavLinkRenderProps) => CSSProperties`)
// collide with motion's own onDrag*/onAnimation*/style typings once
// wrapped — this component doesn't use drag gestures or animate `style`
// directly, so the DOM/NavLink versions win the name and motion's are
// dropped from the public type. App.tsx only ever uses NavLink's function
// form for `className`/children, which stays untouched below.
type MotionNavLinkProps = Omit<
  NavLinkProps,
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "style"
>;

export const MotionNavLink = forwardRef<HTMLAnchorElement, MotionNavLinkProps>(
  function MotionNavLink(props, ref) {
    const { whileTap, whileHover, transition } = usePressable();
    return (
      <MotionNavLinkBase
        ref={ref}
        whileTap={whileTap}
        whileHover={whileHover}
        transition={transition}
        {...props}
      />
    );
  }
);

// Same rationale as MotionNavLink above, for plain (non-active-aware) react-
// router Links used as tappable rows/items rather than nav tabs.
const MotionLinkBase = motion.create(Link);

type MotionLinkProps = Omit<
  LinkProps,
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
>;

export const MotionLink = forwardRef<HTMLAnchorElement, MotionLinkProps>(
  function MotionLink(props, ref) {
    const { whileTap, whileHover, transition } = usePressable();
    return (
      <MotionLinkBase
        ref={ref}
        whileTap={whileTap}
        whileHover={whileHover}
        transition={transition}
        {...props}
      />
    );
  }
);
