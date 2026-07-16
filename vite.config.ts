import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The built HTML ships the ~327KB (45KB gz) main stylesheet as a
// render-blocking <link rel="stylesheet"> in <head>. The browser refuses to
// paint ANY body content until that CSS downloads+parses — including the
// splash overlay, which is styled entirely by inline <style> in <head> and
// needs none of it. Result: a long black screen (measured FCP ~1.3s on a
// throttled connection) before the splash even appears.
//
// This plugin rewrites that one main-CSS link into the standard non-blocking
// preload→swap pattern (rel=preload as=style, onload flips it to a real
// stylesheet), with a <noscript> fallback. First paint then only waits on
// the tiny inline splash styles, so the splash shows almost immediately; the
// app CSS loads during the splash's minimum on-screen time and is ready
// before React dismisses it (the splash covers the app at z-9999 throughout,
// so there is no flash of unstyled content). Only the entry CSS is touched;
// lazy-route CSS chunks are unaffected.
function asyncMainCss(): Plugin {
  return {
    name: "async-main-css",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet"([^>]*?)href="(\/assets\/index-[^"]+\.css)"([^>]*)>/,
        (_m, pre, href, post) =>
          `<link rel="preload" as="style"${pre}href="${href}"${post} onload="this.onload=null;this.rel='stylesheet'">` +
          `<noscript><link rel="stylesheet"${pre}href="${href}"${post}></noscript>`
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), asyncMainCss()],
  // Vite's default target (a conservative "es2020 + last few browser
  // versions" baseline) makes esbuild downlevel some modern syntax
  // (optional chaining assignment, class fields, etc) into older
  // equivalents purely for engines this app doesn't need to support — this
  // is what Lighthouse's "Legacy JavaScript" audit was flagging. Bumped to
  // a real modern baseline (private beta, no IE/old-Safari requirement);
  // applies to both the app's own code and esbuild's dependency
  // pre-bundling step, since that has its own separate target.
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        // Split the largest, rarely-changing vendors out of the entry chunk
        // into their own long-cached files. This doesn't shrink total bytes,
        // but it (a) lets the browser fetch them in parallel with app code,
        // and (b) keeps them cached across app deploys (the app chunk's hash
        // changes every deploy; these don't), so repeat loads only re-fetch
        // the small app chunk. motion (framer-motion) is the single heaviest
        // non-essential dep and is isolated so it can't bloat the entry.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-clerk": ["@clerk/react"],
          "vendor-motion": ["motion", "motion/react"],
        },
      },
    },
  },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
  server: {
    host: true, // expose on the local network so phones on the same Wi-Fi can reach it
    port: Number(process.env.PORT) || 5173,
    allowedHosts: true, // needed so a public tunnel (trycloudflare.com etc) isn't blocked by Vite's Host check
    proxy: {
      "/api": "http://localhost:4000",
      "/uploads": "http://localhost:4000",
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
