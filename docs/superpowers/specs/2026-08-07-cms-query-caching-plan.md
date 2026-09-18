# CMS client caching with TanStack Query — plan

**Date:** 2026-08-07
**Repo:** `markai-Web-cms` only (no backend changes)
**Status:** plan, awaiting approval

## Goal

Navigating away from a page and back should be instant instead of showing a
spinner and refetching. A **browser reload must always fetch fresh data**, and
each kind of data gets an explicit freshness window.

## What caching will and will not do

It makes the **second** visit instant. It does **not** improve first-load LCP —
that is still gated on `/cms/bookings` taking 1,615 ms because every row calls
`signed_url_for()` and the signing fails (~180 ms per row, uncached failure).
Tracked separately; do not expect this work to move LCP.

## Where the data is fetched today — full inventory

15 files fetch. Five already share one hook; the rest are hand-rolled
`useEffect` + `useState`.

### A. Already on `useServerPage` — fixed centrally, **no page edits**

| Page | Reads |
|---|---|
| `content/page.tsx` | `contentPage` |
| `bookings/page.tsx` | `bookings` |
| `users/page.tsx` | `users` |
| `api-keys/page.tsx` | `apiKeys` |
| `solution/page.tsx` | `solutions` (library) |
| `bookings/page.tsx` (picker modal) | `solutions` |

Rewriting the hook's internals on `useQuery` covers all six at once.

### B. Ad-hoc `useEffect` fetches — converted one at a time

| Page | Reads | Note |
|---|---|---|
| `page.tsx` (dashboard) | `dashboardOverview`, `content`, `solutions`, `screensPage` | 4 parallel, all capped at 5 |
| `screens/page.tsx` | `screensPage` | own debounce + request guard |
| `screens/[id]/page.tsx` | `screen`, `proofReport` | plus a rescan poll |
| `bookings/[id]/page.tsx` | `booking`, `screen` | plus a 15s screenshot poll |
| `bookings/new/page.tsx` | `screen` | selected screen's hours |
| `reports/page.tsx` | `proofReport`, `playsAggregate` | 4 filters + offset |
| `creative-fit/page.tsx` | `fit.jobs`, `fit.job` | plus a job-status poll |
| `assistant/page.tsx` | `ai.sessions`, `ai.session` | plus a poll |
| `components/AiCopilotNav.tsx` | `ai.sessions` | **same data as the assistant page** |
| `solution/page.tsx` (wizard) | `screensPage`, `contentPage` | own debounce + guard |
| `components/creative-fit/SourcePicker.tsx` | `contentPage` | own debounce + guard |

`AiCopilotNav` and the assistant page fetch the identical session list on every
render of the shell. Sharing one query key deduplicates that immediately.

### C. Type-ahead / lookup helpers

| Where | Reads |
|---|---|
| `components/patterns/AsyncSelect.tsx` | via `screenSource` / `mediaSource` / `solutionSource` |
| `lib/async-sources.ts` → `useScreen` | `screen` by id |
| `lib/async-sources.ts` → `useMediaLabels` | `media` by id |

`useMediaLabels` already hand-rolls a per-component cache with a `Set` of
requested ids. A shared query cache replaces it and makes the labels shared
across every component on the page.

### D. Polling loops → `refetchInterval`

| Where | Today |
|---|---|
| `bookings/[id]` | `setInterval(loadScreenshots, 15_000)` while a capture is open |
| `creative-fit` | interval polling job status |
| `assistant` | interval polling a running turn |
| `screens/[id]` | rescan poll, ends on a condition — **leave as-is**, it is a one-shot workflow, not a subscription |

### E. Writes → invalidate instead of manual reload

20 mutation calls. Today each calls `reload()`, which refreshes only the list
you are standing on.

`bulkSetOperatingHours`, `cancelOnDemandScreenshot`, `claimApkByKey`,
`createApiKey`, `createBooking`, `createSolution`, `createUser`, `deleteApiKey`,
`deleteMedia`, `deleteSolution`, `deleteUser`, `regenerateEnrollmentKey`,
`renameMedia`, `requestOnDemandScreenshot`, `toggleScreenshot`, `updateBooking`,
`updateBookingStatus`, `updateScreen`, `updateUser`, `uploadMedia`

## Design

### Query keys

One module, `lib/query-keys.ts`, so nothing invalidates by guessing at a string:

```ts
export const qk = {
  bookings: (p) => ["bookings", p] as const,
  booking:  (id) => ["booking", id] as const,
  screens:  (p) => ["screens", p] as const,
  screen:   (id) => ["screen", id] as const,
  content:  (p) => ["content", p] as const,
  media:    (id) => ["media", id] as const,
  users:    (p) => ["users", p] as const,
  apiKeys:  (p) => ["api-keys", p] as const,
  solutions:(p) => ["solutions", p] as const,
  // …
};
```

### Freshness windows

| Data | `staleTime` | Why |
|---|---|---|
| Screens, dashboard overview | 15 s | live status changes on its own |
| Bookings, content, solutions, proof-of-play | 30 s | changes when an operator edits |
| Users, API keys, APK releases | 60 s | rarely change |
| Single-row lookups (`screen`, `media` by id) | 5 min | labels; effectively immutable |

Within a window, revisiting a page is instant with no request. Past it, cached
rows render immediately and refresh behind you.

### Reload always fetches fresh

The cache is **in memory only** — never persisted to `localStorage` or
`sessionStorage`. A browser reload starts from an empty cache, so it is always
fresh by construction, with nothing to configure or expire.

### `useServerPage` rewrite

Public API stays byte-identical so the six pages in group A need no edits:

| Today | After |
|---|---|
| `createRequestGuard()` | React Query orders responses |
| `loading` / `firstLoad` | `isFetching` / `isPending` |
| dim-while-loading | `placeholderData: keepPreviousData` |
| `reload()` | `invalidateQueries(key)` |
| `setItems()` | `queryClient.setQueryData(key, …)` |

The 300 ms search debounce stays — it decides *when a key changes*, which is
upstream of the cache.

`createRequestGuard` stays exported: `AsyncSelect`, the solution wizard and
`SourcePicker` use it directly until group C is converted.

## Phasing

Each phase ships and is verifiable on its own.

1. **Provider + query keys + `useServerPage` rewrite.** Covers six pages, no page
   edits. Verify: search, paging, filters, and each page's create/delete.
2. **Mutations → invalidation.** Removes the manual `reload()` calls.
3. **Dashboard + screens + reports.** The highest-traffic ad-hoc pages.
4. **Detail pages + polling** → `refetchInterval`.
5. **Pickers and lookups** (`AsyncSelect`, `useScreen`, `useMediaLabels`),
   deleting the hand-rolled cache in `useMediaLabels`.

## Decisions needed

1. **Refetch on window focus?** Recommend **yes** — a signage dashboard should be
   current when you look back at it.
2. **Retry failed requests?** Recommend **1** retry. The default of 3 turns a
   genuine error into a 3-second wait before the message appears.

## Out of scope

- LCP / the GCS signing failure.
- Server-side rendering — reverted at your request; nothing here depends on it.
- Persisting the cache across reloads — deliberately excluded (see above).

## Risks

| Risk | Mitigation |
|---|---|
| Rewriting a hook six pages depend on | Public API unchanged; 245 existing tests plus manual pass per page |
| An invalidation key typo silently stops refreshing a list | All keys in one module, none inline |
| Stale data after a write | Invalidate on every mutation; phase 2 exists for exactly this |
| +13 kB gzipped | Accepted; baseline is 102 kB |
