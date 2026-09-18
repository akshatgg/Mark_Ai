# Proof of play — campaign filter and multi-ad selection

**Date:** 2026-08-25
**Scope:** CMS web only. The AI co-pilot and the WhatsApp report path are explicitly out of scope.

## The problem

An advertiser runs one campaign with several creatives that rotate — a different
template each loop pass (the creative-rotation feature shipped in player v1.2.0).
"Sanjivani" books one slot and five ads take turns in it.

The Proof of play page cannot report on that. Its Ad filter takes exactly one
creative, so proving what Sanjivani got means running the report five times and
stitching five spreadsheets together by hand.

## What we are building

Two filters on the Proof of play page:

1. **Campaign** — a single-select type-ahead. Pick a campaign, get every play it
   produced across all of its rotating creatives, in one report.
2. **Ad** — the existing filter, made multi-select. Tick any number of creatives
   from anywhere in the library; the report is their union.

Both feed the same table, the same trend chart, and the same one-sheet Excel export.

## Why the campaign filter is cheap

`query_proof_report` (`app/screens/service.py`) already takes a `booking=`
argument, and `attribution.owns_play_clause` already decides ownership by the
**`booking_id` tag the player writes onto every play** — not by creative. So a
single campaign filter sweeps in all five Sanjivani creatives with exact
attribution, and correctly excludes a second advertiser who happens to share one
of those creatives.

This work wires an existing, already-reasoned-about capability up to the UI. It
does not invent attribution logic.

The legacy branch of `owns_play_clause` (rows from players too old to write a
`booking_id`) stays matched on the primary creative only. That is deliberate in
the existing code — an untagged row can only come from a pre-rotation player —
and is not changed here.

## Filter semantics

| Selection | Rows returned |
|---|---|
| Campaign only | Every play owned by that campaign — all rotated creatives |
| Ads only (N ticked) | Union of those creatives' plays: `media_id IN (…)` |
| Campaign **and** ads | Intersection: that campaign's plays, narrowed to the ticked creatives |
| Neither | Unchanged — everything in the caller's scope |

## Backend changes

### `app/screens/service.py` — `query_proof_report`

Add `media_ids: list[str] | None = None`. Keep the existing `media_id: str | None`
parameter and treat it as a one-element list, so no existing caller changes.

```
if media_ids:
    conds.append(ProofOfPlay.media_id.in_(media_ids))
elif media_id is not None:
    conds.append(ProofOfPlay.media_id == media_id)
```

The `booking=` path is untouched — it already exists and already works. When both
`booking` and `media_ids` are given, both predicates apply, which is the
intersection the table above specifies.

Ordering stays `played_at DESC, id`. Nothing about multi-ad selection changes it,
and the `id` tiebreaker remains load-bearing for the export walk.

### `app/cms/reports_router.py`

All three endpoints (`/proof-of-play`, `/proof-of-play.xlsx`, `/plays-aggregate`)
gain:

- `media_ids: list[str] | None = Query(default=None)` — repeatable query param.
- `booking_id: str | None = Query(default=None)`.

and keep `media_id` for backward compatibility. Existing bookmarks, and the
co-pilot path that still sends a single `media_id`, keep working unchanged.

A new helper, shared by all three endpoints so they cannot drift:

```
async def _resolve_filters(db, actor, screen_id, booking_id, media_ids, media_id)
    -> (screen_ids, booking, media_ids)
```

It performs, in order:

1. `screen_ids = await _resolve_screen_scope(db, actor, screen_id)` — unchanged rule.
2. If `booking_id` is set: load the `Booking` with its `creatives` relationship
   eagerly loaded (`selectinload`), 404 if absent.
3. Intersect, never replace: if `screen_ids is not None` and the booking's
   `screen_id` is not in it, raise 403. Otherwise `screen_ids = [booking.screen_id]`.
   This mirrors the rule `app/reports/service.py` already calls out — replacing
   the scope is how a revoked assignment stops mattering.
4. Normalise `media_ids`: fall back to `[media_id]` when only the singular is
   given; de-duplicate; reject more than `MAX_FILTER_ADS` with 422.

`MAX_FILTER_ADS = 25`, defined in `app/cms/proof_export.py` next to the other
export limits. The cap keeps the query string and the `IN (…)` list bounded; 25 is
comfortably above any real rotation set.

The eager load in step 2 matters: `attribution.creative_media_ids` reads
`booking.__dict__["creatives"]` and never triggers a lazy load, so an unloaded
relationship silently degrades to the primary creative.

### `app/cms/proof_export.py`

`build_proof_workbook` needs no structural change. Only the Summary sheet's
description of the filter widens:

- `filters["media"]` accepts a pre-joined string of the selected ad names, e.g.
  `"Diwali-Template2, Diwali-Template4, Diwali-Template7"`. The `Ad` row label
  becomes `Ads` when more than one is selected.
- A new `filters["campaign"]` renders a `Campaign` row directly under `Screen`,
  omitted entirely when no campaign is picked.

The `booking_names` parameter and its Campaign **column** stay reserved for the
screen-deletion archive. A campaign-filtered export has the same campaign on every
row, so a column would repeat one value thousands of times.

The `.xlsx` endpoint's filename gains a campaign slug when a campaign is picked,
and `<n>-ads` when more than one ad is selected — reusing `screenshots.naming.slugify`,
as the screen segment already does.

## The Excel file

One sheet, exactly as today.

- **"Proof of play"** — every matching row, existing columns, ordered newest
  first. Because ordering is purely chronological, the selected ads **interleave
  naturally**: B at 09:14, C at 09:16, B at 09:31. No per-ad tabs, no split
  sections, no breakdown table.
- **"Summary"** — unchanged apart from the campaign row and the widened ad list
  described above, including the existing cap warning.

## Frontend changes

### New: `src/components/patterns/AsyncMultiSelect.tsx`

A sibling of `AsyncSelect`, consuming the same `AsyncSource` contract
(`search` / `resolveSelected`) so every option source already written works with it.

- `value: string[]`, `onChange: (ids: string[]) => void`.
- Selected items render as removable chips above the trigger; menu rows carry
  checkboxes and toggle rather than close.
- `resolveSelected` runs per unresolved id to label pre-selected values.
- `maxSelected` prop (25 here) disables further ticking and explains why.

`AsyncSelect` itself is **not** converted. Three surfaces depend on its
single-value shape — `bookings/new`, `bookings/[id]`, and `use-server-page` — and
widening it into a props union would put that union in front of all of them for
no benefit.

### `src/lib/async-sources.ts`

Add `bookingSource`, mirroring `solutionSource`:

- `search` → `api.bookings({ q, limit: ASYNC_SELECT_PAGE, offset: 0 })`.
  `/cms/bookings` already supports case-insensitive search on campaign name.
- `resolveSelected` → `api.booking(id)`.
- `bookingOption(b)` → `{ id, label: b.name, sublabel: b.screen_name }`, matching
  `BookingListItem`.

### `src/lib/api.ts`

`ProofReportParams` gains `mediaIds?: string[]` and `bookingId?: string`.
`proofReport`, `proofReportXlsx` and `playsAggregate` append one `media_ids`
entry per id and a single `booking_id`. `mediaId` stays for callers that still
pass one.

### `src/app/(dashboard)/reports/page.tsx`

- State: `mediaId: string` becomes `mediaIds: string[]`; add `bookingId: string`.
- The filter grid goes from `lg:grid-cols-5` to `lg:grid-cols-6` — Screen,
  Campaign, Ad, From, To, Reset.
- The mobile active-filter badge counts the campaign plus each selected ad, so
  ticking three ads reads as three.
- `reset()` clears both new filters.
- The trend chart receives the same filters as the table, so the two cannot
  disagree about what is selected.
- The export button's `title` and disabled rule are unchanged — still gated on
  `total === 0`, not on the current page.

## Error handling

- More than 25 ads → 422 from the backend with a plain-language message; the UI
  prevents reaching that state, so the check is a backstop, not the primary guard.
- A campaign on a screen the operator is not assigned to → 403, same message
  shape the existing screen filter uses.
- A campaign id that does not exist → 404.
- A deleted creative still present in a saved filter resolves to `null` from
  `resolveSelected`; the chip falls back to the short id, matching how the table
  already handles deleted media.

## Testing

- **CMS:** vitest. Cover `AsyncMultiSelect` toggle/remove/cap behaviour, and the
  query-string building in `api.ts` for multi `media_ids` plus `booking_id`.
- **Backend:** no pytest run in this repo — verified by import and syntax checks;
  the user runs the test suite. The behaviours a test should cover when they do:
  `media_ids` union, campaign-plus-ads intersection, the 403 on an unassigned
  campaign's screen, and the 25-ad cap.

## Out of scope

- The AI co-pilot's report tool and `report_jobs.params`, which keep their single
  `media_id`.
- The WhatsApp report delivery path.
- Any per-ad breakdown, per-ad sheet, or grouping in the workbook — explicitly
  declined; the export stays one time-ordered sheet.
