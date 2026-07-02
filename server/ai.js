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
