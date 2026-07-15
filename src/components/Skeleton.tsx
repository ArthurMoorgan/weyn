// Tab / route loading skeletons — shown while a lazy page chunk downloads
// on first visit, instead of the Weyn logo mark. A skeleton that mirrors
// the page's real layout reads as "the page is arriving" rather than a
// branded interstitial, and avoids the logo flashing on every first tab
// switch. Shimmer + block styling live in components.css (.sk / .skel-*).

type Variant = "discover" | "tickets" | "profile" | "generic";

function Line({ w = "100%", h = 13 }: { w?: string; h?: number }) {
  return <span className="sk sk-line" style={{ width: w, height: h }} />;
}

export default function Skeleton({ variant = "generic" }: { variant?: Variant }) {
  if (variant === "discover") {
    // No header row here: the one place this variant renders (Discover's
    // Events/Venues switch) already shows the real toggle + Host button
    // above the Suspense boundary, so a skeleton header would double it.
    return (
      <div className="skel-page" aria-busy="true" aria-label="Loading">
        <span className="sk sk-search" />
        <div className="skel-cats">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="sk sk-cat" />
          ))}
        </div>
        <span className="sk sk-hero" />
        <div className="skel-rowlist">
          {Array.from({ length: 2 }).map((_, i) => (
            <div className="skel-cardrow" key={i}>
              <span className="sk sk-cover" />
              <Line w="70%" />
              <Line w="45%" h={11} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "tickets") {
    return (
      <div className="skel-page" aria-busy="true" aria-label="Loading">
        <div className="skel-title">
          <span className="sk" style={{ width: 130, height: 26, borderRadius: 8 }} />
        </div>
        <div className="skel-pills">
          <span className="sk" style={{ width: 96, height: 38, borderRadius: 12 }} />
          <span className="sk" style={{ width: 82, height: 38, borderRadius: 12 }} />
        </div>
        <div className="skel-rowlist tight">
          {Array.from({ length: 3 }).map((_, i) => (
            <div className="skel-listrow" key={i}>
              <span className="sk sk-thumb" />
              <div className="skel-listrow-txt">
                <Line w="65%" />
                <Line w="40%" h={11} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "profile") {
    return (
      <div className="skel-page" aria-busy="true" aria-label="Loading">
        <div className="skel-title">
          <span className="sk" style={{ width: 110, height: 26, borderRadius: 8 }} />
        </div>
        <span className="sk sk-account" />
        <span className="sk sk-block" />
        <div className="skel-rowlist tight">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="sk sk-dockrow" />
          ))}
        </div>
      </div>
    );
  }

  // generic drilled-route fallback
  return (
    <div className="skel-page" aria-busy="true" aria-label="Loading">
      <div className="skel-title">
        <span className="sk" style={{ width: 160, height: 26, borderRadius: 8 }} />
      </div>
      <span className="sk sk-block" />
      <div className="skel-rowlist tight">
        {Array.from({ length: 3 }).map((_, i) => (
          <span key={i} className="sk sk-dockrow" />
        ))}
      </div>
    </div>
  );
}
