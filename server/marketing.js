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
export function brandKitLine(brandKit) {
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

// ---- Growth tools: modeled on the "growth ideas", "psychology-informed
// copy", "bulk ad variants", and "free tool / lead magnet" marketing
// skills — ephemeral (no persistence, "easy regenerate" per the spec),
// each just a shaped AI prompt with a template fallback so it's still
// useful with no key configured. ----

const PERSUASION_ANGLES = {
  scarcity: "scarcity (limited capacity/tickets remaining — only true if it's actually plausible for this event, never invent a specific number that isn't given)",
  social_proof: "social proof (this is popular/well-attended/talked about — phrase generically, e.g. 'one of the most talked-about nights this month', never invent a specific stat or testimonial that isn't given)",
  urgency: "urgency/FOMO (time is running out to grab a spot, the date is approaching)",
  exclusivity: "exclusivity (this is a special, limited, insider kind of experience, not for everyone)",
};
export const PERSUASION_ANGLE_KEYS = Object.keys(PERSUASION_ANGLES);

// Re-angles the same event's existing copy through one persuasion lens —
// a toggle next to the ad-copy section, not a new page. Falls back to the
// same template copy (unangled) if AI isn't configured; the "angle" is a
// framing nuance real templates can't meaningfully vary, so template mode
// just returns solid generic copy rather than pretending to angle it.
export async function generateAngledCopy(event, brandKit, angle) {
  const angleDesc = PERSUASION_ANGLES[angle];
  if (!angleDesc) throw new Error(`Unknown persuasion angle: ${angle}`);
  if (!aiConfigured()) {
    const t = templateCopy(event);
    return { instagram: t.instagram, whatsapp: t.whatsapp, metaAdVariants: t.metaAdVariants, angle, aiGenerated: false };
  }
  const prompt = `Rewrite promotional copy for this event, specifically framed through this persuasion angle: ${angleDesc}. Stay honest — do not invent statistics, numbers, or claims not given below. Return STRICT JSON with keys
"instagram" (caption, a few hashtags, this persuasion angle should be the clear hook),
"whatsapp" (short, punchy, *bold* markdown, same angle),
"metaAdVariants" (array of exactly 3 {"headline":"...","description":"..."} objects, headline <=40 chars, description <=125 chars, all leaning into this angle).
${brandKitLine(brandKit)}
Event:
title: ${event.title}
venue: ${event.venue}, ${event.area}
when: ${when(event)}
price: ${priceLine(event)}
description: ${event.blurb}
link: ${ctaLink(event)}

Return ONLY the JSON object.`;
  try {
    const copy = await askClaudeJson(prompt, { maxTokens: 900 });
    return { ...copy, angle, aiGenerated: true };
  } catch {
    const t = templateCopy(event);
    return { instagram: t.instagram, whatsapp: t.whatsapp, metaAdVariants: t.metaAdVariants, angle, aiGenerated: false };
  }
}

// Bulk ad-variant generation for A/B testing at scale — same shape as
// googleAdVariants/metaAdVariants above but a caller-chosen count
// (default 3, capped at 10) instead of always exactly 3. Kept as a
// separate function rather than changing generateMarketingCopy's contract
// (that one's cached in MarketingAsset at a fixed shape of exactly 3 each).
export async function generateBulkAdVariants(event, brandKit, { platform = "meta", count = 3 } = {}) {
  const n = Math.max(1, Math.min(10, parseInt(count, 10) || 3));
  const isGoogle = platform === "google";
  const limits = isGoogle ? "headline <=30 characters, description <=90 characters (Google Search Ads limits)" : "headline <=40 characters, description <=125 characters (Meta/Facebook/Instagram ad limits)";
  if (!aiConfigured()) {
    const base = isGoogle ? templateCopy(event).googleAdVariants : templateCopy(event).metaAdVariants;
    const out = [];
    for (let i = 0; i < n; i++) out.push(base[i % base.length]);
    return out;
  }
  const prompt = `Write ${n} distinct ad copy variants for A/B testing, for ${isGoogle ? "Google Search Ads" : "Meta (Facebook/Instagram) Ads"}. Each variant must have a genuinely different angle/hook (not just reworded) — vary between benefit-first, urgency, curiosity, and direct-offer framings across the set. Return STRICT JSON: an array of exactly ${n} objects {"headline":"...","description":"..."}, respecting these limits: ${limits}. Do not invent details not given.
${brandKitLine(brandKit)}
Event:
title: ${event.title}
venue: ${event.venue}, ${event.area}
when: ${when(event)}
price: ${priceLine(event)}
description: ${event.blurb}
link: ${ctaLink(event)}

Return ONLY the JSON array.`;
  try {
    const result = await askClaudeJson(prompt, { maxTokens: 200 + n * 120 });
    return Array.isArray(result) ? result.slice(0, n) : (result.variants || []).slice(0, n);
  } catch {
    const base = isGoogle ? templateCopy(event).googleAdVariants : templateCopy(event).metaAdVariants;
    const out = [];
    for (let i = 0; i < n; i++) out.push(base[i % base.length]);
    return out;
  }
}

// Growth ideas generator — concrete, tactical suggestions specific to this
// event (category/description/venue/area), not generic "post on social
// media" advice. Ephemeral by design (per spec): regenerate any time,
// nothing persisted.
export async function generateGrowthIdeas(event) {
  if (!aiConfigured()) {
    return [
      { title: "Partner with a nearby business", description: `Ask a café or shop near ${event.venue} to display a flyer or QR code in exchange for a shoutout — foot traffic in ${event.area} converts better than cold ads.` },
      { title: "Post in local community groups", description: `Share the event (not just an ad — a real post with a photo and story) in Muscat/${event.area}-focused Facebook and WhatsApp community groups.` },
      { title: "T-minus countdown posts", description: "Use the T-7/T-3/T-1/day-of schedule already generated for this event — posting a countdown consistently outperforms a single announcement." },
      { title: "Early-bird urgency window", description: "If you haven't already, set a real early-bird price that expires in the next few days — a genuine deadline (not fake urgency) reliably pulls forward bookings." },
      { title: "Ask past attendees to share", description: "If this is a repeat event, message last time's attendees directly and ask them to share with one friend — personal asks convert far better than public posts." },
    ];
  }
  const prompt = `You are a tactical growth marketer helping a local event organizer sell more tickets. Given this specific event, suggest 5 to 8 CONCRETE, TACTICAL growth ideas — not generic advice like "use social media" or "run ads". Think: specific partnership types for this category of event, local community angles specific to the area given, timing/urgency tactics, and audience-specific outreach. Every idea must be something the organizer could literally go do this week. Do not invent facts about this event not given below.
Return STRICT JSON: an array of objects {"title":"short punchy title","description":"1-2 sentences, concrete and specific to this event"}.

Event:
title: ${event.title}
category: ${event.cat}
venue: ${event.venue}, ${event.area}
when: ${when(event)}
price: ${priceLine(event)}
description: ${event.blurb}
capacity: ${event.capacity}
tickets sold so far: ${event.sold}

Return ONLY the JSON array.`;
  try {
    const result = await askClaudeJson(prompt, { maxTokens: 1200 });
    const ideas = Array.isArray(result) ? result : (result.ideas || []);
    if (ideas.length) return ideas.slice(0, 8);
  } catch {
    // fall through to the static fallback below
  }
  return [
    { title: "Partner with a nearby business", description: `Ask a café or shop near ${event.venue} to display a flyer or QR code in exchange for a shoutout — foot traffic in ${event.area} converts better than cold ads.` },
    { title: "Post in local community groups", description: `Share the event (not just an ad — a real post with a photo and story) in Muscat/${event.area}-focused Facebook and WhatsApp community groups.` },
    { title: "T-minus countdown posts", description: "Use the T-7/T-3/T-1/day-of schedule already generated for this event — posting a countdown consistently outperforms a single announcement." },
  ];
}

// Free tool / lead-magnet idea generator — text-only concept output (not
// an actual built tool, per spec): a concrete idea the organizer could
// build/commission, plus why it'd attract signups for THIS event's niche.
export async function generateFreeToolIdeas(event) {
  if (!aiConfigured()) {
    return [
      { name: `${event.cat} planning checklist`, description: `A simple downloadable checklist related to ${event.cat} events — collect an email to send it, then invite them to this event in the same email.`, why: "Low effort to make, directly relevant to people already interested in this category." },
    ];
  }
  const prompt = `Suggest 2-3 concrete "free tool" or "lead magnet" ideas for an event organizer to attract email signups, specific to this event's category/niche — e.g. a calculator, quiz, checklist, or template genuinely useful to this audience (not generic "download our newsletter"). For each, explain briefly what it would do and why it would attract the right signups. This is a text concept only — nothing gets built here.
Return STRICT JSON: an array of objects {"name":"short name","description":"what it does, 1-2 sentences","why":"why it attracts the right signups for this event, 1 sentence"}.

Event:
title: ${event.title}
category: ${event.cat}
venue: ${event.venue}, ${event.area}
description: ${event.blurb}

Return ONLY the JSON array.`;
  try {
    const result = await askClaudeJson(prompt, { maxTokens: 700 });
    const ideas = Array.isArray(result) ? result : (result.ideas || []);
    if (ideas.length) return ideas.slice(0, 3);
  } catch {
    // fall through
  }
  return [{ name: `${event.cat} planning checklist`, description: `A simple downloadable checklist related to ${event.cat} events — collect an email to send it, then invite them to this event in the same email.`, why: "Low effort to make, directly relevant to people already interested in this category." }];
}
