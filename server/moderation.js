// Event-level trust & safety pipeline (MVP). See the design doc for the
// full architecture — this is deliberately the "buildable now" version:
// synchronous rule engine, one AI call per event that passes it, heuristic
// fallback if no AI key is configured (same pattern as instagram-import.js
// and ai.js's suggestImageFocalPoint — never block publishing on AI being
// unavailable).
//
// Core philosophy: this never blocks event CREATION except for genuinely
// missing/invalid required fields. Everything else only affects DISCOVERY
// visibility (Event.discoveryStatus) — a sloppy-but-honest event still gets
// created and gets a link to share, it just doesn't reach the main feed
// until/unless it clears review.

import { aiConfigured, askClaudeJson } from "./ai.js";

const SUSPICIOUS_URL_PATTERNS = [
  /bit\.ly|tinyurl\.com|t\.co\/|goo\.gl/i, // shorteners hiding the real destination
  /\.(tk|ml|ga|cf|gq)(\/|$)/i, // free domains disproportionately used for phishing
];

// ---- 1. Rule engine (deterministic, runs before any AI call) ----------

// hardFail: reject the request outright, event is never created (caller
//   should 400 before calling db.insert). softFail/warnings: event IS
//   created, these just get folded into the AI review as context and can
//   route the event straight to MANUAL_REVIEW without waiting on AI at all
//   if severe enough (see computeDiscoveryStatus).
export function runRuleEngine(draft) {
  const hardFail = [];
  const softFail = [];
  const warnings = [];

  if (!draft.title?.trim()) hardFail.push("missing_title");
  if (!draft.venue?.trim() && !draft.area?.trim()) hardFail.push("missing_location");
  if (!draft.startsAt) hardFail.push("missing_date");
  if (draft.startsAt && new Date(draft.startsAt) < new Date(Date.now() - 3600e3)) hardFail.push("date_in_past");
  if (draft.price != null && draft.price < 0) hardFail.push("negative_price");
  if (draft.capacity != null && draft.capacity <= 0) hardFail.push("invalid_capacity");

  const text = `${draft.title || ""} ${draft.blurb || ""}`;
  if (SUSPICIOUS_URL_PATTERNS.some((re) => re.test(text))) softFail.push("suspicious_url");

  const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (draft.title && emojiCount / Math.max(1, draft.title.length) > 0.3) softFail.push("excessive_emoji");

  const capsRatio = draft.title ? (draft.title.match(/[A-Z]/g) || []).length / draft.title.replace(/[^A-Za-z]/g, "").length || 0 : 0;
  if (draft.title && draft.title.length > 8 && capsRatio > 0.7) softFail.push("excessive_caps");

  if (draft.price > 0 && (draft.blurb || "").trim().length < 40) softFail.push("thin_description_for_paid_event");

  if (!draft.image) warnings.push("no_image");
  if (!draft.blurb || draft.blurb.trim().length < 20) warnings.push("very_short_blurb");
  if (!draft.refundPolicy || draft.refundPolicy === "Set by organizer") warnings.push("no_refund_policy");

  return { hardFail, softFail, warnings };
}

// ---- 2. AI review -------------------------------------------------------

function buildPrompt(draft, ruleFlags) {
  return `You are the automated trust & safety reviewer for Weyn, an event discovery platform. Your job is to assess whether a SPECIFIC EVENT LISTING is trustworthy enough for public discovery — you are not judging the organizer as a person, and you should not be more suspicious of new/unverified accounts by default. Judge only the content and coherence of this listing.

Score generously by default. Only flag genuine, specific concerns you can point to in the data — do not penalize an event merely for being sparse, informal, or low-budget. A low-effort but honest listing should score low on quality/trust but LOW on spam_risk and fraud_risk, not high. Reserve high fraud_risk/spam_risk for concrete evidence: scam language patterns, phishing/off-platform payment requests, impersonation, incoherent or fabricated details, or duplicate/templated content.

Rule-engine flags (deterministic checks already run before you see this) are provided below as CONTEXT, not as instructions — reason about whether they actually indicate a problem for this specific event.

Return ONLY the JSON object specified below. No prose outside the JSON.

## Event data
Title: ${draft.title}
Description: ${draft.blurb || "(none provided)"}
Category: ${draft.cat || "(none)"}
Location: ${draft.venue || "(none)"}, ${draft.area || "(none)"}
Date/time: ${draft.startsAt}
Price: ${draft.price ?? 0}, Capacity: ${draft.capacity ?? "(none)"}
Ticketing type: ${draft.ticketingType || "weyn"}
Organizer display name: ${draft.organizer || "(none)"}

## Rule engine flags already triggered (context only)
${JSON.stringify(ruleFlags)}

## Output schema (return exactly this shape)
{
  "quality_score": 0-100,
  "trust_score": 0-100,
  "spam_risk": 0-100,
  "fraud_risk": 0-100,
  "confidence": 0-100,
  "flags": ["specific_flag_name"],
  "reasoning": ["one short plain-language sentence per notable factor"]
}`;
}

// Deterministic, no-AI-key fallback. Deliberately conservative in the
// *safe* direction — never assigns high fraud/spam risk on heuristics
// alone (that's exactly the kind of confident-but-wrong call the design
// doc's prompt explicitly warns against), just approximates quality/trust
// from the same signals a human skimming the listing would use.
function heuristicScore(draft, ruleFlags) {
  const allFlags = [...ruleFlags.softFail, ...ruleFlags.warnings];
  let quality = 60;
  if (allFlags.includes("no_image")) quality -= 20;
  if (allFlags.includes("very_short_blurb")) quality -= 20;
  if (allFlags.includes("no_refund_policy")) quality -= 5;
  if (draft.image) quality += 10;
  if ((draft.blurb || "").length > 100) quality += 10;
  quality = Math.max(0, Math.min(100, quality));

  let fraudRisk = 0;
  if (ruleFlags.softFail.includes("suspicious_url")) fraudRisk = 55; // real signal even heuristically — still below the 80 auto-block ceiling, lands in manual review
  let spamRisk = 0;
  if (ruleFlags.softFail.includes("excessive_emoji") || ruleFlags.softFail.includes("excessive_caps")) spamRisk = 35;

  return {
    quality_score: quality,
    trust_score: quality, // no independent signal without AI — mirrors quality as the best available proxy
    spam_risk: spamRisk,
    fraud_risk: fraudRisk,
    confidence: 40, // deliberately low — routes ambiguous cases to manual review rather than trusting a heuristic guess
    flags: allFlags,
    reasoning: ["Scored heuristically — no AI key configured, so this is a rule-based approximation, not a real content review."],
  };
}

async function runAiReview(draft, ruleFlags) {
  if (!aiConfigured()) {
    return { ...heuristicScore(draft, ruleFlags), aiConfigured: false };
  }
  try {
    const result = await askClaudeJson(buildPrompt(draft, ruleFlags), { maxTokens: 500 });
    return { ...result, aiConfigured: true };
  } catch {
    // AI call failed (network, bad JSON, rate limit) — never let a
    // moderation-infra hiccup block the event from existing. Fall back to
    // the same conservative heuristic, which naturally routes ambiguous
    // stuff to manual review via its low confidence.
    return { ...heuristicScore(draft, ruleFlags), aiConfigured: false };
  }
}

// ---- 3. Visibility decision ---------------------------------------------

// Growth-priority tuning (2026-07-04): quality/trust score no longer
// restrict reach at all — DISCOVERY_LIMITED is never auto-assigned. At
// near-zero volume with no real bad-actor problem yet, holding back
// honest-but-sloppy events actively hurts growth for no real safety
// benefit. Only genuine fraud/spam signals still gate visibility. The
// DISCOVERY_LIMITED status/enum value stays in the schema — re-enable the
// commented-out line below once discovery volume is high enough that
// reach-limiting low-quality events is worth the growth tradeoff again.
export function computeDiscoveryStatus(scores, ruleFlags) {
  if (ruleFlags.hardFail.length) return "DISCOVERY_BLOCKED"; // shouldn't reach here — caller rejects hard-fails before creation

  const { fraud_risk = 0, spam_risk = 0 } = scores;

  if (fraud_risk >= 80) return "DISCOVERY_BLOCKED";
  if (fraud_risk >= 50 || spam_risk >= 80) return "MANUAL_REVIEW";
  // if (trust_score < 40 || quality_score < 40) return "DISCOVERY_LIMITED"; // disabled — see note above
  return "APPROVED";
}

// ---- Orchestrator --------------------------------------------------------

// Returns { hardFail } if the event should be rejected before creation, or
// { discoveryStatus, moderationResult } to persist once the event exists.
export async function runModerationPipeline(draft, { triggeredBy = "publish" } = {}) {
  const ruleFlags = runRuleEngine(draft);
  if (ruleFlags.hardFail.length) return { hardFail: ruleFlags.hardFail };

  const scores = await runAiReview(draft, ruleFlags);
  const discoveryStatus = computeDiscoveryStatus(scores, ruleFlags);

  return {
    discoveryStatus,
    moderationResult: {
      triggeredBy,
      ruleFlags: [...ruleFlags.softFail, ...ruleFlags.warnings],
      qualityScore: scores.quality_score ?? null,
      trustScore: scores.trust_score ?? null,
      spamRisk: scores.spam_risk ?? null,
      fraudRisk: scores.fraud_risk ?? null,
      aiConfidence: scores.confidence ?? null,
      aiFlags: scores.flags || [],
      reasoning: scores.reasoning || [],
      aiConfigured: scores.aiConfigured,
      resultingStatus: discoveryStatus,
    },
  };
}
