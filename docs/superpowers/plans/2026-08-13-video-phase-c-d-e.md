# Video Creative Fit — Phases C, D, E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** finish the video path — erase baked-in overlays, reshape onto any panel, fit the slot, and expose it through an HTTP API and an operator UI with an image/video toggle.

**Architecture:** three new concerns in their own subpackages under `app/video/`. Erase decides per region how to remove an overlay, preferring methods that recover REAL pixels over methods that invent them. Layout decides how a differently-shaped ad becomes a panel-shaped one, as pure geometry rendered by a single ffmpeg graph. The API is a sibling router that touches no existing route.

**Tech stack:** Python 3.12, Poetry, ffmpeg subprocess, Pillow, numpy, LaMa (Apache-2.0, already vendored). Frontend: Next.js 15 + React 19 + Tailwind 4. **No new Python dependency. No opencv. No deployment.**

---

## Global Constraints

**THE ABSOLUTE ONE — the image path is frozen.** Not one byte changes in `app/blueprint/`, `app/plate/`, `app/layout/`, `app/pipeline.py`, `app/api/router.py`, `app/api/schemas.py`. You may CALL `app.plate.lama.inpaint`; you may not edit it. The user has tested the image flow and it works. **Where video needs something the image path has, DUPLICATE it into `app/video/` — never move it, never re-export it, never parameterise the image version.** A previous move was reverted for exactly this reason.

- **`app/video/` imports nothing from `app/blueprint|plate|layout`** — except `app.plate.lama.inpaint`, which is a leaf module (torch + PIL only, no image-path coupling). Verify with grep; nothing else is permitted.
- **No new dependency.** opencv is NOT installed and `pyproject.toml` deliberately avoids what pulls it in. Registration is numpy FFT.
- **No deployment.** No GCP, Cloud Run, Docker, or CI changes. Local only.
- **No pytest.** `python cli.py check` is the suite; it must never regress and grows to 16.
- **ruff is the gate.** Line length 100, py312.
- **Licences:** Apache/MIT/BSD only. ProPainter, E2FGVI, VideoPainter, Ultralytics/YOLO (AGPL covers weights), InsightFace weights are all BLOCKED.
- **Colour:** every ffmpeg encode converts with `scale`'s `in/out_color_matrix` AND tags with `setparams`. Never `overlay` without `format=rgb` or `format=yuv444` — its yuv420 default halves chroma on type before the encoder does it again.
- **Native resolution is never downscaled.** Only the crop handed to a model may be.

## Measured facts — design to these, do not re-derive

| Fact | Value |
|---|---|
| LaMa, 512×512 crop | **2.41 s** |
| LaMa, 1024×1024 | **8.68 s** |
| LaMa, 2600×1463 (3.8 MP) | **99.5 s** |
| LaMa rate | **≈ 8.3 s/MP, CPU** |
| Gemini analysis | ~6–9 s/call, 7 calls/shot |
| x264 `slow` 1080p | ~11.2 ms/frame |
| Clip length | 15–20 s (450–600 frames) |
| Total budget | **900 s** |

`CLAUDE.md`'s "LaMa inpaints a 2600px creative in ~10s" is wrong by 10× on this hardware. **Do not fix that line — it documents the image path.** Record the measurement in the video section only.

---

## Folder structure

```
app/video/
  ffmpeg.py probe.py encode.py schemas.py render.py pipeline.py check.py   (existing)
  shots.py tracking.py blueprint.py motion.py                              (existing, Phase B)

  erase/            NEW — removing an overlay
    router.py       per-region branch decision
    register.py     numpy FFT phase correlation (global translation)
    plate.py        builds the erased mezzanine
    scrim.py        the designed-cover fallback
    flicker.py      the flicker ratio metric

  layout/           NEW — reshaping onto a panel
    typography.py   DUPLICATED type rules + the 4:2:0 mitigations
    geometry.py     windows, safe areas, containment, min_cap_px
    reframe.py      the moving-window planner + the gate
    compose.py      the rebuild-around-the-video planner
    duration.py     slot fitting (runs FIRST)
    render_slow.py  plan -> ffmpeg argv. Decides nothing.

app/api/
  video_router.py video_schemas.py jobs.py                                 NEW
```

---

## Task 1 — Erase: the router's decision logic

**Files:** create `app/video/erase/__init__.py`, `erase/router.py`. **Extend** `app/video/schemas.py` (additive only).

**Design.** Four branches, chosen per region per shot. Order matters — the cheapest exact method wins.

| Branch | Condition | Method | LaMa |
|---|---|---|---|
| `clean_plate` | `not motion.background_moves` | inpaint ONE frame's crop, paste to all | 1 crop |
| `median` | `pixels_static` AND `background_moves` AND **test D** | register, median the swept band, resample per frame | 0 |
| `scrim` | everything else, plus demotions | opaque band at sampled background colour | 0 |

Alpha inversion is **deferred** — narrow applicability, and the two branches above plus the scrim cover the realistic corpus.

**Test D is the point of this task, and it fixes a bug that would otherwise self-certify.** `motion.background_moves` only says *something* moved. A locked-off shot with a walking subject passes it; registration is then identity; the median still contains the overlay; the plate equals the input; the text survives into the finished ad — **and the flicker ratio reads a perfect 1.0.** Test D must establish that the CAMERA moved: sustained global translation ≥ **1.0 px/frame** over ≥ **60%** of the shot, with a phase-correlation peak ratio ≥ **3.0**.

**The scrim is a designed cover, not a failure.** A lower-third bar is a legitimate ad idiom; a flickering hallucinated background is not. It is static by construction, and it is the video analogue of the image path's `layout-led` rule — when the mask is large, rebuild rather than repair.

**Budget accounting.** `plan()` sums `cost_mp` per region (crop area × LaMa's 8.3 s/MP). Over `VIDEO_ERASE_BUDGET_MP = 60`, demote the most expensive regions to scrim in cost order and record it. Deterministic degradation — never refusal, never silence.

- [ ] Define `EraseBranch`, `EraseDecision` (branch, region, shot, cost_mp, reason), `ErasePlan` in `schemas.py`
- [ ] Implement `router.plan(blueprint, probe, motion_by_region) -> ErasePlan` — pure, no I/O, no ffmpeg
- [ ] Verify by constructing blueprints by hand: a locked-off shot → `clean_plate`; a panning shot with a static overlay → `median`; a shot failing test D → `scrim`; a budget overflow → the priciest regions demoted, and the plan says so
- [ ] `ruff` + `cli.py check` 12/12

## Task 2 — Erase: registration

**Files:** create `app/video/erase/register.py`.

**Design.** ffmpeg cannot do this: `vidstabdetect` is absent from this build (and vid.stab is GPL), `mestimate` exports vectors as side data rawvideo cannot carry, `deshake`/`minterpolate` correct motion without reporting it.

**numpy FFT phase correlation on the 480px proxy luma.** Cross-power spectrum gives sub-pixel translation in ~40 lines at ~1 ms per pair; 600 pairs is under a second. Rotation and zoom would need log-polar — **do not build that** until a clip demands it. Ad camera moves that matter are pans and slow pushes.

- [ ] `translation(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]` returning (dx, dy, peak_ratio)
- [ ] `shot_path(frames) -> list[tuple[float,float]]` — cumulative path plus the test-D verdict
- [ ] Verify against a **synthetic pan with known ground truth** (`crop` a still with a moving x): recovered translation within **0.5 px**, and peak ratio ≥ 3.0. Then verify a locked-off clip returns ~0 translation and FAILS test D — that is the discriminating case
- [ ] `ruff` + `cli.py check`

## Task 3 — Erase: streaming frame I/O

**Files:** **extend** `app/video/ffmpeg.py` (additive only — do not alter `run`/`run_probe`).

**Why.** `ffmpeg.run` is `subprocess.run(capture_output=True)`. 600 native 1080p RGB frames is **3.7 GB buffered** — it physically cannot do the erase pass. This was flagged in Phase A and is now due.

- [ ] `stream_frames(args, frame_bytes) -> Iterator[bytes]` — a `Popen` generator yielding exactly `frame_bytes` per frame, raising `FfmpegError` with stderr on non-zero exit
- [ ] `frame_sink(args) -> ContextManager` — a `Popen` stdin writer, same error contract
- [ ] Peak memory must be one frame, not the clip. Verify by streaming 600 frames and watching RSS
- [ ] Confirm `run`/`run_probe` behaviour is byte-identical (the 12 checks cover them)

## Task 4 — Erase: plate, scrim, flicker

**Files:** create `erase/plate.py`, `erase/scrim.py`, `erase/flicker.py`.

**Native composite — rule 7 for video.** Decode at native resolution. Extract the mask crop at native resolution (mask box + **128 px** margin, IOPaint's rule). If that crop exceeds **768 px** on its long edge, downscale *the crop alone*, inpaint, upscale the patch back LANCZOS. Composite in **numpy** (`out = patch*a + frame*(1-a)`, Gaussian-feathered mask, seam = `max(2, round(0.002 * min(W,H)))`). Never ffmpeg `overlay`. Everything outside the crops is bit-identical.

**Mask geometry.** Boxes come from a 480 px proxy so their error scales ×2.25 to 1080p. Quantise to native pixels once, dilate `max(4, 0.06 * cap_px) + 2` (chroma bleed) plus `shadow_offset + 2*shadow_blur` asymmetrically, cap at 0.25 × box height, then **freeze for the shot**.

**Flicker ratio** = `_crop_mafd(erased_region) / _crop_mafd(control_region)`. Reuse `motion._crop_mafd` — it already IS frame-to-frame absolute luma difference inside a crop. **Median, not mean** (GOP outliers drag a mean over any threshold). Control region = the erase box mirrored horizontally, re-picked on overlap, and recorded in `erase.json` so the number is auditable. Gate **≤1.5 PASS / ≤2.0 WARN / >2.0 FAIL, upper bound only** — a pasted patch legitimately reads ≈0.1 because it is bit-identical while its surroundings carry quantisation noise.

**Output:** `plate.mov`, ProRes 422 HQ, **native resolution, CFR, BT.709-tagged, same frame count and fps as the flattened source, no audio**, plus `erase.json`. **Build it only when at least one target needs reframe or compose** — if everything lands on stretch/crop, no plate is built at all.

- [ ] Verify on a synthetic clip with a drawn box: flicker ≤1.5, and **PSNR of the erased band against the same clip rendered WITHOUT the box** — flicker alone is insufficient, a flat grey rectangle also scores 1.0
- [ ] Verify the scrim path produces a static band and reports itself honestly
- [ ] `ruff` + `cli.py check`

## Task 5 — Layout: typography (DUPLICATED) and geometry

**Files:** create `layout/typography.py`, `layout/geometry.py`.

**Duplicate, do not import.** Copy what is needed from `app/layout/rules.py` — `FONTS`, `SCRIPT_FONTS`, `script_font`, `load_font`, `wrap`, `line_height`, `CAP_RATIO = 0.72`, `MIN_FONT_PX`, the role tables — into `layout/typography.py`, keyed on `TextRegion.role` (a plain string) rather than the image path's `Role` enum. Copy `contrast_ratio`/`readable_on` from `app/layout/service.py` the same way. **The image path must not be touched, imported from, or parameterised.**

**The three 4:2:0 mitigations live here:**
1. `readable_on_video` — additionally requires **|ΔY′| ≥ 0.25** (64/255) in gamma-encoded BT.709 luma, because that is what the full-resolution luma plane physically carries
2. `ROLE_FLOOR_VIDEO = ROLE_FLOOR × 1.35` (HEADLINE 0.032 → 0.043, landing on the 4.5%-of-height legibility target), with a hard post-check that the stroke is ≥ 3 px at output height
3. `outline_for(colour, bg)` → `(width, fill)`, fill black or white by max |ΔY′|, `width = max(2, round(0.045 * cap_px))`, passed as Pillow `stroke_width`/`stroke_fill`

**Geometry** is pure functions: window/aspect math, safe-area boxes (**5% for burned-in text, 10% for text we place** — re-margining the advertiser's own composition buys no legibility), containment tests, and `min_cap_px` from the legibility rule (8.33 mm cap per metre; 3.5 m default; clamp 3.0–7.5% of panel height).

- [ ] Verify Indic shaping still works (Devanagari/Kannada render as glyphs, not boxes)
- [ ] Verify `readable_on_video` rejects a red-on-blue pair that `readable_on` accepts
- [ ] `ruff` + `cli.py check`

## Task 6 — Layout: reframe

**Files:** create `layout/reframe.py`.

**No L1 path, no LP solver, no scipy.** Seven samples per shot does not justify one, and every crop change happens at a shot boundary where the picture already changes completely — which deletes the global-path problem L1 exists to solve.

Per shot: (a) if one fixed window of the target aspect contains every required box across all samples and passes the gate → **static, exactly, by construction**; (b) else fit centre `c(t) = c₀ + v·t` against per-sample interval constraints — a **2-variable feasibility problem**, ≤14 half-planes, solved exactly by walking the feasible polygon and taking the vertex minimising `|v|`; (c) infeasible → gate failure.

**`MIN_PAN_SPEED = 0.6 px/frame`.** Below it, snap to static and widen the window — a 0.2 px/frame pan holds for four frames then jumps, which reads as broken. Above it, ffmpeg's integer `x`/`y` is invisible against real footage. **This deletes the sub-pixel numpy loop entirely.**

**The gate** runs before any pixel moves and returns `list[GateViolation]` naming shot, region and shortfall in px: every required text box inside the window for every frame it is visible; logo inside; no partial faces; safe-area margins; **effective upscale ≤ 1.5×** (1.8× when the window retains no burned-in text — footage tolerates upscale far better than type). On failure the **whole target** routes to compose; never a per-shot mix, which reads as a broken player.

**Write down the consequence:** for a narrower target the maximum window is full-height, so `effective upscale = h_target / H_source`. A 1920×1080 master therefore **can never reframe onto 1080×1920 (1.78×) or 1080×2400 (2.22×)** — both always compose. Reframe's domain is 4K/2K masters onto 1080p panels.

- [ ] Verify: a static-window case resolves to exactly static; a pan case yields a feasible `v`; an over-upscale case fails the gate with a readable violation
- [ ] `ruff` + `cli.py check`

## Task 7 — Layout: compose and duration

**Files:** create `layout/compose.py`, `layout/duration.py`.

**Compose calls `reframe.plan()` as a subroutine** to size the stage: search stage aspect downward from the source's, take the tallest window passing the same gate. Two objectives in order — tallest, then excluding the most rescued-text area (text cropped away needs no erase at all). Note the inversion: reframe wants required text *inside* the window; compose wants rescued text *outside* it.

**Compose has no upscale problem by construction** — the video is placed smaller than native, never larger.

**Canvas: a flat `background_hex` card.** Not a blurred extension. It costs zero per-frame work, and it gives `readable_on_video` an *exact constant* background to check against — the only way the luma-delta requirement can be guaranteed rather than hoped. A blurred still frame is the fallback when `background_hex` is missing. **Never a moving blur**; a single contrast measurement cannot certify 600 frames of luminance under a headline.

**Copy-state timeline, not per-frame text.** Collect every region's `first_seconds`/`last_seconds` and every shot boundary into breakpoints; between breakpoints the visible copy set is constant. A 15 s ad yields **2–6 states, not 600**. Render one full-panel RGBA PNG per state with Pillow, composite in ffmpeg as extra inputs with `overlay=0:0:format=rgb:enable='between(t,t0,t1)'`. **`format=rgb` is load-bearing.** Merge any state under **2.0 s** into its neighbour rather than flashing it.

**Duration runs FIRST**, before reframe and compose — trimming changes which shots exist, which changes both the crop plan and the copy timeline. Trim and hold are **one mechanism**: a shot-boundary trim can never hit an exact slot, so pick the largest contiguous shot run ≤ slot (≤210 candidates for 20 shots — enumerate them) scored by role-weighted text-hold coverage, and absorb the residual in a **designed hold card** (`background_hex` + logo + top-priority line, same typography). In the reframe tier hold the true last frame up to **1.5 s**, then switch to the card.

- [ ] Verify: stage sizing picks a sane window; the copy timeline collapses to a handful of states; a 20 s clip into a 15 s slot trims at a real shot boundary and the residual is held
- [ ] `ruff` + `cli.py check`

## Task 8 — Layout: render_slow, and wiring

**Files:** create `layout/render_slow.py`. **Extend** `render.py`, `pipeline.py`, `check.py`, `cli.py`.

**One ffmpeg invocation, no intermediates.** `split` + per-shot `trim`/`crop`/`scale` chains + the **concat filter** — each chain gets its own constant `crop` w/h, so ffmpeg's "w/h evaluated once" limitation never binds. One decode, one encode. `render_slow.py` decides nothing; it turns a plan into argv.

`render.render` gains the two new tiers, dispatching on `fit_mode` plus the gate. `pipeline` gains the erase and layout stages, cached. `check.py` grows to **16**: `erase-flicker`, `erase-recovers` (PSNR vs ground truth), `erase-registration` (recovered pan within 0.5 px), `erase-loop-seam`.

- [ ] **The end-to-end proof:** `cli.py fit <landscape>.mp4 1080x2400` produces a real portrait video instead of refusing
- [ ] Verify the fast path is untouched: a ≤1.25× target still takes one ffmpeg pass
- [ ] `ruff` + `cli.py check` → 16/16

## Task 9 — HTTP API

**Files:** create `app/api/video_router.py`, `video_schemas.py`, `jobs.py`. **Extend** `app/main.py` (+2 lines). **`app/api/router.py` and `schemas.py` are UNTOUCHED.**

Routes: `POST /api/video/ingest` (sync), `POST /api/video/{id}/fit` (202), `POST /api/video/{id}/analyse` (202, 503 without a key), `GET /api/video/jobs/{job_id}`, `POST /api/video/jobs/{job_id}/cancel`, `GET /api/video/{id}/blueprint`, `GET /api/video/{id}/file/{name}`.

**No upload-session flow** — that exists only to dodge Cloud Run's 32 MiB body cap and there is no Cloud Run. Multipart is fine locally.

**Jobs:** in-process registry, one lock, `ThreadPoolExecutor(max_workers=1)` so a 10-minute video cannot starve the image threadpool. `percent`/`eta_seconds` server-computed and **monotonic**. Jobs expire after 1 h and are lost on restart — state that, do not hide it.

**`refusals[]` re-authors `fit_video`'s failures** — the API must never leak `NeedsRebuild`'s internal wording. Include `planned_mode` so the frontend never string-matches a message.

Starlette 0.46.2 has Range support (verified), so `<video>` scrubbing works with a plain `FileResponse`.

- [ ] Verify every existing image route behaves identically
- [ ] `ruff` + `cli.py check`

## Task 10 — Frontend

**Repo:** `markai-creative-fit-web`. **The existing image flow must behave exactly as today.**

The toggle is a **route**, not a state flag — a `useState` mode inside `page.tsx` would force the tested workbench into branches.

| File | State |
|---|---|
| `src/app/page.tsx` | **MODIFIED** — +1 import, +1 `<FitModeToggle current="image" />`. Nothing else. |
| `src/app/video/page.tsx` | NEW — the video workbench |
| `src/components/fit-mode-toggle.tsx` | NEW |
| `src/components/video-{drop,panel,rack,readout}.tsx` | NEW — duplicates, not shared components taking a `kind` prop |
| `src/components/job-progress.tsx` | NEW — a growing receipt, not a spinner |
| `src/lib/video-{api,types,screens}.ts` | NEW |
| `next.config.ts` | MODIFIED — +1 rewrite `/api/video/:path*` |
| `src/lib/{api,screens,types}.ts`, `components/{creative-drop,panel,screen-rack,blueprint-readout}.tsx` | **UNTOUCHED** |

Honour the five documented load-bearing behaviours: the proxy rewrite, the duplicated threshold constants (a third copy in `video-screens.ts`, commented to name `app/video/render.py::fit_mode`), the `flex-1` panel shelf spacer (**copy it verbatim — parameterising `panel.tsx` is what would break it**), the `overflow-x-auto` + `min-w` table wrapper, and separate `done`/`forecast` copy strings.

**Refusals read as "not yet", never "failed"** — forecast before the click, name the arithmetic, offer a shape that does work, and never use a red/danger style.

- [ ] `npm run typecheck` and `npm run build` both clean
- [ ] The image flow is visually and behaviourally identical
- [ ] Upload a video, fit it, watch progress, see a portrait result

---

## What this plan deliberately does NOT build

Per-frame LaMa (1446 s against a 900 s budget, and worse output than a scrim on the masks that reach it). Alpha inversion (deferred). opencv / optical flow (served only the deleted branch). L1 camera paths or any LP solver. Any detector or segmenter — Ultralytics is AGPL *including weights*, InsightFace weights are non-commercial, SAM 2 would fight the per-shot mask freeze. u2net cutouts in the video path. Per-frame text shaping. Moving/blurred backdrops behind copy. Mixed tiers within one output. A learned quality score. An automatic flicker gate on publication — report it, offer the letterbox, let a human decide. Any deployment. **Any change whatsoever to the image path.**
