# Multi-tenant content & solution visibility — design

**Date:** 2026-07-14
**Repos:** `markai-signage-api` (backend), `markai-Web-cms` (CMS)

## Problem

CMS resources are not scoped per screenowner:

- `GET /api/cms/content` (`app/cms/content_router.py:list_content`) is guarded only by
  "are you logged in" and returns **every** `media_assets` row — so any screenowner sees
  all creatives in the whole platform. A multi-tenant leak.
- `media_assets` has **no record of who uploaded a creative** (`commit_upload` receives
  `user.id` but doesn't persist it), so "content I uploaded" can't be expressed.
- `app/solutions/*` routes are **superadmin-only** — a screenowner cannot see the solutions
  that run on their own screens at all.

## Goal

Each screenowner sees only what is **theirs** or **runs on their assigned screens**;
superadmin sees everything. Applies to three areas: content, solutions, and (already
handled) AI-chat media.

## Rules (confirmed with the user)

### A. Content (`media_assets`)
- **superadmin** → sees all content.
- **screenowner** → visible iff **`uploaded_by = me`** OR the creative is
  booked / looped / scheduled on one of **my assigned screens**.
- superadmin-uploaded content NOT on my screen → hidden from me.
- Owners can upload (attributed to them). Owners have **full control** (rename/delete) over
  any creative *visible* to them; the existing in-use **409** still protects live creatives.

### B. Solutions (`solutions`)
- **Create is open to everybody** ("the Solution option is public"): superadmin and
  screenowner can both create solutions. An owner creates on a screen they manage
  (`assert_can_manage_screen`); superadmin on any screen. `created_by` records the author.
- **Visibility:**
  - **superadmin** → sees all solutions from everyone.
  - **screenowner** → visible iff **`created_by = me`** OR **`screen_id` ∈ my assigned
    screens**. Otherwise hidden.
- A solution's content is embedded in its `layout` JSON, so it renders "combined"
  automatically — no extra join.
- Owner may delete a solution *visible* to them; superadmin any.

### C. AI-chat media (`ai_chat_media`) — already satisfied
- Already **private per user**: every chat file is tied to a turn → session →
  `cms_user_id`, and the table **already has an `uploaded_by` column**. It is never listed
  in any shared view. No change needed for privacy or attribution.
- The one tie-in: when the co-pilot **promotes a chat upload into the library**
  (`app/ai/executors.py:_resolve_bookable_media_id` → `content_service.create_media`), the
  resulting `media_assets` row must carry `uploaded_by = chat_media.uploaded_by` so a
  promoted creative is attributed like any other upload (Part A's rule then applies to it).

### D. AI co-pilot must follow the SAME scoping as the manual path
- The agent's **write** executors already reuse manual authorization (bookings are
  superadmin-only + `booked_by`; screen edits go through `assert_can_manage_screen`), and
  `list_bookings` / `search_screens` are already user-scoped — so AI-created schedules and
  screen edits already cannot exceed the user's authority.
- **Gap:** the agent's `list_media` tool runs `select(MediaAsset)` **unscoped**, so a
  screenowner using the co-pilot would see every creative. It must apply the same
  `screenowner_media_scope` as the REST content list (extract `list_media_impl`, mirroring
  the existing `search_screens_impl`). No AI solution tool exists, so solutions need no AI
  change.

## Backend design

### Schema / migration `0030_media_uploaded_by`
- Only **one** schema change in the whole feature: add `media_assets.uploaded_by
  VARCHAR(36) NULL`, FK → `cms_users.id` `ON DELETE SET NULL`, indexed. Existing rows stay
  `NULL`. `solutions` needs **no** migration (`created_by` + `screen_id` already exist).

### Content
- `commit_upload` and `create_media` (via `POST /cms/content` and the AI promotion path)
  stamp `uploaded_by`.
- A reusable `screenowner_media_scope(db, user)` returns a SQLAlchemy condition
  (`uploaded_by = me` OR `id` in bookings/loops/schedules on my assigned screens), `None`
  for superadmin. Applied to the list (incl. `total`) and to rename/delete visibility
  (`assert_media_visible` → 404 when not visible; the in-use 409 guard is unchanged).

### Solutions
- Change `list_solutions` / `get_solution` / `delete_solution` / `create_solution` from
  `require_superadmin` to `require_screenowner_or_super`.
- `create_solution`: for a screenowner, `assert_can_manage_screen(db, actor,
  payload.screen_id)` (superadmin bypasses) so an owner can only attach a solution to a
  screen they own.
- Add `screenowner_solution_scope(db, user)`: `Solution.created_by == me` OR
  `Solution.screen_id in get_assigned_screen_ids(me)`, `None` for superadmin. Applied to the
  list and to `get`/`delete` visibility (404 when not visible).

## CMS design
- `types.ts`: add `uploaded_by?: string | null` to `Media`.
- Content page + dashboard "My Media": no functional change — the now-scoped `/cms/content`
  does the work. Upload button stays for owners.
- **Solutions must be reachable by screenowners** (they were effectively superadmin-only):
  ensure the Solution page (`/solution`) and the "My Solutions" dashboard card are visible
  in the screenowner nav; they read the now-scoped solution endpoints. Verify no client-side
  role guard hides them from owners.

## Testing (backend)
- **Content:** owner sees own upload; owner sees media booked on their screen; owner sees
  media in a loop item on their screen; owner does NOT see an unrelated other-owner upload;
  superadmin sees all; `total` matches the scoped set; create/commit stamps `uploaded_by`;
  AI promotion stamps `uploaded_by`; owner rename/delete of a non-visible creative rejected;
  visible allowed; in-use delete still 409.
- **Solutions:** owner sees a solution they created; owner sees a solution on their screen
  (created by superadmin); owner does NOT see an unrelated solution; superadmin sees all;
  owner can create on their own screen; owner creating on a screen they don't own → 403;
  owner get/delete of a non-visible solution → 404.

## Out of scope
- Changing the AI-chat media table (already private + has `uploaded_by`).
- External-partner (`/api/ext/*`) access.
- The legacy admin-key `POST /content` path (leaves `uploaded_by = NULL`).
