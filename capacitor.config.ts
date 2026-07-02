import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.weyn.app",
  appName: "Weyn",
  webDir: "dist",
  backgroundColor: "#0E1320",
  ios: {
    contentInset: "always",
    backgroundColor: "#0E1320",
  },
  // For live-reload against a running dev server, uncomment and set to your Mac's LAN URL:
  // server: { url: "http://192.168.1.5:5173", cleartext: true },
};

export default config;
