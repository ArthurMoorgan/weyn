// Minimal stand-in for iconv-lite, aliased in via wrangler.jsonc's `alias`
// config. Express's body-parser (a dependency of Express itself, loaded
// whether or not our code calls express.json()) requires iconv-lite at
// module-import time to support decoding non-UTF-8 request bodies. On
// Cloudflare Workers, iconv-lite's own top-level code hits an unresolved gap
// in the Node `stream` polyfill and crashes the deploy before a single
// request is served — a live upstream bug:
// https://github.com/cloudflare/workers-sdk/issues/9309
//
// Weyn's API only ever sends/receives UTF-8 JSON, so full multi-charset
// transcoding is dead weight we don't need — this stub covers exactly the
// surface body-parser/raw-body actually call (encodingExists, decode,
// getDecoder), handling UTF-8/ASCII correctly and failing loudly for
// anything else rather than silently mis-decoding.
const UTF8_ALIASES = new Set(["utf8", "utf-8", "ascii", "us-ascii"]);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function encodingExists(encoding) {
  return UTF8_ALIASES.has(norm(encoding));
}

export function decode(buffer, encoding) {
  if (!encodingExists(encoding)) {
    throw new Error(`iconv-lite stub: unsupported encoding "${encoding}" (Weyn's API is UTF-8 only)`);
  }
  return new TextDecoder("utf-8").decode(buffer);
}

export function encode(str) {
  return Buffer.from(new TextEncoder().encode(str));
}

// raw-body calls this to get a decoder object with a .write()/.end() API
export function getDecoder(encoding) {
  if (!encodingExists(encoding)) {
    throw new Error(`iconv-lite stub: unsupported encoding "${encoding}" (Weyn's API is UTF-8 only)`);
  }
  const decoder = new TextDecoder("utf-8");
  let result = "";
  return {
    write(buf) { result += decoder.decode(buf, { stream: true }); return ""; },
    end() { const out = result + decoder.decode(); result = ""; return out; },
  };
}

export default { encodingExists, decode, encode, getDecoder };
