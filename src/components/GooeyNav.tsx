import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./GooeyNav.css";

// ReactBits' GooeyNav (https://reactbits.dev/components), adapted to:
//  - navigate real routes via react-router instead of `#` anchors
//  - carry an icon per item (Weyn's existing icon-font glyphs), matching the
//    app's tab-bar convention instead of ReactBits' text-only pill list
//  - source its colors from Weyn's own design tokens (--primary/--success/
//    etc, defined per-theme in index.css) instead of hardcoded white/black,
//    so it looks correct in both light and dark mode
// The particle-burst effect itself is untouched from the original source.
export interface GooeyNavItem {
  label: string;
  icon?: string;
  to: string;
  end?: boolean; // exact-match, like NavLink's `end` — used for "/"
}

interface GooeyNavProps {
  items: GooeyNavItem[];
  animationTime?: number;
  particleCount?: number;
  particleDistances?: [number, number];
  particleR?: number;
  timeVariance?: number;
  colors?: number[];
}

export default function GooeyNav({
  items,
  animationTime = 600,
  particleCount = 12,
  particleDistances = [70, 10],
  particleR = 90,
  timeVariance = 300,
  colors = [1, 2, 3, 4],
}: GooeyNavProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const matchIndex = (pathname: string) =>
    items.findIndex((it) => (it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(it.to + "/")));

  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, matchIndex(location.pathname)));

  const noise = (n = 1) => n / 2 - Math.random() * n;

  const getXY = (distance: number, pointIndex: number, totalPoints: number): [number, number] => {
    const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
  };

  const createParticle = (i: number, t: number, d: [number, number], r: number) => {
    const rotate = noise(r / 10);
    return {
      start: getXY(d[0], particleCount - i, particleCount),
      end: getXY(d[1] + noise(7), particleCount - i, particleCount),
      time: t,
      scale: 1 + noise(0.2),
      color: colors[Math.floor(Math.random() * colors.length)],
      rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10,
    };
  };

  const makeParticles = (element: HTMLElement) => {
    const d = particleDistances;
    const r = particleR;
    const bubbleTime = animationTime * 2 + timeVariance;
    element.style.setProperty("--time", `${bubbleTime}ms`);

    for (let i = 0; i < particleCount; i++) {
      const t = animationTime * 2 + noise(timeVariance * 2);
      const p = createParticle(i, t, d, r);
      element.classList.remove("active");

      setTimeout(() => {
        const particle = document.createElement("span");
        const point = document.createElement("span");
        particle.classList.add("particle");
        particle.style.setProperty("--start-x", `${p.start[0]}px`);
        particle.style.setProperty("--start-y", `${p.start[1]}px`);
        particle.style.setProperty("--end-x", `${p.end[0]}px`);
        particle.style.setProperty("--end-y", `${p.end[1]}px`);
        particle.style.setProperty("--time", `${p.time}ms`);
        particle.style.setProperty("--scale", `${p.scale}`);
        particle.style.setProperty("--color", `var(--gooey-color-${p.color}, var(--primary))`);
        particle.style.setProperty("--rotate", `${p.rotate}deg`);

        point.classList.add("point");
        particle.appendChild(point);
        element.appendChild(particle);
        requestAnimationFrame(() => element.classList.add("active"));
        setTimeout(() => {
          try { element.removeChild(particle); } catch { /* already gone */ }
        }, t);
      }, 30);
    }
  };

  const updateEffectPosition = (element: HTMLElement) => {
    if (!containerRef.current || !filterRef.current || !textRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const pos = element.getBoundingClientRect();
    const styles = {
      left: `${pos.x - containerRect.x}px`,
      top: `${pos.y - containerRect.y}px`,
      width: `${pos.width}px`,
      height: `${pos.height}px`,
    };
    Object.assign(filterRef.current.style, styles);
    Object.assign(textRef.current.style, styles);
    textRef.current.innerText = element.innerText;
  };

  function go(index: number, liEl: HTMLLIElement) {
    navigate(items[index].to);
    if (activeIndex === index) return;
    setActiveIndex(index);
    updateEffectPosition(liEl);

    if (filterRef.current) {
      filterRef.current.querySelectorAll(".particle").forEach((p) => filterRef.current!.removeChild(p));
      makeParticles(filterRef.current);
    }
    if (textRef.current) {
      textRef.current.classList.remove("active");
      void textRef.current.offsetWidth;
      textRef.current.classList.add("active");
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, index: number) => {
    e.preventDefault();
    go(index, e.currentTarget.parentElement as HTMLLIElement);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const liEl = e.currentTarget.parentElement as HTMLLIElement;
      if (liEl) go(index, liEl);
    }
  };

  // Re-sync (no particle burst) whenever the route changes for any reason
  // other than a click on this nav — a link elsewhere in the app, browser
  // back/forward, or the initial mount.
  useEffect(() => {
    const idx = Math.max(0, matchIndex(location.pathname));
    setActiveIndex(idx);
    const li = navRef.current?.querySelectorAll("li")[idx] as HTMLLIElement | undefined;
    if (li) {
      updateEffectPosition(li);
      textRef.current?.classList.add("active");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const li = navRef.current?.querySelectorAll("li")[activeIndex] as HTMLLIElement | undefined;
      if (li) updateEffectPosition(li);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  return (
    <div className="gooey-nav-container" ref={containerRef}>
      <nav>
        <ul ref={navRef}>
          {items.map((item, index) => (
            <li key={item.to} className={activeIndex === index ? "active" : ""}>
              <a
                href={item.to}
                aria-current={activeIndex === index ? "page" : undefined}
                onClick={(e) => handleClick(e, index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              >
                {item.icon && <i className={"icon-" + item.icon} />}
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <span className="effect filter" ref={filterRef} />
      <span className="effect text" ref={textRef} />
    </div>
  );
}
