import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vite's default target (a conservative "es2020 + last few browser
  // versions" baseline) makes esbuild downlevel some modern syntax
  // (optional chaining assignment, class fields, etc) into older
  // equivalents purely for engines this app doesn't need to support — this
  // is what Lighthouse's "Legacy JavaScript" audit was flagging. Bumped to
  // a real modern baseline (private beta, no IE/old-Safari requirement);
  // applies to both the app's own code and esbuild's dependency
  // pre-bundling step, since that has its own separate target.
  build: { target: "es2022" },
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
