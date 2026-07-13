// AES-256-GCM encryption-at-rest helper for third-party access tokens we
// have to store server-side (currently: SocialAccountConnection.accessTokenEnc,
// see prisma/schema.prisma's comment on that model). This is the first
// place this codebase needs to store a secret *we* hold on someone else's
// behalf rather than just verify a signature (server/payments.js's HMAC
// check) or hash a password-equivalent (server/db.js's device secret
// sha256) — so there's no existing helper to reuse, this is the new one,
// written once so any future "store a third-party token" need reuses it
// instead of hand-rolling crypto again.
//
// Key comes from SOCIAL_TOKEN_ENC_KEY (32 raw bytes, base64 or hex encoded).
// Unset in every environment today — see server/social-posting.js and
// HANDOFF.md §4.5's Stripe section for the same "parked, code-complete,
// inert until an env var is set" pattern.
import crypto from "crypto";

const ALGO = "aes-256-gcm";

function loadKey() {
  const raw = process.env.SOCIAL_TOKEN_ENC_KEY;
  if (!raw) return null;
  let buf;
  try {
    buf = raw.length === 64 ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  return buf.length === 32 ? buf : null;
}

export function encryptionConfigured() {
  return !!loadKey();
}

// Returns "iv:authTag:ciphertext", all hex — a single string so it fits
// the plain String column on SocialAccountConnection without a JSON blob.
export function encryptSecret(plaintext) {
  const key = loadKey();
  if (!key) throw new Error("SOCIAL_TOKEN_ENC_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload) {
  const key = loadKey();
  if (!key) throw new Error("SOCIAL_TOKEN_ENC_KEY is not configured");
  const [ivHex, tagHex, dataHex] = String(payload).split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed encrypted payload");
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
