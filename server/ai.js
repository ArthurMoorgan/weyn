// Optional LLM helper, used to upgrade the event-draft validation and the
// marketing-copy generator from deterministic templates to real generated text.
// Fully optional — everything that calls this has a solid non-AI fallback, so
// the app works identically with or without a key.
//
// Auto-detects the provider from whichever key is set (in priority order):
//   ANTHROPIC_API_KEY  -> Claude
//   GEMINI_API_KEY     -> Google Gemini (free tier at aistudio.google.com/apikey)
//   GROQ_API_KEY       -> Groq (free tier at console.groq.com)

const PROVIDERS = {
  anthropic: {
    key: () => process.env.ANTHROPIC_API_KEY,
    model: () => process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022",
    async call(prompt, maxTokens, key, model) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.content?.[0]?.text || "";
    },
  },
  gemini: {
    key: () => process.env.GEMINI_API_KEY,
    model: () => process.env.GEMINI_MODEL || "gemini-2.0-flash",
    async call(prompt, maxTokens, key, model) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
        }),
      });
      if (!res.ok) throw new Error(`Gemini API error (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    },
  },
  groq: {
    key: () => process.env.GROQ_API_KEY,
    model: () => process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    async call(prompt, maxTokens, key, model) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) throw new Error(`Groq API error (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    },
  },
};

const ORDER = ["anthropic", "gemini", "groq"];

function activeProvider() {
  for (const name of ORDER) {
    if (PROVIDERS[name].key()) return name;
  }
  return null;
}

export function aiConfigured() {
  return !!activeProvider();
}

export function aiProviderName() {
  return activeProvider();
}

export async function askClaude(prompt, { maxTokens = 500 } = {}) {
  const name = activeProvider();
  if (!name) throw new Error("No LLM key set (ANTHROPIC_API_KEY / GEMINI_API_KEY / GROQ_API_KEY)");
  const p = PROVIDERS[name];
  return p.call(prompt, maxTokens, p.key(), p.model());
}

// asks for strict JSON back and parses it, tolerating a ```json fence and any
// stray prose before/after the object.
export async function askClaudeJson(prompt, opts) {
  const text = await askClaude(prompt, opts);
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // if the model wrapped the JSON in prose, grab the first {...} block
  if (!cleaned.startsWith("{")) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) cleaned = m[0];
  }
  return JSON.parse(cleaned);
}

// ---- image focal-point suggestion (Groq vision only) ----
// Deliberately Groq-specific, not routed through the generic multi-provider
// `call()` table above — those only send plain-text prompts, and vision
// needs a multimodal message body. Falls back to a plain center crop
// (return null) if GROQ_API_KEY isn't set, the image is too large for a
// single request, or the model call fails for any reason — this is a
// cosmetic nicety, never something that should block publishing an event.
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_VISION_REQUEST_BYTES = 4 * 1024 * 1024; // Groq's base64 request cap

export function visionConfigured() {
  return !!process.env.GROQ_API_KEY;
}

export async function suggestImageFocalPoint(imageBuffer, mimeType) {
  if (!process.env.GROQ_API_KEY) return null;
  const base64 = imageBuffer.toString("base64");
  // base64 inflates size ~33% — the request body (JSON + base64) needs to
  // stay under Groq's 4MB limit, so bail out early on large uploads rather
  // than firing a request we know will 413.
  if (base64.length > MAX_VISION_REQUEST_BYTES * 0.7) return null;

  const prompt = `This image will be cropped to fit a wide card thumbnail, which may cut off the top/bottom or sides. Identify the single most important focal point (the main subject — a face, the food, the stage, the crowd — not empty sky/wall/floor). Respond with ONLY a JSON object: {"x": <0-100, left-to-right percent>, "y": <0-100, top-to-bottom percent>}. No other text.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        max_tokens: 50,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const { x, y } = JSON.parse(match[0]);
    if (typeof x !== "number" || typeof y !== "number") return null;
    const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
    return `${clamp(x)}% ${clamp(y)}%`;
  } catch {
    return null; // network hiccup, bad JSON, whatever — just use the default center crop
  }
}
