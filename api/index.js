// Vercel serverless entry point — every /api/* and /uploads/* request (see
// vercel.json rewrites) is handled by the same Express app used elsewhere
// (server/app.js), just with Vercel Blob storage injected instead of disk/R2.
import "dotenv/config";
import { createApp } from "../server/app.js";
import { vercelStorage } from "../server/storage-vercel.js";

const app = createApp(vercelStorage);

export default app;
