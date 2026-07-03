// Cloudflare Workers entry point — what wrangler.jsonc's "main" points to.
// `httpServerHandler` is Cloudflare's documented adapter for running an
// existing Express app (still calling app.listen()) on the Workers runtime.
// See: https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/
import { httpServerHandler } from "cloudflare:node";
import { createApp, runReminderScan } from "./app.js";
import { r2Storage } from "./storage-r2.js";

const PORT = 3000; // internal only — Workers routes requests in, this never binds a real socket
const app = createApp(r2Storage);
app.listen(PORT);

export default {
  ...httpServerHandler({ port: PORT }),
  // replaces the local-dev setInterval — wrangler.jsonc's cron trigger calls
  // this every 5 minutes instead
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(runReminderScan());
  },
};
