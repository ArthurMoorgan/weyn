// Local Node dev storage — writes event photos to server/uploads/ on disk.
// Only ever imported by server/index.js (the plain-Node entry point), never
// by server/worker.js, so it's safe to use real fs/path here.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_BY_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

export const diskStorage = {
  async saveImage(buffer, ext) {
    const key = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, key), buffer);
    return { url: `/uploads/${key}`, key };
  },
  async readImage(urlOrKey) {
    const key = path.basename(String(urlOrKey || ""));
    const abs = path.join(UPLOAD_DIR, key);
    try {
      const buffer = fs.readFileSync(abs);
      const mime = MIME_BY_EXT[path.extname(abs).toLowerCase()] || "image/jpeg";
      return { buffer, mime };
    } catch {
      return null;
    }
  },
};
