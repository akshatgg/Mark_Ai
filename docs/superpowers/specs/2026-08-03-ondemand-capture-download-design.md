# On-demand capture download — design

**Date:** 2026-08-03
**Scope:** the "On-demand captures" section of a booking's detail page in the CMS
(`markai-Web-cms`) plus two supporting endpoints in `markai-signage-api`.
**Not in scope:** the 3 milestone frames, `loop` frames, the capture mechanism itself.

## Problem

An operator can already ask for a frame ("Capture now") and see the thumbnails, but
there is no way to get the images off the page. Right-click → Save As gives a bucket
hash for a filename, which is useless when you are assembling proof for an advertiser.
Once a campaign has run for a while the tile grid is also unbrowsable — every capture
ever requested is rendered at once with no filter.

## What we are building

1. A filename every downloaded frame carries, derived from the campaign it belongs to.
2. A filter (date + time range) and pagination over the capture tiles.
3. Selection, with "Select all" spanning the whole filtered set.
4. Two ways to take the selection down: an OS folder picker, or a zip.

---

## 1. Filenames

```
cp-screen-1_summer-sale_2026-08-03_14-32-05-IST.jpg
└─ screen ──┘└─ campaign ┘└── captured_at, IST ──┘
```

**Campaign name, not media name.** The booking-detail payload carries `media_url` and
`media_type` but no media name, so using it would mean a new backend field — and media
names are usually junk upload filenames (`WhatsApp Image 2026-08-01.jpg`). The campaign
name is what the invoice references.

**Slugging.** Lowercased; every run of non-alphanumerics collapses to a single `-`;
leading/trailing `-` trimmed; each part capped at 40 characters so a long campaign name
cannot push the filename past the 255-byte limit. An empty result falls back to the
booking/screen id, so a name of `"???"` still produces a usable file.

**Timestamp.** `captured_at` rendered in `Asia/Kolkata` via `app/core/timezone.py` — the
same IST source `app/screenshots/overlay.py` already stamps into the frame. Format
`%Y-%m-%d_%H-%M-%S` sorts chronologically as text and contains no character that is
illegal on Windows or awkward in a shell. The `-IST` suffix stops it being read as UTC.

**Collisions.** Two frames in the same second would silently overwrite each other inside
a zip. When a name is already taken, the first 4 characters of the capture id are
appended before the extension.

**Canonical ordering (found during review).** Because the suffix depends on which of two
colliding frames is named first, names must not be assigned in whatever order the caller
happened to query. The CMS payload lists captures newest-first and the zip builds them
oldest-first, so the same frame would get different names from different paths — and
since the folder-picker saves each frame under the name the *single-file* endpoint
reports, a disagreement means one frame silently overwrites another in the operator's
chosen folder. `_assign_download_names` therefore assigns over a booking's whole capture
set sorted by `(captured_at, job id)`, and all three paths (payload, single file, zip)
read their names from it.

**Extension** comes from the stored URL's path, defaulting to `.jpg`.

The name is computed **once, on the backend**, in `app/screenshots/naming.py`, and
returned as a new `download_name` field on each on-demand capture. The frontend never
builds a filename — that is what keeps the single-file download and the zip entry from
drifting apart.

## 2. Backend endpoints

Both mount on the existing `cms_router` (`/api/cms/bookings`) and authorize through
`_load_booking_for_actor`, the same helper the capture request uses, so a screenowner
can only reach their own screens' frames.

### `GET /{booking_id}/captures/{capture_id}/file`

Streams one image with `Content-Disposition: attachment; filename="<download_name>"`.
Serves the per-tile download and is the byte source for the folder picker.

- 404 if the job is not an on-demand job on this booking, or has no captured record yet.
- The stored URL is passed through `signed_url_for` before fetching, so GCS-backed frames
  work; Cloudinary URLs pass through unchanged.

### `GET /{booking_id}/captures.zip?ids=<comma-separated>`

Streams a zip whose entries use the same names. Zip filename:
`{campaign-slug}_captures_{YYYY-MM-DD}-IST.zip`.

- Capped at 200 ids per request.
- Ids that are not captured on-demand jobs of this booking are skipped, not fatal.
- 404 when nothing in the selection resolves to a file.
- `ZIP_DEFLATED`, though JPEGs are already compressed — it costs little and makes the
  archive conventional.

### Why proxy rather than link the bucket directly

The stored URLs are cross-origin to the CMS, which breaks this feature twice over:
browsers **ignore the `download` attribute on cross-origin links**, so the filename work
above would be discarded; and JavaScript cannot read cross-origin bytes to write them
into a picked folder without CORS configured on both GCS and Cloudinary. Proxying fixes
both and keeps authorization server-side. It also avoids a client-side zip dependency,
which the CMS guide's "minimal deps on purpose" argues against.

`Content-Disposition` is added to `expose_headers` on the CORS middleware so the browser
can read the zip's filename back.

## 3. Frontend — `components/OnDemandCaptures.tsx`

The filtering and selection predicates (`isDownloadable`, `captureMoment`,
`captureFilterBound`, `filterCaptures`) live in `lib/ondemand.ts` alongside the existing
on-demand display helpers, with tests in `lib/ondemand.test.ts` — matching how this
codebase keeps logic out of components. Every test file in the CMS is a `lib/` file.

**Filter.** From / To `datetime-local` inputs plus Clear, interpreted as IST. Filters on
`captured_at`, falling back to `requested_at` so pending and missed tiles do not vanish
from a range that should contain them.

**Pagination.** 20 per page, `‹ 1–20 of 47 ›`. Any filter change resets to page 1; so
does a capture count that shrinks under the current page. Paging is client-side because
the whole `captures[]` array already arrives in the existing `/screenshots` payload —
server-side paging would mean changing that contract for no benefit at this volume.

**Selection.** A checkbox on each *captured* tile only; pending and missed frames have no
file behind them and are not selectable. **"Select all" selects every captured frame in
the filtered set across all pages**, not just the 20 on screen. Selection is kept as a
`Set` of capture ids and pruned against the filtered set, so narrowing the filter cannot
leave an invisible frame selected.

**Two download actions**, shown when at least one frame is selected:

- **Download to folder…** — `showDirectoryPicker()`, then fetch each frame through the
  file endpoint and write it into the chosen directory, showing "7 / 12" as it goes.
  Rendered only when `window.showDirectoryPicker` exists, so Firefox and Safari users see
  one working button rather than one broken one.
- **Download ZIP** — one request to the zip endpoint. Every browser.

Plus a download icon on each captured tile for a single frame.

Both paths fetch with the CMS bearer token and save from a blob, since the endpoints are
authenticated and a plain navigation would not carry the token.

## Error handling

- Folder picker dismissed → silent no-op. Cancelling is not an error.
- A frame failing mid-folder-write → keep going; report `"10 of 12 saved"` as a warning
  toast naming the failure count rather than aborting the batch.
- Zip request failing → error toast, selection preserved so the operator can retry.
- Backend unreachable → the existing `ApiError` message, same as every other call.

## Testing

Per the project's convention the backend is verified by import/syntax checks and
`ruff`, not pytest. The frontend is verified with `tsc --noEmit` and `npm run build`.

Manual checks that matter:
1. A campaign with 25+ captures pages correctly and "Select all" reports the full
   filtered count, not 20.
2. A filter that excludes everything shows an empty state, not a broken grid.
3. A downloaded file opens and is named as specified.
4. A screenowner cannot fetch another owner's capture (403).

## Deliberately not doing

- No media name in the filename (campaign name instead).
- No server-side pagination or filtering.
- No client-side zip library.
- No change to how captures are requested or taken.
