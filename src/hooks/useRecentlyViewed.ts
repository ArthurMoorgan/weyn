const STORAGE_KEY = "weyn:recently-viewed";
const MAX_ITEMS = 20;

export function addRecentlyViewed(eventId: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const ids: string[] = stored ? JSON.parse(stored) : [];

    // Remove if already exists (avoid duplicates)
    const filtered = ids.filter((id) => id !== eventId);

    // Add to end (most recent)
    filtered.push(eventId);

    // Keep only the last MAX_ITEMS
    const trimmed = filtered.slice(-MAX_ITEMS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Silently fail if localStorage is unavailable (e.g., quota exceeded)
  }
}

export function getRecentlyViewed(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const ids = JSON.parse(stored);
    // Return in reverse order (most recent first)
    return Array.isArray(ids) ? ids.reverse() : [];
  } catch {
    // Silently fail if localStorage is unavailable or JSON is corrupted
    return [];
  }
}
