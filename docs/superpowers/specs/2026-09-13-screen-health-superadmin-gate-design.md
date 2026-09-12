# Screen health: superadmin-only, with a per-screen grant

**Date:** 2026-09-13 · **Repos:** `markai-signage-api`, `markai-Web-cms` · **Status:** approved

## Goal
Screen health (cabinet status, temperature, voltage, fault history, VNNOX
binding) is visible to superadmins only. A superadmin can grant the owner of a
specific screen access to that screen's health.

## Decisions (made with the user)
- The switch is a **permission**, not a feature flag: it controls whether the
  screen's owner can see health. Superadmins always see everything.
- A screenowner with **no** granted screen does not see the "Screen health"
  nav item at all; with one or more, it appears and lists only those.
- **Screenshots always carry the black dark-cabinet patches**, granted or not.
  The frame is proof of what the ad looked like and must not change with the
  viewer. It reveals that cabinets were dark, not which or since when.

## Data
`screens.health_visible_to_owner` BOOLEAN NOT NULL DEFAULT false — migration
`0070`, revising `0069_screen_resolution_override`. On the screen, not on
`screen_assignments`: the grant is per screen, so every owner assigned to it
gets it.

## Backend
One predicate, `can_view_health(db, user, screen_id)` in `app/cms_users/deps.py`:
superadmin → yes; screenowner → assigned AND flag set; otherwise no.
`assert_can_view_health` raises 403 with a readable reason.

Every route that exposes health data is gated:

| Route | Gate |
|---|---|
| `health/router._visible_screens` (fleet list) | owners: assigned AND granted |
| `health/router._load_screen` (detail, panels, history, grid, player-kind) | `assert_can_view_health` |
| `health/router.brightness_history` (bypasses `_load_screen`) | `assert_can_view_health` |
| `cms/dashboard_router` `panel_trouble` | restricted to granted screens, so a screen is not admitted to needs-attention on panel trouble alone |

New `PUT /api/cms/screens/{id}/health-access` `{visible: bool}`,
`require_superadmin`. Deliberately NOT a field on the shared PATCH: the AI
co-pilot's `update_screen` tool calls the same service, and a separate route
means no future caller can grant access by accident.

`ScreenSummary.health_visible_to_owner`; `CmsUserPublic.has_health_access`
(superadmin → true; owner → has at least one granted screen). `to_public`'s
users-list caller is unchanged.

## CMS
- Sidebar: `visible: (u) => Boolean(u?.has_health_access)`.
- Screen page: superadmin-only toggle, gated with `isSuperadmin(user)` exactly
  as `DangerZone` already is.
- Health pages already render the backend's error string, so a direct URL visit
  by an ungranted owner reads the 403 reason.

## Unchanged
Screenshot patches; the player-kind badge on the screens list (it names the
player type, not faults); the AI co-pilot (no health imports).

## Accepted side effect
Player type and VNNOX serial are set on the health page, so an ungranted owner
can no longer set them. The superadmin holds the VNNOX serials anyway.

## Verification
Backend: import + `ruff` (no pytest per the standing rule); migration chain has
one head. CMS: `tsc --noEmit` + `vitest`. No `next build`.
