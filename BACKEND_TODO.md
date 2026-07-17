# Backend Work For HomeFeed & Discovery

This document tracks backend work needed to fully power the HomeFeed personalized sections in Discover/Explore.

## Current Implementation
- **HomeFeed** renders 11-12 client-side derived sections from a single `listEvents()` call
- **Explore** provides search, category filters, time filters (Today/Tomorrow/This Weekend), and price slider
- **Recently Viewed** and **Popular Organizers** are fully functional
- **Friends Are Going** fetches from `api.followingFeed()` (organizers the user follows)

## Future Enhancements (Deferred)

### 1. AI Recommendations Section
**Status:** Not yet built  
**Current behavior:** Stub that could show featured + trending events  
**What it needs:**
- Recommendation engine that learns from user behavior:
  - Event view history
  - Saved/liked events
  - Time spent on event detail pages
  - Search patterns
- Backend endpoint: `POST /recommendations` or `GET /user/recommendations?limit=10`
- Return ranked list of personalized event suggestions
- Cache results per user to avoid repeated computation

**Integration point:** HomeFeed.tsx line ~60 (planned new section)

### 2. Because You Liked Section
**Status:** Not yet built  
**Current behavior:** N/A  
**What it needs:**
- Fetch user's saved/liked events: `GET /user/saved-events` or `GET /user/likes`
- For each saved event, find similar events:
  - Same category
  - Same organizer
  - Same venue/area
  - Same price range
- Backend could compute similarities directly or return a curated list: `GET /events/similar?eventId=X&limit=10`
- Mark which ones the user hasn't interacted with yet

**Easy enhancement:** Can be deferred to post-launch if saving/likes feature is first prioritized.

**Integration point:** HomeFeed.tsx (optional new section if user has saved events)

### 3. Pull-to-Refresh UX Enhancement
**Status:** Partially implemented (web-only via PullToRefresh.tsx)  
**Current behavior:** Works in browser but limited iOS/Android native feel  
**What it needs:**
- Capacitor integration for native iOS/Android:
  - `@capacitor/core` RefreshController API
  - Native pull-down gesture recognition and haptic feedback
  - Coordinated with web implementation to detect platform
- Backend: already supports refresh (just re-fetches `listEvents()`)
- Monitor refresh frequency to avoid excessive API calls

**Note:** Current implementation is sufficient for web; native polish can come later.

### 4. Popular Organizers Linking
**Status:** Mostly done  
**Current behavior:** Links to `/organizer/{ownerId}` if ownerId exists, else `/search?q={name}`  
**What it needs:**
- Ensure organizer profile pages exist and handle all fields:
  - Organizer name, bio, image
  - Events list (past + upcoming)
  - Follow/unfollow button (already exists)
  - Social links if available
- Backend: Organizer profiles likely need a dedicated endpoint if not already exposed

**Integration point:** HomeFeed.tsx lines 107-108

### 5. Section Title Deep-Linking
**Status:** Not yet built  
**Current behavior:** Static headings that don't navigate  
**What it needs:**
- Make section titles clickable to filtered Search/Explore views:
  - "Recently Viewed" → filtered list view of recently-viewed events
  - "Trending Now" → `/explore?sort=trending` (needs trending sort backend)
  - "Friends Are Going" → `/explore?filter=following` (needs following filter backend)
  - "Popular Organizers" → `/search?type=organizer` (search filtered to organizers only)
- Backend filters:
  - `?sort=trending` — order by event.sold (attendance count)
  - `?filter=following` — events from followed organizers
  - `?type=organizer` — search suggests/lists organizers, not events
- Ensures users can drill deeper into sections without app friction

**Integration point:** HomeFeed.tsx section headers (clickable Link wrappers)

## Summary Table

| Feature | Status | Effort | Backend Needed |
|---------|--------|--------|---|
| Recently Viewed | ✅ Done | — | No (localStorage) |
| Friends Are Going | ✅ Done | — | No (followingFeed exists) |
| Popular Organizers | ✅ Done | — | Partial (profile pages) |
| AI Recommendations | ❌ Stub | Medium | Yes (recommendation engine) |
| Because You Liked | ❌ Not started | Low | Conditional (if saving enabled) |
| Pull-to-Refresh Native | ⚠️ Web only | Low | No (Capacitor upgrade) |
| Deep-Linking Sections | ❌ Not started | Medium | Yes (new filters/sorts) |

## Recommended Priority

1. **AI Recommendations** — biggest UX impact, enables discovery for non-logged-in users
2. **Deep-Linking** — low friction to unlock per-section drill-down
3. **Because You Liked** — easy win once saving/likes are prioritized
4. **Native Pull-to-Refresh** — polish, can wait for iOS/Android optimization phase
5. **Organizer Profiles** — likely already exists, just needs HomeFeed integration
