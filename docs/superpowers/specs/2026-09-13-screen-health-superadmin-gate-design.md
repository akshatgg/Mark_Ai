# Screen health: superadmin-only, with a per-owner switch

**Date:** 2026-09-13 · **Repos:** `markai-signage-api`, `markai-Web-cms` · **Status:** approved, revised the same day

## Goal
Screen health (cabinet status, temperature, voltage, fault history, VNNOX
binding) is visible to superadmins only. A superadmin can switch it on for a
screen owner, who then sees the health of **their own screens** — every screen
assigned to them, and never another owner's.

## Revision (2026-09-13)
The first version (CMS-Back#98, CMS-Web#68) granted access **per screen**, with
a switch on the screen page, so every owner of that screen received it. The user
moved it to **one switch per owner in the Users section** (CMS-Back#99,
CMS-Web#71). Two facts made that safe: production had 0 screens with the
per-screen grant on, and no screen has more than one owner.

The per-screen switch also took the screen page down: importing it made webpack
concatenate `screens/[id]/page.tsx`, and Next 15.5 then leaves the page out of
its client reference manifest, so every load returned a 500 while `next build`
reported success. CMS-Web#70 removed it; CMS-Web#71 adds a build guard.

## Decisions (made with the user)
- The switch is a **permission** on the operator, not a feature flag and not a
  property of a screen. Superadmins always see everything.
- On, it covers every screen assigned to the owner — screens assigned later
  included, screens unassigned dropping out — and never another owner's.
- An owner without the switch, or with it on but no screens, does not see the
  "Screen health" nav item at all.
- **Screenshots always carry the black dark-cabinet patches**, switch or not.
  The frame is proof of what the ad looked like and must not change with the
  viewer.

## Data
`cms_users.can_view_screen_health` BOOLEAN NOT NULL DEFAULT false — migration
`0071`, revising `0070`. `screens.health_visible_to_owner` (from `0070`) is no
longer read and stays in the database until a later migration drops it, so no
running container ever selects a column that is gone (the #94 failure).

## Backend
One predicate, `can_view_health(db, user, screen_id)` in `app/cms_users/deps.py`:
superadmin → yes; screenowner → switch on AND assigned to the screen; otherwise
no. `assert_can_view_health` raises 403 with a readable reason.

| Route | Gate |
|---|---|
| `health/router._visible_screens` (fleet list) | owners: switch on, then their assigned screens |
| `health/router._load_screen` (detail, panels, history, grid, player-kind) | `assert_can_view_health` |
| `health/router.brightness_history` (bypasses `_load_screen`) | `assert_can_view_health` |
| `cms/dashboard_router` `panel_trouble` | owners: only with the switch on, so a screen is not admitted to needs-attention on panel trouble alone |

`PUT /api/cms/users/{id}/screen-health-access` `{enabled: bool}`,
`require_superadmin`; 400 when the target is a superadmin. Its own route rather
than a field on the shared user PATCH. The per-screen
`PUT /api/cms/screens/{id}/health-access` is removed.

`CmsUserPublic.can_view_screen_health`; `CmsUserPublic.has_health_access`
(superadmin → true; owner → switch on AND at least one assigned screen).

## CMS
- Sidebar: `visible: (u) => Boolean(u?.has_health_access)` (unchanged).
- Users → an owner's page (`AccountPanel`): a "Screen health" card with a
  `role="switch"` toggle, shown only for screen owners.
- Screen page: no health switch.
- Build: `scripts/check-client-manifests.mjs` runs after `next build` in the
  Dockerfile and fails the image when a client page is missing from its manifest.

## Unchanged
Screenshot patches; the player-kind badge on the screens list; the AI co-pilot
(no health imports).

## Accepted side effect
Player type and VNNOX serial are set on the health page, so an owner without the
switch cannot set them. The superadmin holds the VNNOX serials anyway.

## Verification
Backend: `ruff`, import check, migration applied to local Postgres, a live smoke
run of every gate against a local API, and `tests/test_screen_health_access.py`
(for the user to run — no pytest in this repo's sessions). CMS: `tsc --noEmit`,
vitest, and Docker builds of the real Dockerfile (never `next build` in the dev
folder): 20/20 client pages in their manifests, key pages 200, and the guard
fails the build on the broken `11ef252`.
