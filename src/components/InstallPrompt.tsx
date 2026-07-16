import { useEffect, useState } from "react";
import { Mark } from "./Logo";

type BIPEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
}
function isMac() {
  return /macintosh/i.test(navigator.userAgent) && !("ontouchend" in document);
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [sheet, setSheet] = useState<null | "ios" | "desktop">(null);

  useEffect(() => {
    const onBIP = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); setSheet(null); };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  async function install() {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else if (isIOS()) {
      setSheet("ios");
    } else {
      setSheet("desktop");
    }
  }

  const platform = isIOS() ? "iPhone" : isMac() ? "Mac" : "device";

  return (
    <>
      {/* Plain shadow-separated card (design brief), not the GlassSurface
          SVG-displacement panel — that filter has a blue chromatic-offset
          channel that rendered a stray blue edge, clashing with the
          monochrome system. */}
      <div className="install-card">
        <div className="ic-mark"><Mark size={26} /></div>
        <div className="ic-body">
          <b>Install Weyn</b>
          <span>Add it to your {platform} — full screen, offline-ready, one tap away.</span>
        </div>
        <button className="btn" style={{ width: "auto", padding: "11px 18px" }} onClick={install}>
          <i className="icon-download" /> Install
        </button>
      </div>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="install-sheet glass" onClick={(e) => e.stopPropagation()}>
            <div className="ic-mark big"><Mark size={40} /></div>
            <h3>Install Weyn</h3>
            {sheet === "ios" ? (
              <ol className="steps">
                <li><i className="icon-share-2" /> Tap the <b>Share</b> button in Safari's toolbar.</li>
                <li><i className="icon-square-plus" /> Choose <b>Add to Home Screen</b>.</li>
                <li><i className="icon-check" /> Tap <b>Add</b> — Weyn lands on your home screen.</li>
              </ol>
            ) : (
              <ol className="steps">
                <li><i className="icon-app-window" /> In Chrome or Edge, open the <b>address bar menu</b>.</li>
                <li><i className="icon-download" /> Click the <b>Install</b> icon (or ⋮ → Install Weyn).</li>
                <li><i className="icon-check" /> It opens in its own window and lives in your dock.</li>
              </ol>
            )}
            <button className="btn glass" onClick={() => setSheet(null)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}
