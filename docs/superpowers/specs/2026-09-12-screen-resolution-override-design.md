# Screen resolution override, and scheduling against it

**Date:** 2026-09-12
**Repos touched:** `markai-signage-api`, `markai-Web-cms`
**Status:** design approved, ready to plan

## Why

The player reports its resolution at registration, and sometimes that number is
wrong. A live example: an `rk356x_box` (Rockchip, Android 11) registers with
`resolution: 960×2048` and `density: 1.0` — that is the box's framebuffer size,
not the panel behind it. Every downstream decision built on that number is then
wrong in a way nobody sees until the ad is on the glass:

- the placement canvas on `/bookings/new` draws the wrong shape,
- `app/content/service.py` renders the placed ad at the wrong pixel size,
- Creative Fit refits the creative to a resolution that does not exist.

There is no way to correct it. `screens.resolution` is written only from
`device_info` (`app/screens/service.py:432` and `:449`) and shown read-only in the
CMS (`src/app/(dashboard)/screens/[id]/page.tsx:360`).

**Goal:** let an operator type the real resolution on the screen detail page, and
have every scheduling and rendering decision for that screen use it.

## Constraints

- Arbitrary sizes must work end to end — `960×2048`, LED cabinet sizes, anything.
  No 16:9 assumption is introduced anywhere.
- A manual value must survive re-registration. The APK re-registers often; a
  value the device can erase is worse than no field at all.
- A bad creative/panel fit warns, never blocks. The placement canvas exists
  precisely so a portrait ad can sit in a portrait box on a landscape panel;
  a hard block would break a feature that already works.

## Design

### 1. Data model — `resolution` becomes the effective value

Migration `0069` adds two columns to `screens`:

| Column | Type | Meaning |
|---|---|---|
| `detected_resolution` | `String(64)`, nullable | What the device reported. Always kept fresh. |
| `resolution_is_manual` | `Boolean`, not null, default `false` | An operator has set `resolution` by hand. |

`screens.resolution` keeps its name and **becomes the effective value** — the
operator's if one is set, otherwise the detected one.

This inversion is the load-bearing decision. Every reader in both repos already
reads `screen.resolution`; making that attribute mean "the truth" gives all of
them the corrected value with **zero changes**:

- `app/content/service.py:301` (render a placed ad at panel W×H)
- `app/content/fit.py` (`pixel_fit_note`)
- `app/creative_fit/service.py:497` and `:531` (refit target, screen picker)
- `app/ai/tools.py:546` (co-pilot fit check)
- `app/bookings/pdf_report.py:1328`
- `app/api_keys/ext_router.py:236` and `:1186` (partner API)
- `app/screens/service.py:657` (`ScreenSummary`)
- CMS: `bookings/new/page.tsx:216`, `screens/page.tsx:375`,
  `creative-fit/TargetPicker.tsx`

The alternative — a separate `resolution_override` column that every consumer
must remember to prefer — was rejected: one missed call site silently reverts to
the wrong number, which is the exact failure this feature exists to remove.

Backfill: `detected_resolution = resolution`, `resolution_is_manual = false`.

### 2. Registration stops clobbering

`register_screen` (`app/screens/service.py`) currently assigns
`screen.resolution = device_info.get("resolution")` on both the create and
re-register branches. It becomes:

- `screen.detected_resolution = device_info.get("resolution")` — always.
- `screen.resolution = detected` — only when `resolution_is_manual` is false.

This mirrors the manual-location rule immediately above it, where
`_apply_location(screen, device_info, overwrite_manual=rescan_pending)` already
protects an operator's fix from the device. Unlike location there is no
"re-scan" gesture for resolution; clearing the override in the CMS is the way
back to the detected value.

### 3. API

`ScreenUpdateRequest` (`app/screens/schemas.py:200`) gains:

```python
resolution: Optional[str] = Field(default=None, max_length=64)
```

with a `field_validator` that:

- returns `""` unchanged — an empty string clears the override and restores the
  detected value, matching the convention `tailscale_ip` already uses,
- parses `W x H` using the separators `app/content/fit.py:parse_resolution`
  already accepts (`x`, `X`, `*`, `×`),
- rejects non-positive values and anything over `8192` on either axis — the cap
  `app/creative_fit/resizer.py:262` and `app/content/place_render.py:31` already
  enforce downstream, so accepting more only defers the error,
- normalizes to `"{w}x{h}"` so one screen cannot hold `1080 × 1920` while
  another holds `1080x1920`.

`update_screen` (`app/screens/service.py:892`) sets `resolution_is_manual = true`
on a non-empty value, and on an empty string sets `resolution_is_manual = false`
and `resolution = detected_resolution`.

`ScreenSummary` gains `detected_resolution: Optional[str]` and
`resolution_is_manual: bool = False`. `resolution` keeps its meaning to every
existing client, including the partner `/api/ext/*` surface — which now simply
starts returning the corrected number.

Permissions are unchanged: the field rides the existing `PATCH` path, so
superadmin edits any screen and a screenowner edits the screens assigned to
them, per the standing role rule.

### 4. CMS editor — a Display section in screen settings

`src/components/screens/ScreenSettings.tsx` gains a fourth section beside
Identity / Operating hours / Slots, following the same edit-one-section-at-a-time
pattern (a section shows its value plainly until you click Edit):

```
Screen settings
──────────────────────────────
▸ Identity & location   [Edit]
▸ Operating hours       [Edit]
▾ Display
    Width      Height
   ┌───────┐ ┌───────┐
   │ 1080  │×│ 2304  │
   └───────┘ └───────┘
   Portrait · 15:32

   Presets:
   [1920×1080] [1080×1920]
   [3840×2160] [2160×3840]

   Device reported: 960×2048
   ↩ Revert to detected

   [Save]  [Cancel]
```

- Two number inputs, not one text field: W×H cannot be mistyped into a shape the
  parser silently rejects, and it makes the orientation legible as you type.
- The live `Portrait · 15:32` label is computed from the typed values, aspect
  reduced by GCD. It is the fastest way to notice a transposed pair.
- Presets are one-click fills, not a closed list — arbitrary sizes stay typeable.
- `Device reported: …` and `↩ Revert to detected` appear only when
  `detected_resolution` exists and differs from the effective value. Revert
  sends `resolution: ""`.
- Saving posts `resolution: "{w}x{h}"` through the existing `api.updateScreen`.

The Overview card row (`screens/[id]/page.tsx:360`) keeps showing the effective
value and gains a muted `set manually` tag when `resolution_is_manual` is true,
so the number on the page and the number in the Device info card can be seen to
disagree on purpose.

### 5. Scheduling — what changes on `/bookings/new`

**Placement canvas — no code change.** It reads
`parseResolution(selectedScreen?.resolution)` (`bookings/new/page.tsx:216`) and
so picks up the correction for free; the backend then renders the placed ad at
exactly that W×H. Covered by a test, not by an edit.

**Fit warning — new.** The manual booking form never compares the creative's own
pixels to the panel. The rule exists (`app/content/fit.py:pixel_fit_note`) but
only `app/ai/tools.py:546` calls it. Port it to `src/lib/fit.ts` as a TypeScript
twin — precedent: `clampBox` in `src/lib/placement.ts` already mirrors Python's
`clamp`, NaN rejection included. The CMS already measures every upload's real
pixels client-side (`src/lib/api.ts:692`), so `Media.width`/`height` are
populated for anything uploaded through the CMS.

Behaviour, matching the Python rule exactly:

| Case | Banner |
|---|---|
| Orientation mismatch (portrait ad, landscape panel) | red |
| Aspect drift ≥ 0.02 | amber |
| Either dimension unknown | nothing — absence of data is not evidence of a fit |

The banner **never blocks Book.** It names both shapes in plain words and
carries the fix.

**Refit offer — new trigger, existing machinery.** Today "Rebuild with AI" only
appears when the *box* is stretched too far (`bookings/new/page.tsx:909`); a
wrong-shaped creative in an untouched box offers nothing. The new banner offers:

- image → `api.creativeFit.createJob({ mode: "rebuild" })`, the path already
  wired at `bookings/new/page.tsx:529` including its poll, its screen/row
  snapshot guard and its "your stretch is untouched" failure copy,
- video → the same call with `mode: "resize"` (`JobMode` is
  `Literal["resize", "rebuild"]`), which stretches to the exact panel size;
  `canRebuildWithAi` correctly keeps videos away from `rebuild`.

The job resolves its target resolution server-side from the screen
(`app/creative_fit/service.py:497`), so a refit automatically targets the
corrected number.

## Out of scope

- **Re-checking already-booked campaigns** when a resolution changes. A live
  booking whose creative was rendered for the old size is not flagged.
- **`solution/page.tsx`.** Its `parseScreenSize` falls back to a guessed
  1920×1080, which is a deliberate difference the booking page documents at line
  24. Changing it is a separate decision.
- **The APK.** It reports what it reports; nothing about this feature needs a
  player release.
- **Vendor panel health** (`app/health/vendors/vnnox/adapter.py:261`), which has
  its own resolution field for a different thing.

## Verification

Per the standing rule, no pytest run from this session.

- Backend: `python -c "import app.main"` plus `ruff` (the gate on this repo —
  `main` is not black-clean). Alembic migration applied against the dev
  database and `alembic downgrade` exercised once.
- CMS: `vitest` unit tests for `src/lib/fit.ts` covering portrait-on-landscape
  (red), 2% aspect drift (amber), an exact match (silent), and an unknown
  dimension (silent) — each asserted against the Python original's behaviour.
  `tsc --noEmit` for types. No `next build`, which would clobber `.next` under
  the running dev server.
- Manual: on the `rk356x_box` screen (`ce803e95-95c2-4de1-8a53-0c69abfb46d2`),
  set a corrected resolution, confirm the canvas reshapes on `/bookings/new`,
  then let the box re-register and confirm the override survives and
  `Device reported:` still shows `960×2048`.
