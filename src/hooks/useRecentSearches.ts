const STORAGE_KEY = "weyn:recent-searches";
const MAX_ITEMS = 10;

export function addRecentSearch(query: string): void {
  if (!query.trim()) return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const queries: string[] = stored ? JSON.parse(stored) : [];

    // Remove if already exists (avoid duplicates)
    const filtered = queries.filter((q) => q !== query);

    // Add to end (most recent)
    filtered.push(query);

    // Keep only the last MAX_ITEMS
    const trimmed = filtered.slice(-MAX_ITEMS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Silently fail if localStorage is unavailable (e.g., quota exceeded)
  }
}

export function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const queries = JSON.parse(stored);
    // Return in reverse order (most recent first)
    return Array.isArray(queries) ? queries.reverse() : [];
  } catch {
    // Silently fail if localStorage is unavailable or JSON is corrupted
    return [];
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail if localStorage is unavailable
  }
}
