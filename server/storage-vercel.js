// Vercel Blob implementation of the storage interface (see storage-disk.js /
// storage-r2.js for the same shape). Vercel Functions have no persistent
// disk, so uploaded event photos go to Vercel Blob instead.
import { put, head } from "@vercel/blob";
import crypto from "crypto";

const MIME_BY_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

export const vercelStorage = {
  async saveImage(buffer, ext) {
    const key = crypto.randomUUID() + ext;
    const contentType = MIME_BY_EXT[ext.toLowerCase()] || "image/jpeg";
    // Public Blob access, deliberately — the actual blob URL is never
    // exposed to clients (readImage below streams the bytes through our own
    // /uploads/:key route), and keys are random UUIDs, so there's no real
    // exposure beyond what any object storage with a knowable key already
    // has. Private access requires signed download URLs for every read,
    // which adds real complexity for images that aren't sensitive data.
    const blob = await put(key, buffer, { access: "public", contentType, addRandomSuffix: false });
    return { url: `/uploads/${key}`, key, blobUrl: blob.url };
  },
  async readImage(urlOrKey) {
    const key = String(urlOrKey || "").replace(/^\/uploads\//, "");
    try {
      const meta = await head(key);
      const res = await fetch(meta.url);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, mime: meta.contentType || "image/jpeg" };
    } catch {
      return null;
    }
  },
};
