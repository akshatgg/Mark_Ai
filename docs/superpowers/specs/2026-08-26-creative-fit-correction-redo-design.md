# Creative Fit — say what's wrong, redo it

**Date:** 2026-08-26
**Status:** approved, implementing
**Touches:** `markai-signage-api/app/creative_fit/*`, `markai-Web-cms` Creative Fit page

## The problem

An operator fits a Carpisa ad onto a 960×1152 portrait panel. The AI rebuild
comes back and it is *nearly* right — but the handbag has floated up out of the
line it sat on in the original. Today the only options are: accept it, download
it, or press Redo, which throws the whole thing away and rolls the dice again
with the identical prompt. There is no way to say the one sentence that would
fix it.

So: after a rebuilt fit lands, give the operator a box to describe what is wrong
and a Redo that acts on it.

## What appears, and when

A single row inside the result card, between the before/after images and the
Download / Save footer:

```
│  Not quite right? Say what to change:                 │
│  ┌────────────────────────────────┐  ┌──────────────┐ │
│  │ the bag should sit at the same │  │ Redo with    │ │
│  │ height as in the original      │  │ this fix     │ │
│  └────────────────────────────────┘  └──────────────┘ │
```

Shown **only** when all of these hold:

* the job finished (`status === "done"`),
* it actually ran as an **AI rebuild** — a plain resize is a deterministic crop
  and the operator was never asked to describe it, so there is nothing to
  instruct,
* this server has AI configured (`rebuild_available`).

The button is the existing Redo, and what it does follows the box:

| Box | Button | Behaviour |
|-----|--------|-----------|
| empty | `Redo` | exactly today's behaviour — clear the result, start the fit over |
| filled | `Redo with this fix` | queue a correction pass |

Nothing new appears while a job is running: the page's existing `fitStage`
already locks every control the moment a job is live, so a correction cannot be
double-fired or stacked onto a running one.

## What the model is given

A correction is an ordinary job row — same table, same three workers, same
polling, same Stop button. Two fields make it a correction:

* `parent_job_id` → the job being corrected,
* `user_note` → the operator's sentence.

When the worker finds a parent it **skips the analyst read entirely** and reuses
the parent's stored `rebuild_prompt` as its base. That is the load-bearing
decision: the layout plan and the numbered list of text strings ("20% OFF", "on
purchases above ₹5,000") are byte-identical to the pass before, so the price and
the validity date cannot drift between attempts. Then it appends:

```
CORRECTION FROM THE OPERATOR
Image 1 is the original advertisement.
Image 2 is your previous output for this screen.
Keep everything in image 2 exactly as it is, except for the change below.
Change only this: <the operator's sentence>
```

…and sends **both images** with the prompt, in that order.

Cost: one image generation and **zero** analyst calls — cheaper than the fit
that produced it.

### Chaining

Pass 2 corrects whatever is on screen, which may itself be a correction. Its
base prompt is the parent's prompt with everything from the
`CORRECTION FROM THE OPERATOR` marker onward stripped off. Without that, note 1
would linger in the prompt and fight note 2; with it, each note applies to the
image the operator is actually looking at, which is what "latest result + latest
note" means.

### Fallbacks

Nothing about a correction may leave the operator with a dead button:

* Parent's result unreadable (swept, bucket blip) → the endpoint refuses up
  front with 409 "that fit has been cleared — run it again first"; if it
  vanishes between queueing and execution, the worker falls back to a normal
  rebuild with the note appended as an `ADDITIONAL INSTRUCTION`.
* Parent has no stored `rebuild_prompt` → fresh analyst read, note appended.
  Same as any ordinary rebuild-with-a-note.

## History

Each correction is its own job row, so:

* the earlier version stays in **Recent Fits** and is one click away when a fix
  makes things worse,
* the note is stored on the row and shown on the history card, so the strip
  reads as a trail of what was asked for.

The **Before** frame of a correction job stays the *original ad*, not the
previous attempt — a correction job's source genuinely is the original, and
keeping it consistent means every card on the page means the same thing.

## Changes

### Backend (`markai-signage-api`)

| File | Change |
|------|--------|
| `creative_fit/models.py` | `parent_job_id` — nullable self-FK, `ON DELETE SET NULL`, indexed |
| `alembic/versions/0059_creative_fit_refine.py` | the column |
| `creative_fit/prompts.py` | `CORRECTION_MARKER`, `strip_corrections()`, `build_refine_prompt()` |
| `creative_fit/gemini_image.py` | `rebuild_image(..., previous_bytes, previous_mime)` → a third content part |
| `creative_fit/schemas.py` | `RefineRequest`; `parent_job_id` on `JobResponse` |
| `creative_fit/service.py` | `refine_job()`; the parent branch in `_run_rebuild()` |
| `creative_fit/router.py` | `POST /jobs/{job_id}/refine` |

`refine_job` clones the parent's source and target rather than re-resolving
them: the parent belongs to the caller (`get_job` scopes it), so its inputs were
authorised when it was created, and cloning avoids downloading the source purely
to re-measure something already measured.

It refuses (409, in plain language) when the parent is not `done`, did not run
as a rebuild, or has no result left; and 503 when the server has no
`GEMINI_API_KEY`.

### Frontend (`markai-Web-cms`)

| File | Change |
|------|--------|
| `lib/types.ts` | `parent_job_id` on `FitJob` |
| `lib/api.ts` | `creativeFit.refine(id, note)` |
| `lib/creative-fit.ts` | `executedMode()`, `canRefine()`, `redoLabel()` — pure, next to `fitStage` |
| `components/creative-fit/ResultPreview.tsx` | the correction row |
| `app/(dashboard)/creative-fit/page.tsx` | `refine()` handler |
| `components/creative-fit/JobHistory.tsx` | show the note on a corrected fit |
| `lib/creative-fit.test.ts` | cover the three new pure helpers |

## Verification

* CMS: `npm run test`, `npm run typecheck`, `npm run lint`.
* Backend: `ruff` + an import check. No pytest (the user runs tests).
* Live check on the real page once the branch is up.
