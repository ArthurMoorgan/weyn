// Feature 1: Auto-Generate Event Pages From Instagram.
//
// Honest scope note: Instagram's real Graph API requires the organizer to
// connect a Facebook/Instagram Business account and Meta app review — that's
// a whole OAuth integration this doesn't attempt. What this DOES do, without
// any Instagram credentials at all:
//   1. Best-effort fetch of the public post page and read its Open Graph tags
//      (og:description holds the caption on most public posts, og:image the
//      photo). Instagram sometimes serves a login-wall instead — when that
//      happens we say so and let the organizer paste the caption manually.
//   2. Turn the caption into a structured draft — via a real Claude API call
///     if ANTHROPIC_API_KEY is set, else a deterministic regex/heuristic
//      parser that still gives a genuinely useful prefill.

import crypto from "crypto";
import path from "path";
import fs from "fs";
import { aiConfigured, askClaudeJson } from "./ai.js";
import { cleanEventTitle } from "./refine.js";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function metaTag(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, "i"));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&") : null;
}

export async function scrapeInstagramPost(url) {
  if (!/^https?:\/\/(www\.)?instagram\.com\//i.test(url)) {
    throw Object.assign(new Error("That doesn't look like an Instagram post URL"), { needsCaption: true });
  }
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
  const html = await res.text();
  const ogDesc = metaTag(html, "og:description");
  const ogImage = metaTag(html, "og:image");
  if (!ogDesc) {
    throw Object.assign(new Error("Couldn't read that post automatically (Instagram blocked the request) — paste the caption below instead"), { needsCaption: true });
  }
  // og:description on IG posts is usually: `12K likes, 34 comments - user on <date>: "actual caption text"`
  const captionMatch = ogDesc.match(/:\s*"([\s\S]*)"\s*$/);
  const caption = captionMatch ? captionMatch[1] : ogDesc;
  return { caption, imageUrl: ogImage };
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const stripHashtags = (s) => s.replace(/#[\p{L}\p{N}_]+/gu, "").trim();

function heuristicParse(caption) {
  const raw = (caption || "").trim();
  const tags = [...raw.matchAll(/#([\p{L}\p{N}_]+)/gu)]
    .map((m) => m[1].toLowerCase())
    .filter((t) => t.length > 1 && !/^\d+$/.test(t)) // drop "#1" / bare numbers
    .filter((t, i, a) => a.indexOf(t) === i) // dedupe
    .slice(0, 6);

  // Title: shared deterministic cleaner — name only, no emoji/date/time/address.
  const title = cleanEventTitle(raw) || "Imported event";

  // Blurb: whole caption minus hashtags, collapsed whitespace, trimmed to a
  // sensible length — but never just repeat the title if there's more to say.
  let blurb = stripHashtags(raw).replace(/\n{2,}/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (blurb.length > 400) blurb = blurb.slice(0, 397).replace(/\s+\S*$/, "") + "…";
  if (!blurb) blurb = "Imported from Instagram — details to follow.";

  // guess a start time: look for "8pm" / "20:00" style patterns, and a day-of-week or "tonight"/"tomorrow"
  const timeMatch = raw.match(/(\d{1,2})(:\d{2})?\s?(am|pm)/i) || raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const dayMatch = raw.toLowerCase().match(new RegExp(DAY_NAMES.join("|")));
  let startsAt = null;
  if (timeMatch) {
    const d = new Date();
    let hour = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] ? parseInt(String(timeMatch[2]).replace(":", ""), 10) : 0;
    if (timeMatch[3] && /pm/i.test(timeMatch[3]) && hour < 12) hour += 12;
    if (timeMatch[3] && /am/i.test(timeMatch[3]) && hour === 12) hour = 0;
    if (dayMatch) {
      const target = DAY_NAMES.indexOf(dayMatch[0]);
      const diff = (target - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
    } else if (/tomorrow/i.test(raw)) {
      d.setDate(d.getDate() + 1);
    }
    d.setHours(hour, min, 0, 0);
    startsAt = d.toISOString();
  }

  return {
    title,
    blurb,
    tags: tags.length ? tags : ["imported"],
    startsAt,
  };
}

async function aiParse(caption) {
  const prompt = `Extract event details from this Instagram caption as strict JSON with keys
"title" (short, <=70 chars), "blurb" (1-3 sentences, no hashtags), "tags" (array of up to 6 short lowercase keywords, no #),
and "startsAt" (an ISO 8601 datetime if a specific date/time is mentioned, else null — assume the current year, and Asia/Muscat timezone).
Return ONLY the JSON object, nothing else.

Caption:
"""${caption}"""`;
  return askClaudeJson(prompt, { maxTokens: 300 });
}

export async function parseEventFromCaption(caption) {
  if (aiConfigured()) {
    try {
      const parsed = await aiParse(caption);
      return { ...parsed, aiParsed: true };
    } catch {
      // fall through to heuristic on any AI hiccup — never block the organizer
    }
  }
  return { ...heuristicParse(caption), aiParsed: false };
}

export async function downloadImage(imageUrl, uploadDir) {
  try {
    const res = await fetch(imageUrl, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = (res.headers.get("content-type") || "").includes("png") ? ".png" : ".jpg";
    const filename = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(uploadDir, filename), buf);
    return `/uploads/${filename}`;
  } catch {
    return null; // image download failing shouldn't block the whole import
  }
}
