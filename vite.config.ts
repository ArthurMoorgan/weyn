import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
