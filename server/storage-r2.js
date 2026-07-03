// Cloudflare Workers storage — event photos live in R2 (server/uploads/ has
// no equivalent on Workers, there's no persistent disk). Only ever imported
// by server/worker.js; the `cloudflare:workers` module doesn't exist under
// plain Node, so this file must never be imported by server/index.js.
import { env } from "cloudflare:workers";
import crypto from "crypto";

const MIME_BY_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

export const r2Storage = {
  async saveImage(buffer, ext) {
    const key = crypto.randomUUID() + ext;
    const contentType = MIME_BY_EXT[ext.toLowerCase()] || "image/jpeg";
    await env.UPLOADS.put(key, buffer, { httpMetadata: { contentType } });
    return { url: `/uploads/${key}`, key };
  },
  async readImage(urlOrKey) {
    const key = String(urlOrKey || "").replace(/^\/uploads\//, "");
    const obj = await env.UPLOADS.get(key);
    if (!obj) return null;
    const buffer = Buffer.from(await obj.arrayBuffer());
    const mime = obj.httpMetadata?.contentType || "image/jpeg";
    return { buffer, mime };
  },
};
