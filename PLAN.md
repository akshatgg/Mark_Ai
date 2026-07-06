# Mark AI — Fleet-Scale Plan: POP Batching, Heartbeat & Data Retention

**Status:** ✅ IMPLEMENTED & verified (APK compiles; backend 28 tests pass; migrations render).
**Scope:** `markai-player-apk` (APK) + `markai-signage-api` (backend). No CMS changes.
**Hard rule:** the player↔backend wire **contract stays frozen** (register, heartbeat,
schedule, proof, WS shapes never change).

---

## 1. The problem we're solving

At **2,000–3,000 screens** the current design overloads the backend and grows data forever:

- **POP** is uploaded after *every* play → **~300 req/s** at fleet scale (10s slot).
- **Heartbeat** fires every 60s → **~50 req/s**, AND every beat is stored as a row that is
  **never deleted** → **~4.3M rows/day, forever**.

Goal: cut request volume **~6–30×** and stop two data stores (the APK's on-disk POP log and
the backend `heartbeats` table) from growing without bound — **without losing any data**.

---

## 2. What we discussed & concluded

### Ideas we rejected (keep as-is)
- **Keep the media cache** — it powers offline playback and saves bandwidth. Removing it =
  black screens during outages + huge CDN bills, and does nothing for POP load.
- **Keep POP on REST, not WebSocket** — WS doesn't reduce the real cost (DB writes are the
  same) and isn't durable (a dropped socket loses the record).
- **Keep the heartbeat** — it *is* the offline detector. "Offline" = the silence when
  heartbeats stop; a dead screen can't tell you anything, so absence is the only signal.

### Decisions
1. **POP → batch over REST.** Keep writing every play to disk instantly; upload on a
   **timer (flush)**, not per-play. Disk is the buffer, so zero data-loss.
2. **Heartbeat → reduce frequency** (you can't "batch" a state ping). Raise the interval and
   raise the offline threshold to ~3× it. Event-driven beats (display on/off) stay instant.
3. **Heartbeat data → keep for ML, don't just delete.** Roll raw beats into **per-screen,
   per-day** aggregates kept **forever**; delete raw after a short buffer window.
4. **POP data → user report.** On campaign completion: summarize (exists today) **+ export
   an Excel report → Cloudinary → save the link** → then delete the raw plays.
5. **Mental model:** **Excel = people** (POP campaign reports) · **Parquet/CSV + aggregate
   tables = models** (heartbeat telemetry for ML).
6. **Keep summarized ad/campaign history for ML demand analysis** (the *summary* level —
   distinct from raw POP, which we still drop). `bookings` + `proof_summaries` already hold
   it; guarantee we **never hard-delete** completed bookings/summaries so the demand signal
   accumulates. See §8.

---

## 3. Implementation plan (in build order)

### Phase 1 — POP batching (APK) ⟵ do first: biggest win, fully isolated, no schema/contract change
**Files:** `util/Constants.kt`, `playback/ProofOfPlayLogger.kt`
1. Add constants (see §4): flush interval, jitter, on-disk cap, batch size, per-run cap.
2. `scheduleUpload()` — add an **initial delay** (`interval + random jitter`) and switch the
   work policy `APPEND_OR_REPLACE → KEEP` (so plays during the window don't reschedule it →
   one upload per interval = the debounce).
3. `ProofUploadWorker.doWork()` — **loop to drain the whole disk log** in batches of
   `POP_UPLOAD_BATCH_SIZE`, up to `POP_MAX_BATCHES_PER_RUN`, then ask to re-run if more remain.
4. On append — enforce `POP_LOG_MAX_RECORDS`: if the log overflows (long outage), **drop the
   oldest records FIFO and log a warning** (never silent — it's billing data).
5. **Verify:** build, watch logs for `Proof upload accepted=… of N` carrying *multiple*
   records, and confirm ~one upload per interval instead of one per play.

### Phase 2 — Heartbeat cadence (APK + backend threshold) ⟵ small, low-risk
**Files:** `util/Constants.kt` (APK), `app/core/config.py` (backend)
1. APK: `HEARTBEAT_INTERVAL_MS` 60s → 180s (3 min).
2. Backend: `ONLINE_THRESHOLD_SECONDS` 180 → 600 (keep it ~3× the interval).
3. No other code — event-driven beats are already instant; `compute_status()` already reads
   the threshold.
4. **Verify:** screen stays online on 3-min beats; offline shows ~10 min after a kill; the
   power-button display-off still flips to `display_off` instantly.

### Phase 3 — Heartbeat telemetry rollup for ML (backend) ⟵ stops the heartbeats table growing
**Files:** `app/core/config.py`, new `app/playback/telemetry_*.py`, new model + Alembic migration
1. Add config vars (see §4).
2. New table **`screen_telemetry_daily`** (see §5) — one row per screen per bucket.
3. Rollup job: for each screen+bucket with raw beats, **upsert** the aggregate row, then
   **prune raw** older than `HEARTBEAT_RAW_RETENTION_DAYS`; optionally archive raw first.
4. Wire to the **existing cron pattern** (`X-Cron-Secret` endpoint + startup sweep) — same as
   screenshot cleanup. No new mechanism.
5. **Verify:** run the job, confirm daily aggregate rows appear and raw beats older than the
   window are gone; aggregates are never deleted.

### Phase 4 — POP user report on completion (backend) ⟵ extends the existing rollup
**Files:** `app/core/config.py`, `app/bookings/service.py`, Alembic migration
1. Add config vars (see §4) and column `proof_summaries.report_url`.
2. Extend `rollup_booking()`: **before** deleting raw plays, gather them, build the
   Excel/CSV report, upload to Cloudinary (reuse the screenshot Cloudinary code), set
   `report_url`, then delete raw (as today).
3. Enrich the summary with the essential fields (ad name, screen + location, scheduled
   window, slot duration, total plays, total airtime, per-day, delivery vs target).
4. (Later, optional) CMS shows a "Download report" link.
5. **Verify:** complete a booking → summary has the numbers + a working `report_url`, raw
   rows deleted, Excel opens and is correct.

---

## 4. Variables (the knobs)

### Backend — `app/core/config.py`
| Variable | What it controls | Default |
|---|---|---|
| `ONLINE_THRESHOLD_SECONDS` | How long of silence before a screen is "offline" (keep ~3× the beat interval). | 600 |
| `POP_EXPORT_ON_ROLLUP` | On/off: build the user report when a campaign ends, before deleting raw. | true |
| `POP_REPORT_FORMAT` | The user report's file type — `"xlsx"` \| `"csv"`. | "xlsx" |
| `POP_REPORT_STORAGE` | Where the report file is uploaded (link saved on the summary). | "cloudinary" |
| `HEARTBEAT_ROLLUP_ENABLED` | Master on/off for the heartbeat→aggregate rollup. | true |
| `HEARTBEAT_ROLLUP_GRANULARITY` | Aggregate bucket size — one row per screen per `"day"` \| `"hour"`. | "daily" |
| `HEARTBEAT_AGGREGATE_RETENTION_DAYS` | How long to keep aggregate (ML) rows. `0` = forever. | 0 |
| `HEARTBEAT_RAW_RETENTION_DAYS` | How long to keep raw beats before deleting (safety buffer). | 7 |
| `HEARTBEAT_ARCHIVE_RAW` | On/off: also save raw beats to cold storage before deleting. | false |
| `HEARTBEAT_ARCHIVE_FORMAT` | If archiving raw — `"csv"` \| `"parquet"` (never Excel; it's for the model). | "parquet" |

### APK — `util/Constants.kt`
| Variable | What it controls | Default |
|---|---|---|
| `POP_FLUSH_INTERVAL_SECONDS` | How often the screen uploads its saved plays. | 60 |
| `POP_FLUSH_JITTER_SECONDS` | Random extra wait so the fleet doesn't POST on the same tick. | 15 |
| `POP_LOG_MAX_RECORDS` | Max plays kept on disk; oldest dropped if it overflows. | 200,000 |
| `POP_UPLOAD_BATCH_SIZE` | How many plays per upload request. | 200 |
| `POP_MAX_BATCHES_PER_RUN` | How many batches one upload run sends (vs Android's time limit). | 100 |
| `HEARTBEAT_INTERVAL_MS` | How often the regular "I'm alive + health" beat is sent. | 180000 |

---

## 5. Schema additions
- **New table `screen_telemetry_daily`** (the ML aggregate; kept forever):
  `screen_id`, `bucket_date` (or `bucket_hour`), `avg_cpu`, `max_cpu`, `min_storage_free_mb`,
  `max_uptime_seconds`, `online_ratio`, `display_on_ratio`, `foreground_ratio`, `beat_count`,
  `created_at`. Unique on `(screen_id, bucket)`.
- **New column `proof_summaries.report_url`** — Cloudinary link to the user's Excel report.

---

## 6. Contract safety
- ✅ **Safe (constants / backend-internal):** all intervals, thresholds, retention, the APK
  disk cap, the rollup/export/prune jobs. None change the wire shapes.
- ⚠️ **Would break the frozen contract (NOT in this plan):** a new WS "health" message, or
  merging POP + heartbeat into one endpoint.

---

## 7. Resolved — POP is user-report only (NOT kept for ML)
**Decision:** POP stays user-facing — raw plays deleted after the campaign (as today), with
the `proof_summaries` row + Excel report preserved. **No POP ML archive.**
**Why:** POP is the *deterministic output of our own schedule* (the owner-fixed loop decides
how often each ad plays), so there's little for a model to learn from it — and the summary
already preserves the meaningful conclusion (plays, airtime, per-day, delivery) forever. ML
value lives in the **heartbeat telemetry** (real sensor data: cpu/storage/uptime/online), not POP.

---

## 8. Ad-demand history for ML (the summary level — already retained)
What ML needs to learn "which ads are in demand" and to do booking-count math is the
**summary**, not raw POP — and that data already persists today:
- **`bookings`** — every campaign ever booked (media, screen, advertiser, window, status,
  created_at) → booking count per ad / screen / advertiser, and booking frequency over time.
- **`proof_summaries`** — per-campaign delivery (plays, airtime, per-day), kept forever.

Together these give demand ranking + booking counts via plain queries — **no new table
needed**. **The one rule:** never hard-delete completed bookings or their summaries
(mark cancelled/archived instead) so the history accumulates.

*Optional later (only if needed):* a pre-computed `ad_demand` rollup per media
(total bookings, total airtime, distinct advertisers, last booked) if on-the-fly queries
ever get slow. Would be a small "Phase 5"; not required now.

**Sibling for screens:** the same "summarize → keep forever for ML → drop raw" pattern
applies **per screen** via the heartbeat rollup → `screen_telemetry_daily` (Phase 3 / §3).
Ads are keyed by media/booking; screens by `screen_id`. One permanent summary row per screen
per day.

## 9. Expected result at 3,000 screens
| | Today | After |
|---|---|---|
| POP requests | ~300/s | ~50/s (60s) or ~10/s (5min) |
| Heartbeat requests | ~50/s | ~10/s (5min) |
| `heartbeats` table | grows forever | bounded (raw ~7 days) + small permanent daily aggregates |
| POP raw rows | deleted on rollup | unchanged + a downloadable Excel report per campaign |
