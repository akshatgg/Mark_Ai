# markai-creative-fit — guide for Claude sessions

Read the root `CLAUDE.md` first. This service is **new** and stands apart from the
signage system: nothing here touches Postgres, the APK, or the CMS session model.

## What it is
Given a **finished ad creative** (text already baked into the pixels) and a target
screen resolution, rebuild the ad for that shape. Not crop, not stretch — take it
apart and lay it out again.

**There are two paths, and they do not touch each other.** `app/blueprint|plate|layout`
+ `app/pipeline.py` are images; `app/video/` is video. No file in one imports from the
other. Changing the image path is not a way to change the video path, and vice versa.

The video decision was taken 2026-08-12 (`docs/superpowers/specs/
2026-08-12-video-creative-fit-design.md`). The earlier "no video path" note was right
about the reason and wrong about the conclusion: ProPainter IS non-commercially
licensed and remains blocked, but so are E2FGVI (CC-BY-NC) and VideoPainter, and the
two MIT alternatives were investigated and rejected on their merits — FGT crashes past
~200 frames (we need 450-600) and cannot run on an L4; STTN was never trained above
~432x256, so it either degrades at native resolution or forces a 6x upscale of every
repaired pixel. The answer is a deterministic router that recovers real pixels from
other frames wherever possible, with per-frame LaMa on a mask-cropped region as the
fallback — which is the same resolution-correct architecture the image path already
uses.

## Shape
```
app/blueprint/   Gemini vision → Blueprint; analysis.py = strategy choice
app/plate/       LaMa erase (lama.py) + u2net cutouts (cutout.py)
app/layout/      rules.py = typography + fitting; service.py = compose
app/pipeline.py  orchestration + content-hash caching
app/api/         FastAPI surface
cli.py           local runner, same pipeline, no server
```

## Two rebuild strategies (`app/blueprint/analysis.py`)

Which one runs is decided by how much of the creative has to be repainted:

- **photo-led** (< 20% masked) — the ad IS a photograph with a little type on
  it. Repair the background, use it as the canvas, set copy over it. There is no
  separate photo block; drawing one prints the image twice.
- **layout-led** (≥ 20% masked) — the ad is a designed card: lots of type on a
  flat ground with a photo inset. Repairing that background is hopeless *and
  unnecessary*. Rebuild on a fresh card of `background_hex` and place the photo
  as a rounded inset. Only text sitting ON the photo is inpainted, which keeps
  the mask small and local.

A real estate ad hit 32% coverage across 12 boxes; LaMa returned doubled words
and mirrored phone numbers. That measurement is why the split exists.

## Composition is region-based, never a flat stack
```
HEADER  logo (at the end it started) + any lockup line beside it
COPY    headline · subhead · body, fitted to a budget
STAGE   the product shot, its captions, and badge cutouts
FOOTER  contact block + legal, on the bar they sat on
```
**Every region is optional.** Posters arrive with different pieces — no photo,
no logo, no contact bar, sometimes only a headline. The split is computed from
what is present. Do not reintroduce assumptions about a fixed element set.

`Blueprint` (`app/blueprint/schemas.py`) is the central artifact. Stages 1–2 produce
it once per creative; every resolution is then a cheap render off it. **Preserve that
split** — putting model calls in the render path destroys the economics.

## Rules that are load-bearing (don't "simplify" these away)

1. **The three-tier shape check** (`rules.fit_mode`). ≤1.08× shift → stretch to fit
   (nothing cropped, nothing lost). ≤1.25× → scale + centre-crop. Above that →
   rebuild. Rebuilding a near-same-shape creative measurably produced a worse ad
   than leaving it alone. This is not an optimisation; it is a correctness rule.
   The rebuild only earns its keep on a genuinely large gap (laptop → phone).
2. **Text sized by canvas height, never by source scale factor.** `ROLE_HEIGHT` in
   `app/layout/rules.py`. This is the entire reason the service exists.
2b. **Copy is fitted to a budget and can never overflow** (`rules.fit_to_budget`).
   It shrinks the whole scale together to keep the hierarchy, down to
   `ROLE_FLOOR`; only then does it drop blocks, in `SACRIFICE_ORDER`, and report
   them. The photo shrinks to `STAGE_MIN` *before* any word is dropped — an ad
   that cannot be read has failed, an ad with a smaller photo has not. The
   version without this overflowed a 10-block ad by 799px straight across the
   product shot.
2c. **Badges are cutouts, never retyped.** `Role.BADGE` is text inside a coloured
   shape. Retyping "₹3.3Cr ONWARDS" as two lines throws away the red circle it
   lived in and the ad stops looking like the ad.
2d. **Non-Latin scripts get a Noto face** (`rules.script_font`). All eight Latin
   families are missing 13/13 Kannada glyphs — a Kannada line rendered in
   Montserrat is a row of empty boxes. Pillow here is built with raqm, so Indic
   conjuncts shape correctly.
2e. **Text colour is contrast-checked against where it lands** (`readable_on`).
   Gemini reports the colour the type had in the ORIGINAL; after a re-layout that
   colour can end up on a completely different background.
3. **The logo zoom-refine second Gemini call is required.** Whole-image boxes are
   fine for erasing text but too loose to cut a trademark — the first-pass crop came
   back half background.
4. **Bottom furniture is measured before the photo band is positioned, and the band
   is clamped to `band_limit - band_h`.** Clamping to `height - band_h` instead lets
   the photo run under the logo and legal line — that bug shipped once and put the
   copyright line straight across the bottle.
5. **Mask padding is proportional to each box, not the image** (`MASK_PAD_Y/X` in
   `app/plate/service.py`). Gemini's boxes vary run to run — the same creative gave a
   headline box 27% shorter on a second pass, and a flat 5px pad left a white smear
   where the descenders were.
6. **Never let a generative model repaint brand assets.** The logo is cut from the
   original; the product is untouched. LaMa only fills regions we deleted. An
   AI-redrawn client trademark is not shippable on a paying advertiser's screen.
7. **Output resolution is never capped.** `MAX_ANALYSIS_EDGE` limits only what the
   MODELS see; `plate.service.build` composites the inpaint back onto the
   full-resolution original so the plate and logo stay native. Do not "simplify" that
   composite away — it is the difference between a 2600px and a 3600px plate. Likewise
   `JPEG_SUBSAMPLING=0` (4:4:4) is deliberate: 4:2:0 smears coloured type. These land on
   physical panels and the user has been explicit that quality must not be downgraded.

## The video path (`app/video/`)

```
probe.py     ffprobe -> VideoProbe. Probe, never assume: half of real ad masters
             declare no colour tags, and guessing wrong is the "looks flat" bug.
ffmpeg.py    the subprocess boundary. assert_build() checks the ffmpeg version
             floor unconditionally; the HarfBuzz text-shaping build flag is only
             enforced when called with require_text=True.
encode.py    H.264 level arithmetic. 2560x960 needs level 5.0, NOT the 4.2 you
             would reach for by habit — it exceeds 4.2's 8,704-macroblock limit.
render.py    the fast path: stretch/crop in one ffmpeg pass, no Python per frame.
check.py     the test suite. There is no pytest here; `python cli.py check` is it —
             TWELVE checks: 3 colour (golden_frame), 6 encode (encode_assertions),
             3 analysis (analysis_assertions).
pipeline.py  probe once, analyse once, render many — same split and cache key as
             app/pipeline.py, plus a variant cache stricter than a file-exists check.

--- Phase B, analysis (no rendering, no erasing) ---
shots.py     shot boundaries + per-frame MAFD from ONE ffmpeg `scdet` pass.
tracking.py  flickering per-frame detections -> one stable region per shot.
             Pure geometry, no numpy, no opencv, deliberately.
blueprint.py 7 sampled frames per shot -> Gemini reads MEANING -> VideoBlueprint.
motion.py    the three static tests: has the box moved, have its pixels changed,
             and does the SURROUND move (i.e. is the truth recoverable at all).
```

### Video rules that are load-bearing

1. **Colour tags are written with the `setparams` filter, never `-color_*` output
   flags.** Measured on ffmpeg 8.1.2: the output flags leave `color_transfer` and
   `color_primaries` as `unknown`. And tagging alone is not enough — without
   `out_color_matrix=bt709` on the `scale` filter, swscale encodes with its default
   601 matrix while the tag says 709, and cyan drifts (0,190,190) -> (0,171,192).
   That recipe measures a patch delta of 30 against 1 for the correct one.
2. **A clean round-trip is not proof.** An encode with no colour handling at all
   round-trips at delta=1 and ships an UNTAGGED file that a BT.709 panel renders
   wrong. `check.py` therefore asserts pixels AND tags, independently.
3. **`-preset ultrafast` silently drops the profile from `high`.** Not to
   Constrained Baseline, though — this project's `-x264-params` explicitly set
   `bframes=2:ref=3:b-pyramid=none`, which keeps B-frames alive, so ultrafast can't
   push it all the way down to Baseline. Measured against this repo's own
   `encode_args()`: it lands on `Main` instead. The point is the silent downgrade,
   not the specific name it lands on, so `check.py` asserts `profile == High` —
   that catches the encoder settling for anything less, whatever ffprobe happens to
   call it.
4. **Never emit 3840x2160@60 H.264.** The AndBox S905X4 tops out at 4K High@L5.1
   30fps. `encode.h264_level` refuses it rather than shipping an unplayable file.
5. **The fast path is the point.** Below a 1.25x shape shift, nothing is decoded into
   Python. Most bookings land there, and the difference between one ffmpeg invocation
   and a 600-frame numpy round trip is the difference between seconds and minutes.
6. **Image/video quality parity is impossible, and that is not a bug.** The image path
   uses 4:4:4 (`JPEG_SUBSAMPLING=0`) because 4:2:0 smears coloured type. H.264 4:4:4 is
   High 4:4:4 Predictive, which the player cannot decode, so video is 4:2:0 by force.
   The mitigations are in the spec: require luma contrast (not just colour contrast),
   raise the text-size floors, add a luma-contrasting outline.
7. **`ffmpeg.assert_build(require_text: bool = False)` enforces two different things
   on two different schedules.** The ffmpeg version floor (>= 7) is checked always. The
   HarfBuzz build-flag check — the one that matters for Indic shaping — only fires
   when called with `require_text=True`, deferred because Phase A renders no text at
   all (and this dev machine's Homebrew ffmpeg lacks `--enable-libharfbuzz`). The
   phase that turns on `drawtext` must call it with `require_text=True` and take the
   hard fail this was written for.
8. **The variant cache in `pipeline.py` is only trusted when the sidecar JSON exists
   AND the file's on-disk size matches the sidecar's recorded `bytes`.** Existence
   alone is not enough: an interrupted render can leave a 0-byte `.mp4` that
   `exists()` would happily hand to a panel, and a stale or hand-edited sidecar can
   name a path that no longer exists. A cache hit's returned `path` is always the
   locally computed one, never the sidecar's stored string, for the same reason
   `app/pipeline.py` does it on the image side. This was the single buggiest area of
   Phase A — do not weaken either check.

9. **A partial read must never silently delete a region.** `blueprint.analyse` scores
   presence against frames that SUCCEEDED, not frames attempted. With 7 samples and
   `MIN_PRESENCE=0.60`, three timed-out frames would otherwise put a perfectly stable
   overlay at 4/7 = 0.571 and vote it away as "flicker" — and a region that never
   appears is never erased, so the original baked-in text survives into the finished
   ad. Gemini calls DO stall under rate limiting (see `VIDEO_ANALYSIS_CALL_TIMEOUT_
   SECONDS`), so this is an expected condition, not a freak one. Lost reads are also
   warned about, and a blueprint carrying warnings is NOT cached — otherwise one
   transient outage poisons that creative until someone thinks to pass `--force`.
10. **Rotation is resolved once, in `probe.py`.** ffmpeg autorotates during filtering,
   so a 640x360 source tagged `rotation=90` decodes as 360x640. `probe` swaps the
   dimensions so every downstream consumer sees post-rotation space. Without it,
   Gemini's boxes are portrait-normalised while the stored size is landscape, and
   `motion.classify` fails on every region — silently, because the caller swallows it.
11. **`app/video/` imports NOTHING from the image path.** The shared font vocabulary
   lives in `app/core/fonts.py`; `app/layout/rules.py` re-exports `FONTS` from there.
   An earlier version imported it straight from `app.layout.rules`, which quietly made
   this file's own opening claim false and dragged PIL into the video path.

### Verifying the video path

```bash
python cli.py check                              # 12 checks: 3 colour, 6 encode, 3 analysis
python cli.py fit ad.mp4 1920x1080 1600x900      # same command as images (fast path)
python cli.py analyse ad.mp4                     # shots, text, recover-vs-inpaint
```

`check` must pass before any commit that touches `app/video/`. It needs no Gemini key.
`fit` needs no key either — only `analyse` does, because only it calls the model.

## Dependency trap
`simple-lama-inpainting` and `rembg` declare conflicting numpy ceilings (`<2` vs the
2.x their current releases pull). They cannot share an environment. Both models are
therefore invoked directly — `app/plate/lama.py` loads the TorchScript checkpoint,
`app/plate/cutout.py` runs u2net through onnxruntime. Do not reintroduce either
package.

## Conventions
- Mirrors `markai-signage-api`: Poetry, `app.core.config.settings`, per-domain
  `schemas.py` / `service.py`, `ruff` as the gate.
- API handlers are plain `def` (not `async def`) — LaMa and u2net are CPU-bound and
  sync, so FastAPI runs them in its threadpool.
- Weights and `.work/` artifacts are gitignored and reproducible.

## Verifying
No pytest in this repo (see root guide). Verify by running the CLI on a real banner
and **looking at the output**:
```bash
python cli.py fit <banner.jpg> 1080x2400 1920x1080 --sheet
```
The `--sheet` contact sheet is the fastest way to judge a result. Check: is the
headline readable, is the logo intact, did the background extension band, did the
1920×1080 case correctly report `scale` rather than `relayout`.
