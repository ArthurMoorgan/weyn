// Event-draft refinement / validation.
//
// Every event — whether typed by hand or imported from Instagram — passes
// through refineEventDraft() before it's stored. Two layers:
//
//   1. An AI pass (real Claude call, only when ANTHROPIC_API_KEY is set) that
//      reads the whole draft and returns a cleaned, structured version:
//      a name-only title, a tidy blurb, sensible tags, and any date/venue it
//      can pull OUT of the title/blurb and INTO their proper fields.
//
//   2. A deterministic pass that ALWAYS runs on top of whatever we have, and
//      hard-guarantees the title rules the product requires no matter what:
//        • no emojis in the title (users can re-add them later if they want)
//        • no address, no date, no time in the title
//        • title = the event name, nothing else
//
// The deterministic layer is the safety net: even if the AI is off, or returns
// something imperfect, these guarantees still hold.

import { aiConfigured, askClaudeJson } from "./ai.js";

// Matches emoji, pictographs, regional-indicator flags, variation selectors,
// keycaps and zero-width joiners — everything that makes up a rendered emoji.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}\u{200D}]/gu;

export function stripEmoji(s) {
  return (s || "").replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// The point in a string where the event NAME ends and details begin. Cutting
// the title here strips trailing date / time / venue / call-to-action text.
const TITLE_CUT = new RegExp(
  "\\s(?:" +
    "[|–—@]\\s?|" +                                  // separators / "@ venue"
    "(?:this|next|on|at|in|every|starting|from)\\s|" + // "…at 8pm", "…in Muscat"
    "(?:tonight|tomorrow|today)\\b|" +               // relative days
    "(?:" + DAY_NAMES.join("|") + ")\\b|" +          // weekday names
    "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s|" + // month names
    "\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)\\b|" +         // "7pm", "8:30 pm"
    "\\d{1,2}(?::\\d{2})\\b|" +                       // 24h "20:00"
    "\\d{1,2}[\\/.\\-]\\d{1,2}(?:[\\/.\\-]\\d{2,4})?\\b|" + // "12/08", "12-08-26"
    "(?:join|come|book|rsvp|dm|date|time|venue|location|tickets?|link in bio|swipe|omr|\\$)\\b" +
  ")", "i"
);

// Deterministic, always-on title cleaner. Guarantees: no emoji, no date/time/
// address/CTA tail — just the event name.
export function cleanEventTitle(raw) {
  if (!raw) return "";
  // if multiline, use the first line that has real (non-emoji, non-hashtag) text
  const lines = String(raw).split(/\r?\n/).map((l) => l.trim());
  let line = lines.find((l) => stripEmoji(l).replace(/#[\p{L}\p{N}_]+/gu, "").trim().length >= 3) || raw;

  let t = stripEmoji(line).replace(/#[\p{L}\p{N}_]+/gu, "").trim();
  t = t.replace(/^[\s\-–—•·|:>*]+/, "").trim(); // leading bullets/labels

  // cut at the earliest sentence-end or metadata marker that still leaves a name
  const sentence = t.search(/[.!?]\s/);
  const meta = t.search(TITLE_CUT);
  const cut = [sentence, meta].filter((i) => i >= 8).sort((a, b) => a - b)[0];
  if (cut != null) t = t.slice(0, cut);

  t = t.replace(/[\s\-–—•·|:,@]+$/, "").trim();
  // final emoji sweep (in case one sat mid-title) + length cap
  return stripEmoji(t).slice(0, 70).trim();
}

// AI validation pass — reads the whole draft, returns a cleaned structured one.
async function aiRefine(draft) {
  const prompt = `You are validating an event listing before it is published. Clean and correct the fields.
Return STRICT JSON only, with these keys:
- "title": the event NAME ONLY. Absolutely no emojis. No date, no time, no address, no venue, no price. Fix obvious typos and capitalization. Max 70 chars.
- "blurb": a clear 1-3 sentence description. No hashtags. No emojis at the start.
- "tags": array of up to 6 short lowercase keywords, no "#".
- "startsAt": ISO 8601 datetime if a specific date/time is present anywhere in the input, else null. Assume the current year and Asia/Muscat timezone.
- "venue": the venue/place name if mentioned, else null.
- "area": the neighbourhood/area in Muscat if mentioned, else null.

Input draft (JSON):
${JSON.stringify({ title: draft.title || "", blurb: draft.blurb || "", tags: draft.tags || [] })}

Return ONLY the JSON object.`;
  return askClaudeJson(prompt, { maxTokens: 400 });
}

// Orchestrator. `draft` = { title, blurb, tags, startsAt, venue, area }.
// Returns the same shape, cleaned. `backfillEmpty` controls whether AI-extracted
// date/venue/area are allowed to fill fields the user left blank (never
// overwrites a value the user already provided).
export async function refineEventDraft(draft, { backfillEmpty = true } = {}) {
  let out = { ...draft };

  if (aiConfigured()) {
    try {
      const ai = await aiRefine(draft);
      if (ai.title) out.title = ai.title;
      if (ai.blurb) out.blurb = ai.blurb;
      if (Array.isArray(ai.tags) && ai.tags.length) out.tags = ai.tags;
      if (backfillEmpty) {
        if (!out.startsAt && ai.startsAt) out.startsAt = ai.startsAt;
        if (!out.venue && ai.venue) out.venue = ai.venue;
        if (!out.area && ai.area) out.area = ai.area;
      }
      out.aiValidated = true;
    } catch {
      out.aiValidated = false; // AI hiccup — deterministic guarantees still apply
    }
  } else {
    out.aiValidated = false;
  }

  // ALWAYS enforce the hard title rules, on top of whatever we have.
  out.title = cleanEventTitle(out.title) || cleanEventTitle(draft.blurb) || "Untitled event";
  // tidy tags deterministically too (dedupe, no #, no bare numbers, cap 6)
  if (Array.isArray(out.tags)) {
    out.tags = out.tags
      .map((t) => String(t).replace(/^#/, "").trim().toLowerCase())
      .filter((t) => t.length > 1 && !/^\d+$/.test(t))
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 6);
  }
  return out;
}
