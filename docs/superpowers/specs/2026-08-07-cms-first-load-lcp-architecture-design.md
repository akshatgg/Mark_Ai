# CMS first-load architecture — fixing LCP

**Date:** 2026-08-07
**Repos:** `markai-Web-cms` (all changes), `markai-signage-api` (none)
**Status:** approved, pending implementation plan

## Problem

Opening `/bookings` measured **LCP 3,797 ms** (Chrome DevTools trace, `next dev`).
The breakdown is what matters:

| Phase | Time | Share |
|---|---|---|
| TTFB | 98 ms | 2.6% |
| Element render delay | 3,699 ms | **97.4%** |

The server is not slow. The API returns 5.5 KB and answers quickly. The LCP element
is a `<td>`'s text, so LCP fires when the campaigns table finally paints — and the
table cannot paint until two API calls have completed **in series**.

### Why they are serial

`bookings/page.tsx` is `"use client"`, so the HTML Next sends contains no table.
Then:

```
JS downloads → React hydrates
   ↓
AuthProvider mounts with loading = true
   ↓
DashboardLayout:  if (loading || !user) return <LoadingState "Checking session…" />
   ↓                       ⬆ returns the spinner INSTEAD OF children
GET /cms/auth/me                                    ← round trip 1
   ↓
loading = false → AppShell + BookingsPage finally mount
   ↓
GET /cms/bookings                                   ← round trip 2
   ↓
table paints → LCP
```

`DashboardLayout` returns a spinner *instead of* `children`. The page component is
therefore never mounted, its `useEffect` never runs, and the browser has no way to
know `/cms/bookings` will be needed. The second request is not merely late — it is
**undiscoverable** until the first resolves. It cannot be preloaded, parallelised or
preconnected.

The trace confirms the ordering: `/cms/auth/me` (reqid 38) then `/cms/bookings`
(reqid 43).

### The detail that makes it fixable

`AuthContext.tsx:31-48` already reads the user from `localStorage` synchronously:

```ts
const stored = getStoredUser();
if (stored) setUser(stored);              // available immediately, no network
api.me().then(...).finally(() => setLoading(false));   // but loading stays true
```

The user is in hand before any request is made. A single `loading` flag discards
that and serialises everything behind it.

## Goal

Make authentication known **before any JavaScript runs**, and put the first page of
data **in the initial HTML**. Target: the table is present at first paint, with zero
client round trips on the cold path.

## Explicitly out of scope

- **No client cache.** Deliberate: a cache improves the *second* visit and would mask
  the cold-path number being measured. It is additive later and none of this design
  blocks it.
- Media thumbnails (tracked separately — see Follow-ups).
- Converting page bodies to Server Components. They stay client components.

## Architecture

### 1. Auth moves to an httpOnly cookie

Login stops being a client-side fetch that stores a token in `localStorage`.

```
POST /api/auth/login          (Next Route Handler, new)
  → POST {API}/api/cms/auth/login  { email, password }
  → receives { access_token, user }
  → Set-Cookie: markai_session=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/
  → returns { user }   (for immediate client render)

POST /api/auth/logout         (new) → clears the cookie
```

The backend is **unchanged** — `LoginResponse` already returns exactly what the
handler needs.

Security note: the token becomes unreadable by JavaScript, so XSS can no longer
exfiltrate a session. This is a side benefit, not the motivation.

### 2. `middleware.ts` guards routes before any JS

```
matcher: everything except /login, /_next/*, static assets
no markai_session cookie → 307 redirect to /login
```

The `Checking session…` gate is deleted from `DashboardLayout`, which now renders
`children` unconditionally. Route protection is enforced earlier and more reliably
than a client-side effect could.

### 3. Root layout becomes a Server Component

It reads the cookie, resolves the user server-side, and passes it into the (still
client) `AuthProvider` as `initialUser`. `AuthProvider` drops its bootstrap
`useEffect` and its `loading` state — `user` is populated on first render.

### 4. BFF proxy for all client-side calls

Because the cookie is httpOnly, browser JS cannot attach `Authorization: Bearer`.
One catch-all handler forwards instead:

```
app/api/cms/[...path]/route.ts
  browser → (cookie) → Next handler → (Bearer) → FastAPI
```

Handles GET/POST/PATCH/DELETE. `src/lib/api.ts` changes its base URL to same-origin
and stops injecting the token; it already prepends `/api`, so call sites are
untouched.

**Three responses must stream, not buffer:**

| Path | Why |
|---|---|
| `/cms/ai/sessions/*/stream` | SSE — buffering breaks live chat |
| `/cms/reports/proof-of-play.xlsx` | up to 50k rows; buffering risks the handler's memory |
| screenshot / APK blob downloads | large binaries |

Direct-to-GCS uploads (`PUT` to a signed session URI) bypass the proxy entirely and
are unaffected.

`NEXT_PUBLIC_API_BASE_URL` becomes server-only `API_BASE_URL` — the API origin no
longer needs to be public.

### 5. Server-prefetch the first page

Each route gains a thin Server Component shell that fetches its first page and
passes it down as a prop. No cache library is involved.

```tsx
// app/(dashboard)/bookings/page.tsx  — Server Component
const initialData = await serverApi.bookings({ limit: 20, offset: 0 });
return <BookingsClient initialData={initialData} />;
```

```tsx
// app/(dashboard)/bookings/BookingsClient.tsx  — the page as it exists today
useServerPage(fetcher, { initialData })   // skips the mount fetch
```

`useServerPage` gains one option: when `initialData` is supplied, seed
`items`/`total`/`extra` from it and do **not** fire the first request. Every later
fetch — search, page change, filter change, `reload()` — behaves exactly as now.

A prefetch failure must not blank the page: the shell catches, passes
`initialData: undefined`, and the client falls back to fetching on mount (today's
behaviour).

### Resulting cold path

```
BEFORE   JS → hydrate → /me → mount → /bookings → paint     (2 serial client RTTs)
AFTER    HTML already contains the rows → paint             (0 client RTTs)
```

## Files

**New**
- `src/middleware.ts`
- `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`
- `src/app/api/cms/[...path]/route.ts`
- `src/lib/server-api.ts` — cookie-reading server-side fetch helper

**Changed**
- `src/app/layout.tsx` → Server Component, resolves user
- `src/app/(dashboard)/layout.tsx` → drop the loading gate
- `src/context/AuthContext.tsx` → `initialUser`, no bootstrap effect, no `loading`
- `src/lib/auth-store.ts` → token functions removed
- `src/lib/api.ts` → same-origin base, no Bearer injection, 401 → `/api/auth/logout`
- `src/lib/use-server-page.ts` → `initialData` option
- 13 dashboard pages → split into `page.tsx` (server shell) + `*Client.tsx`

**Backend:** no changes.

## Rollout

Incremental, each step independently shippable:

1. Cookie auth + middleware + BFF proxy. Delete the gate. **Measure** — this alone
   removes one serial round trip.
2. Server-prefetch `/bookings` only. **Measure** against step 1.
3. Roll the shell pattern across the remaining 12 pages.

## Risks

| Risk | Mitigation |
|---|---|
| Extra hop (CMS→API) per call | Same region; set CMS `min-instances=1` so cold starts don't land on it |
| Streaming paths regress silently | Explicit manual check of SSE chat, XLSX export and a blob download |
| Prefetch failure blanks a page | Shell catches; client falls back to fetch-on-mount |
| Logout must clear a server cookie | 401 in `api.ts` calls `/api/auth/logout`, then redirects |

## Verification

Per page, on a **production build** (`next start`), not `next dev`:

- Chrome DevTools trace: LCP, and the TTFB / render-delay split
- Network panel: confirm zero client XHR before first paint on the cold path
- Confirm role scoping still holds (superadmin vs screenowner)
- Confirm SSE chat, XLSX export and blob downloads still work through the proxy

Baseline to beat: **LCP 3,797 ms / render delay 3,699 ms** on `/bookings` in dev;
a production baseline must be captured before step 1 for a fair comparison.

## Follow-ups (not this spec)

- Client cache — restores instant back-navigation. Additive.
- Media thumbnails: the campaigns table renders full-size originals into 56×36 px
  boxes (`CampaignPreview`, `bookings/page.tsx`). Not the LCP element, but real
  bandwidth. Needs a `thumbnail_url` derivative generated on upload.
- `GET /api/ext/screens` is still unbounded (partner API).
