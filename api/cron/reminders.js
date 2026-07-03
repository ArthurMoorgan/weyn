// Reminder-scan endpoint, meant to be hit every 5 minutes by an external
// scheduler (e.g. cron-job.org) — Vercel's Hobby plan only allows daily
// crons, too coarse for the 2-hour-ahead reminder window. Replaces the
// setInterval used in local dev (server/index.js) and the Cloudflare
// Workers scheduled() export from the earlier deploy attempt. Set
// CRON_SECRET and have the external scheduler send it as a Bearer token.
import "dotenv/config";
import { runReminderScan } from "../../server/app.js";

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  await runReminderScan();
  res.status(200).json({ ok: true });
}
