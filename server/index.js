// Local Node dev entry — plain `node server/index.js` (used by `npm run dev`
// / `npm run server`). Production runs through server/worker.js on
// Cloudflare Workers instead; this file exists so local dev doesn't need
// wrangler/Miniflare just to run the backend.
import "dotenv/config"; // loads .env in the project root (git-ignored) into process.env
import { createApp, runReminderScan, runCampaignScan, runAutomationScan, SCAN_EVERY_MS } from "./app.js";
import { diskStorage } from "./storage-disk.js";
import { seedIfEmpty, seedCategoriesIfEmpty } from "./db.js";

const app = createApp(diskStorage);

// only local dev auto-seeds — the Workers entry (server/worker.js) never
// does, since production Postgres already has real data (see db.js)
await seedIfEmpty();
await seedCategoriesIfEmpty();

setInterval(runReminderScan, SCAN_EVERY_MS).unref();
setInterval(runCampaignScan, SCAN_EVERY_MS).unref();
setInterval(runAutomationScan, SCAN_EVERY_MS).unref();

// hosts like Render/Fly/Railway inject PORT; local dev keeps using API_PORT/4000
const PORT = process.env.PORT || process.env.API_PORT || 4000;
app.listen(PORT, "0.0.0.0", () => console.log(`[weyn] API listening on port ${PORT}`));
