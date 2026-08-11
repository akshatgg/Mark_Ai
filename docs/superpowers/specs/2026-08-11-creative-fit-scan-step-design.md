# Creative Fit — explicit Scan step, locked buttons, and Stop

**Date:** 2026-08-11
**Repos:** `markai-Web-cms` (the UI change), `markai-signage-api` (cancel only)

## The problem

Two things are wrong with the Creative Fit page today.

**1. Nothing is deliberate.** Choosing a creative and a screen fires the analysis
automatically from a `useEffect` (`page.tsx:102`). The operator never asked for it. Every
screen they try spends a Gemini analyst call, and the verdict appears under their cursor
before they have finished setting up.

**2. The buttons lie about being busy.** `submitting` (`page.tsx:70`) is true only for the
duration of the POST. `POST /jobs` returns `202` immediately — the job is queued, not
finished — so for the entire 20–60 s a rebuild actually takes, *both* action buttons are
live again. Clicking five times creates five jobs, five Gemini generations, and five
bills. This is the bug the operator hit.

**3. There is no way out.** A rebuild that was started by mistake, or against the wrong
screen, runs to completion. Nothing can stop it.

## What we're building

A three-stage flow — **scan → fit → result** — where exactly one thing is clickable at a
time, and a running job can be stopped.

### The stage machine

One derived value replaces the scattered `analyzing` / `submitting` / `job` booleans:

| Stage | When | Scan button | Crop / Rebuild | Stop |
|---|---|---|---|---|
| `needs-input` | ad or screen missing | hidden (placeholder card) | hidden | hidden |
| `ready` | both chosen, not scanned | **live** — "Scan this ad" | hidden | hidden |
| `scanning` | analyze in flight | locked, spinner, "Scanning…" | hidden | hidden |
| `scanned` | verdict returned | gone | both live | hidden |
| `queued` | job created, unclaimed | gone | clicked one locked, "Waiting for a worker…"; other greyed | **live** |
| `running` | worker claimed it | gone | clicked one locked, "Rebuilding… 0:24"; other greyed | **live** |
| `done` / `failed` / `cancelled` | settled | gone | both live again | hidden |

Changing the ad or the screen returns to `ready` and discards the verdict — a scan
measures one specific creative against one specific screen, so once either changes the old
reading is simply wrong. The pickers are locked across `scanning`, `queued` and `running`.

The derivation is a pure function, `fitStage()`, in `lib/creative-fit.ts`, so the existing
vitest suite (`creative-fit.test.ts`) covers every transition. One place decides what is
locked; a button cannot disagree with it.

### Why the buttons never vanish mid-job

During `queued` and `running`, the clicked button stays exactly where it is — locked, with
a spinner, the real stage from the job status, and elapsed time. The other greys out. The
row does not reflow, so nothing moves under the cursor while the operator is still
pointing at it.

Elapsed is `now − job.created_at` (`types.ts:1048`), ticking locally once a second,
formatted `m:ss`. Real elapsed time, not a synthetic progress bar — the backend reports
`queued | running` and no percentage, so a bar would be fiction. Deriving it from
`created_at` rather than a click timestamp means it survives reopening the job from
history.

### The Scan card

The Scan button takes over the card that currently holds the "Pick an ad and a screen
size…" placeholder (`page.tsx:256`), so the page does not jump when it appears. Three
faces: the existing hint text when inputs are missing; a primary "Scan this ad" button
with a one-line explanation when both are set; the same button locked with a spinner while
scanning.

When the verdict lands, this card is replaced by the `VerdictCard`. The Scan button
"vanishes" because the card it lived in is gone — not because a flag hides it.

## Stop

### Semantics

`cancelled` becomes a fourth terminal job status. `creative_fit_jobs.status` is a plain
`String(16)` with no CHECK constraint (`0037_creative_fit_jobs.py:58`), so **no migration
is required**.

- **Queued job — dies instantly and completely.** The claim statement only ever selects
  `status = 'queued'` (`worker.py:59`), so a cancelled row is invisible to all three
  workers from the moment it commits. Nothing runs, nothing is billed.
- **Running job — aborts at the next checkpoint.** The worker is parked inside an `await`
  on the Gemini call. We cannot interrupt that call, so `execute_job` re-reads the job's
  status at each stage boundary and raises `JobCancelled` when it sees `cancelled`. The
  result is never uploaded and never written.

**The honest cost:** an in-flight generation that has already been dispatched still
completes at the provider and is still billed. The operator's UI is freed immediately and
no output is stored, but Stop is not a refund.

**Rejected:** an in-process `job_id → asyncio.Task` registry that calls `.cancel()` for a
true interrupt. It only works when the cancel request lands on the same instance running
the job — a coin flip the moment Cloud Run scales past one instance — and it entangles job
cancellation with worker-pool shutdown, where `CancelledError` already means something
else (`worker.py:217`). A guarantee that silently degrades in production is worse than a
smaller guarantee that always holds.

### The race that must not happen

The worker holds its own `AsyncSession` with the job in its identity map, and finishes with
`job.status = STATUS_DONE; await db.commit()` (`service.py:470`). A naive cancel would be
overwritten back to `done` by that commit, because the worker's in-memory copy is stale.

So the final write is **conditional**: `UPDATE … SET status='done', … WHERE id = :id AND
status = 'running'`. Zero rows affected means the job was cancelled while we worked; the
result is discarded and the uploaded blob deleted best-effort. `_apply_reading` and the
`auto_save` media registration are skipped on that path, so a cancelled job never lands a
creative in the Content library.

Checkpoints, in order: before the download; after the download, before any model call;
inside `_run_rebuild` after the analyst read and before `rebuild_image`; and immediately
before the upload. Each is a single indexed-column read, negligible against a 20–60 s job.
`JobCancelled` is caught by the worker as a clean stop — not a failure, no retry, no
`attempts` burn.

### API

`POST /api/cms/creative-fit/jobs/{job_id}/cancel` → `JobResponse`.

Scoped to the owning `cms_user_id`, same as `get_job`. Implemented as one conditional
statement: `UPDATE … SET status='cancelled', finished_at=now() WHERE id=:id AND
cms_user_id=:uid AND status IN ('queued','running') RETURNING id`. No rows means either the
job is not yours (404, matching `get_job`) or it has already settled (409). Cancelling a
cancelled job is a 409, not a silent success — the UI should never imply it stopped
something that had already finished.

## Error and edge behaviour

- A failed scan leaves the Scan button in place with the error beneath it, retryable
  without touching the pickers.
- A failed job re-enables both action buttons and toasts the reason — as today, except the
  buttons are genuinely re-enabled rather than never having been disabled.
- A cancelled job stops polling immediately, shows "Stopped" in the result slot, and
  returns both action buttons to live. The verdict card stays, because the ad and screen
  have not changed.
- `save_result` already requires `STATUS_DONE` (`service.py:552`), so a cancelled job
  cannot be saved to Content — no change needed.
- `JobHistory` and `ResultPreview` currently branch on `done` / `failed` / running
  (`JobHistory.tsx:82`, `ResultPreview.tsx:43`); both gain a `cancelled` branch so a
  stopped job reads as stopped rather than falling through to "running forever".

## Files

**`markai-signage-api`**

| File | Change |
|---|---|
| `creative_fit/models.py` | `STATUS_CANCELLED`; terminal-status set |
| `creative_fit/service.py` | `JobCancelled`, `_check_cancelled()`, checkpoints, conditional finish, `cancel_job()` |
| `creative_fit/router.py` | `POST /jobs/{id}/cancel` |
| `creative_fit/schemas.py` | `cancelled` in the status literal |
| `creative_fit/worker.py` | catch `JobCancelled` as a clean stop |

**`markai-Web-cms`**

| File | Change |
|---|---|
| `lib/creative-fit.ts` | pure `fitStage()` + `formatElapsed()` |
| `lib/creative-fit.test.ts` | every stage transition, stale-input reset, elapsed formatting |
| `lib/types.ts` | `FitJobStatus` gains `cancelled` |
| `lib/api.ts` | `creativeFit.cancelJob()` |
| `creative-fit/ScanCard.tsx` | new — the three-faced card |
| `creative-fit/VerdictCard.tsx` | takes `stage`; locked labels, timer, Stop |
| `creative-fit/ResultPreview.tsx` | `cancelled` branch |
| `creative-fit/JobHistory.tsx` | `cancelled` branch |
| `(dashboard)/creative-fit/page.tsx` | drop auto-run, add `scan()` / `stop()`, derive stage |

No change to `/analyze` or `/jobs`, and no APK involvement — Creative Fit never touches
the player contract.

## Verification

Backend: `poetry run ruff check app/creative_fit` and an import check. Per the project
rule, pytest is not run here — the user runs tests.

Frontend: `npx tsc --noEmit`, `npm test`, `npm run build`.

By hand at `localhost:5120/creative-fit` against the local backend on `:8095`:

1. Pick an ad and a screen — confirm **nothing** happens until Scan is clicked.
2. Click Scan — button locks, verdict appears, Scan card is gone.
3. Change the screen — verdict is discarded, Scan button returns.
4. Start a rebuild and hammer the button — exactly one job in history, not five.
5. Watch the timer advance through `queued` → `running`.
6. Stop a queued job — it never runs.
7. Stop a running job — the UI frees immediately, no result is stored, the worker logs a
   clean stop rather than a failure, and the row does not later flip to `done`.
