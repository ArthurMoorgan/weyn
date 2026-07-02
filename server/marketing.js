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

function templateCopy(e) {
  const tagLine = (e.tags || []).slice(0, 4).map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");
  const link = ctaLink(e);

  const instagram =
    `${e.title} 📍 ${e.venue}, ${e.area}\n${when(e)}\n${priceLine(e)}\n\n${e.blurb}\n\n${link ? "Link in bio / " + link : ""}\n${tagLine} #muscat #whatsoninmuscat`.trim();

  const whatsapp =
    `*${e.title}*\n📍 ${e.venue}, ${e.area}\n🗓 ${when(e)}\n💵 ${priceLine(e)}\n\n${e.blurb}\n\n${link ? "Details/tickets: " + link : ""}`.trim();

  const telegram =
    `📢 *${e.title}*\n\n${e.blurb}\n\n📍 ${e.venue} — ${e.area}\n🗓 ${when(e)}\n💵 ${priceLine(e)}\n${link ? "\n👉 " + link : ""}`.trim();

  const twitter =
    `${e.title} — ${when(e)} @ ${e.venue}, ${e.area}. ${priceLine(e)}. ${link}`.slice(0, 280);

  return { instagram, whatsapp, telegram, twitter };
}

async function aiCopy(e) {
  const prompt = `Write promotional copy for this event, for four channels. Return STRICT JSON with keys
"instagram" (caption with line breaks and a few relevant hashtags, engaging tone),
"whatsapp" (short, punchy, uses *bold* markdown, good for forwarding in a group chat),
"telegram" (similar to whatsapp but for a channel post),
"twitter" (a single tweet, <=280 characters, no hashtag spam).
Include the venue, date/time, and price naturally. Do not invent details not given.

Event:
title: ${e.title}
venue: ${e.venue}, ${e.area}
when: ${when(e)}
price: ${priceLine(e)}
description: ${e.blurb}
link: ${ctaLink(e)}

Return ONLY the JSON object.`;
  return askClaudeJson(prompt, { maxTokens: 700 });
}

export async function generateMarketingCopy(event) {
  if (aiConfigured()) {
    try {
      const copy = await aiCopy(event);
      return { ...copy, generatedAt: new Date().toISOString(), aiGenerated: true };
    } catch {
      // fall through to templates on any AI hiccup
    }
  }
  return { ...templateCopy(event), generatedAt: new Date().toISOString(), aiGenerated: false };
}
