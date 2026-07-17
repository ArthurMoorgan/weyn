export interface ParsedQuery {
  q: string;
  when?: "today" | "weekend";
  maxPrice?: number;
}

export function parseSearchQuery(input: string): ParsedQuery {
  const lowerInput = input.toLowerCase().trim();
  const result: ParsedQuery = { q: input };

  // Detect "tonight"
  if (/\btonight\b/.test(lowerInput)) {
    result.when = "today";
  }

  // Detect "this weekend"
  if (/\b(this\s+)?weekend\b/.test(lowerInput)) {
    result.when = "weekend";
  }

  // Detect "free"
  if (/\bfree\b/.test(lowerInput)) {
    result.maxPrice = 0;
  }

  // Detect "under 20" or "under 20 omr"
  const underMatch = lowerInput.match(/\bunder\s+(\d+)\s*(?:omr)?\b/);
  if (underMatch) {
    result.maxPrice = parseInt(underMatch[1], 10);
  }

  return result;
}
