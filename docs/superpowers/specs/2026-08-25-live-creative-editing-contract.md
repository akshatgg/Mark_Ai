# Live creative editing — PINNED API contract (Phase 1)

Implementation contract for `docs/superpowers/plans/2026-08-25-add-creative-to-live-campaign.md`.
Backend implements exactly this; CMS and reports build against it.

## Endpoints (all under `/api/cms`, JWT, `_assert_can_manage_booking`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/bookings/{id}/creatives` | `{"media_ids": ["mB", …], "confirm": false}` | `BookingDetailResponse` |
| PATCH | `/bookings/{id}/creatives/{media_id}` | `{"media_id": "mC", "confirm": false}` | `BookingDetailResponse` |
| DELETE | `/bookings/{id}/creatives/{media_id}` | — | `BookingDetailResponse` |
| PUT | `/bookings/{id}/creatives/order` | `{"media_ids": ["mB","mA"]}` (all active, in new play order) | `BookingDetailResponse` |
| POST | `/bookings/{id}/replace-ad` | `{"media_id": "mC", "confirm": false}` | `ReplaceAdResponse` |

### Confirm / warning protocol
- **Fatal** (orientation mismatch vs the screen) → **422**, never writable.
- **Non-fatal** (aspect drift, video longer/shorter than the slot, play-share
  change) → with `confirm:false` returns **409** whose `detail` is the operator-
  facing warning text. Client re-sends with `confirm:true` to proceed.
- No warnings → writes immediately regardless of `confirm`.

### Other error codes
- 403 partner-placed booking (`booked_via_api_key_id` set) unless superadmin.
- 409 campaign cancelled / completed / rolled up (message names the creative op).
- 422 booking has a `layout` (a zoned ad cannot rotate).
- 422 media missing, duplicate in the active set, or active count > 10.
- 409 dropping the anchor's row while the screen is below player v1.2.

## Response shapes

`BookingCreativeOut` (existing, extended — ALL fields optional-safe):
```jsonc
{
  "media_id": "…", "position": 0,          // position is null for retired rows
  "media_name": "…", "media_type": "image",
  "plays": 412,                            // this creative's plays for this campaign
  "seconds": 4120,                         // plays x slot seconds
  "added_at": "2026-08-01T…Z",
  "retired_at": null,                      // non-null => retired; render greyed
  "first_played_at": "2026-08-01T…Z",
  "last_played_at": "2026-08-14T…Z"
}
```
`booking.creatives` now contains **active AND retired** entries. Active = ordered
by `position`; retired follow, ordered by `retired_at`. It is present whenever the
campaign has ever had a rotation (not only when 2+ are active).

`BookingDetailResponse` gains, for the play-share disclosure (D5):
```jsonc
{ "slot_seconds": 10, "expected_plays_per_day": 480, "supports_rotation": true }
```
`supports_rotation` mirrors the screen's; `null` = the screen has not reported a
player version (render "cannot confirm", never "supported").

`ReplaceAdResponse`:
```jsonc
{ "cancelled_booking_id": "…", "booking": { …BookingResponse… } }
```

`ScreenSummary` gains `"supports_rotation": true|false|null`.

## Semantics the UI must reflect

- Adding an alternate does **not** consume another slot and does **not** lengthen
  the loop. The campaign's total plays are unchanged; each creative gets ≈ total ÷ N.
- The first creative is no longer special in the UI: any active creative may be
  reordered or removed. (The immutable anchor is internal and never shown.)
- Removing the last active creative is refused — a campaign always airs something.
- "Replace ad" is for a single-creative campaign: it cancels and re-books on the
  same screen/slot/dates with the new creative, and the two link to each other.

## Not in Phase 1
Per-creative milestone photographs (needs player v1.3); pricing/payments (this is
the CMS — no price, rate or currency exists anywhere and none is added).
