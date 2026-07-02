// Optional Claude API call, used to upgrade the Instagram-caption parser and
// the marketing-copy generator from deterministic templates to real generated
// text. Fully optional — everything that calls this has a solid non-AI
// fallback, so the app works identically with or without this configured.
//
// Set ANTHROPIC_API_KEY to enable it (get one at console.anthropic.com).

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function askClaude(prompt, { maxTokens = 500 } = {}) {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error (${res.status})`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// asks for strict JSON back and parses it, tolerating a ```json fence
export async function askClaudeJson(prompt, opts) {
  const text = await askClaude(prompt, opts);
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned);
}
