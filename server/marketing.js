// Feature 2: Create Once, Publish Everywhere.
// Generates ready-to-post copy for four channels from an event's own data.
// Uses a real Claude call for punchier, varied copy if ANTHROPIC_API_KEY is
// set; otherwise falls back to solid, genuinely usable templates — either
// way the organizer gets real text they can copy and post today.

import { aiConfigured, askClaudeJson } from "./ai.js";

function when(e) {
  const d = new Date(e.startsAt);
  return d.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Muscat" });
}
function priceLine(e) {
  return e.price === 0 ? "Free entry" : `${e.price} OMR`;
}
function ctaLink(e) {
  if (e.ticketingType === "external" || e.ticketingType === "registration") return e.externalTicketUrl || "";
  return `weyn.app/e/${e.id}`; // illustrative — swap for your real deployed domain
}

// Countdown dates are computed here rather than by the AI/template copy —
// they're plain arithmetic off startsAt, not something worth a model call,
// and stay correct even when the template fallback is used.
export function scheduleDates(e) {
  const start = new Date(e.startsAt);
  const daysBefore = (n) => new Date(start.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
  return {
    "T-7": daysBefore(7),
    "T-3": daysBefore(3),
    "T-1": daysBefore(1),
    "Day-of": daysBefore(0),
  };
}

function templateCopy(e) {
  const tagLine = (e.tags || []).slice(0, 4).map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");
  const link = ctaLink(e);

  const instagram =
    `${e.title} 📍 ${e.venue}, ${e.area}\n${when(e)}\n${priceLine(e)}\n\n${e.blurb}\n\n${link ? "Link in bio / " + link : ""}\n${tagLine} #muscat #whatsoninmuscat`.trim();

  const instagramStory =
    `${e.title}\n${when(e)}\n${priceLine(e)}\n\nTap the link 👆`.trim();

  const whatsapp =
    `*${e.title}*\n📍 ${e.venue}, ${e.area}\n🗓 ${when(e)}\n💵 ${priceLine(e)}\n\n${e.blurb}\n\n${link ? "Details/tickets: " + link : ""}`.trim();

  const whatsappBroadcast =
    `Hey! Thought you'd want to know about this 👇\n\n*${e.title}* — ${when(e)}\n📍 ${e.venue}, ${e.area} · ${priceLine(e)}\n${link ? link : ""}`.trim();

  const telegram =
    `📢 *${e.title}*\n\n${e.blurb}\n\n📍 ${e.venue} — ${e.area}\n🗓 ${when(e)}\n💵 ${priceLine(e)}\n${link ? "\n👉 " + link : ""}`.trim();

  const twitter =
    `${e.title} — ${when(e)} @ ${e.venue}, ${e.area}. ${priceLine(e)}. ${link}`.slice(0, 280);

  const dates = scheduleDates(e);
  const schedule = [
    { stage: "T-7", date: dates["T-7"], label: "One week out", text: `${e.title} is happening in a week — ${when(e)} at ${e.venue}. ${priceLine(e)}. ${link}`.trim() },
    { stage: "T-3", date: dates["T-3"], label: "3 days left", text: `3 days to go: ${e.title}, ${when(e)}. ${e.venue}, ${e.area}. ${link}`.trim() },
    { stage: "T-1", date: dates["T-1"], label: "Tomorrow", text: `Tomorrow! ${e.title} at ${e.venue}. ${priceLine(e)}. Don't miss it — ${link}`.trim() },
    { stage: "Day-of", date: dates["Day-of"], label: "Today", text: `Today's the day 🎉 ${e.title}, ${when(e)}. See you at ${e.venue} — ${link}`.trim() },
  ];

  // Ad-platform copy, kept template-generated (not AI) in the fallback path
  // the same way every other channel above is — real, usable text even
  // with no ANTHROPIC_API_KEY configured, just less varied than the AI path.
  const googleAdVariants = [
    { headline: `${e.title}`.slice(0, 30), description: `${priceLine(e)} · ${e.venue}, ${e.area}. ${when(e)}.`.slice(0, 90) },
    { headline: `${e.venue} — ${e.title}`.slice(0, 30), description: `${e.blurb}`.slice(0, 90) },
    { headline: `Get tickets: ${e.title}`.slice(0, 30), description: `${when(e)}. ${priceLine(e)}. Book now.`.slice(0, 90) },
  ];
  const metaAdVariants = [
    { headline: `${e.title}`.slice(0, 40), description: `${e.blurb} — ${when(e)} at ${e.venue}, ${e.area}. ${priceLine(e)}.`.slice(0, 125) },
    { headline: `Don't miss ${e.title}`.slice(0, 40), description: `${priceLine(e)} · ${when(e)} · ${e.venue}. ${link}`.slice(0, 125) },
    { headline: `${e.venue} presents: ${e.title}`.slice(0, 40), description: `${e.blurb}`.slice(0, 125) },
  ];
  const pressRelease =
    `${(e.area || "MUSCAT").toUpperCase()} — ${e.title} is set to take place ${when(e)} at ${e.venue}, ${e.area}.\n\n${e.blurb}\n\n${priceLine(e)}. ${link ? "More information and tickets: " + link : ""}\n\nFor media inquiries, contact the event organizer directly.`.trim();
  const influencerDm =
    `Hey! I'm putting on ${e.title} at ${e.venue}, ${e.area} on ${when(e)}, and thought you'd genuinely love it — would you be up for coming through (on us) and sharing it with your audience if it's a fit? No pressure either way, happy to send more details. ${link ? link : ""}`.trim();

  return { instagram, instagramStory, whatsapp, whatsappBroadcast, telegram, twitter, schedule, googleAdVariants, metaAdVariants, pressRelease, influencerDm };
}

// Brand kit is optional — a null/empty kit renders as nothing extra in the
// prompt, so an organizer who hasn't set one up gets exactly the same copy
// as before this feature existed.
function brandKitLine(brandKit) {
  if (!brandKit) return "";
  const tone = brandKit.toneOfVoice ? `Tone of voice: ${brandKit.toneOfVoice}.` : "";
  const color = brandKit.primaryColor ? `Brand color (mention only if writing something like a poster/ad description that references color): ${brandKit.primaryColor}.` : "";
  const line = [tone, color].filter(Boolean).join(" ");
  return line ? `\nBrand guidance — follow this for all copy: ${line}\n` : "";
}

async function aiCopy(e, brandKit) {
  const prompt = `Write promotional copy for this event, for several channels and a countdown posting schedule. Return STRICT JSON with keys
"instagram" (caption with line breaks and a few relevant hashtags, engaging tone),
"instagramStory" (very short text overlay for an Instagram/WhatsApp Story — 3 lines max, no hashtags, ends with a call to tap the link),
"whatsapp" (short, punchy, uses *bold* markdown, good for forwarding in a group chat),
"whatsappBroadcast" (a warmer, more personal variant for a broadcast list/close contacts — like telling a friend, not announcing),
"telegram" (similar to whatsapp but for a channel post),
"twitter" (a single tweet, <=280 characters, no hashtag spam),
"schedule" (an array of exactly 4 objects, one per countdown stage in this order: {"stage":"T-7","label":"One week out","text":"..."}, {"stage":"T-3","label":"3 days left","text":"..."}, {"stage":"T-1","label":"Tomorrow","text":"..."}, {"stage":"Day-of","label":"Today","text":"..."} — each "text" is a short standalone post building urgency toward the event, reusable on Instagram/WhatsApp),
"googleAdVariants" (an array of exactly 3 objects {"headline":"...","description":"..."} — headline <=30 characters, description <=90 characters, Google Search Ads limits, punchy and benefit-first),
"metaAdVariants" (an array of exactly 3 objects {"headline":"...","description":"..."} — headline <=40 characters, description <=125 characters, Meta/Facebook/Instagram ad limits),
"pressRelease" (a short press-release-style announcement, 3-4 short paragraphs, third person, factual/newsworthy tone, dateline-style opening line e.g. "MUSCAT, Oman —"),
"influencerDm" (a short, warm, non-spammy direct message an organizer could send to an influencer or potential partner inviting them to the event/a collab, first person, casual but professional).
Include the venue, date/time, and price naturally. Do not invent details not given.
${brandKitLine(brandKit)}
Event:
title: ${e.title}
venue: ${e.venue}, ${e.area}
when: ${when(e)}
price: ${priceLine(e)}
description: ${e.blurb}
link: ${ctaLink(e)}

Return ONLY the JSON object.`;
  return askClaudeJson(prompt, { maxTokens: 1400 });
}

// The 4 countdown dates are always computed here, never asked of the model —
// they're exact arithmetic off startsAt and must stay correct regardless of
// which copy source (AI or template) supplied the schedule text.
function withScheduleDates(e, schedule) {
  const dates = scheduleDates(e);
  return (schedule || []).map((s) => ({ ...s, date: dates[s.stage] ?? null }));
}

export async function generateMarketingCopy(event, brandKit = null) {
  if (aiConfigured()) {
    try {
      const copy = await aiCopy(event, brandKit);
      return { ...copy, schedule: withScheduleDates(event, copy.schedule), generatedAt: new Date().toISOString(), aiGenerated: true };
    } catch {
      // fall through to templates on any AI hiccup
    }
  }
  return { ...templateCopy(event), generatedAt: new Date().toISOString(), aiGenerated: false };
}
