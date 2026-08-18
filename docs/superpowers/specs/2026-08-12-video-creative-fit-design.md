# Video Creative Fit — design

**Date:** 2026-08-12
**Status:** design, awaiting review
**Scope:** add a video path to creative refitting, alongside the existing image path.

---

## 1. What this is

Given a **finished video advertisement** (text already baked into the pixels) and a
target screen resolution, produce a video that plays correctly on that panel — the
right shape, the right slot length, and with copy that is still readable.

Not a stretch. Not a centre-crop. The frame follows what matters, and copy that the
reframe would have cut — or that would land too small to read at three metres — is
erased and re-typeset at a size derived from the target panel.

### The governing constraint

**The image path does not change.** Not its code, not its behaviour, not its output.
Video is a parallel path. It shares only plumbing that is already generic — the job
queue, GCS, the media library. No image function acquires an `if video:` branch. The
CMS gets an `Image | Video` toggle; the image side of that toggle behaves exactly as
it does today.

This is a hard requirement, not a preference. Where reuse would mean modifying image
code, we duplicate instead.

---

## 2. Decisions taken, and why

| Decision | Choice | Rationale |
|---|---|---|
| How far to go | Smart reframe **+ rescue cropped/illegible text** | A reframe alone leaves small text small; the panel is 3 m away |
| Processing budget | ≤ 15 min per video; clips are 15–20 s (450–600 frames) | Generous enough for per-frame work, if the common path avoids it |
| Sign-off | Auto-publish, always previewable, one-click safe fallback | Nothing blocks a booking; nothing is a black box |
| Duration | Service fits the slot too | Only this service can see where a shot ends |
| Audio | Stripped | Silent café panels |
| Home | Job in `signage-api`, frame work in `markai-creative-fit` | Keeps torch/ffmpeg out of the main API image |
| Erase engine | Deterministic router; benchmark STTN/FGT against the hard branch later | Cheapest, exact where it applies, no new licence surface |

### The number that shapes everything

`markai-creative-fit/CLAUDE.md` records that **LaMa inpaints a 2600px creative in ~10 s
on CPU**. At 600 frames that is **100 minutes — 6.7× over budget.**

Per-frame LaMa on CPU is not viable. The deterministic router is therefore not an
optimisation; it is the only thing that makes this fit.

**Measured/derived budget for a 600-frame 1080p clip on 8 vCPU** (note: Cloud Run's
8 vCPU is ~4 physical cores — GCE counts hardware threads as vCPUs):

| Stage | ×600 frames | Confidence |
|---|---|---|
| H.264 decode | ~1–3 s | **measured** (0.46 ms/frame) |
| DIS optical flow, `PRESET_FAST` | ~12–18 s | derived |
| Temporal median (N≈15) | ~95 s | low |
| `warpAffine` INTER_LANCZOS4 | ≥29 s, plausibly 60–120 s | low — floor only |
| Pillow alpha composite | ~8 s (~2 s with SIMD) | medium |
| LaMa on crop, once per clip | ~10 s | **unverified** |
| x264 `slow` encode | ~13 s | **measured** (11.2 ms/frame) |
| **Total** | **≈ 2.6 – 4.8 min** | |

**The bottleneck is not the encode.** `warpAffine` with `INTER_LANCZOS4` plus the
temporal median are **70–80%** of the budget; the x264 `slow` encode I worried about is
~5%. Two cheap wins follow directly: `INTER_LANCZOS4` costs **7.6×** `INTER_LINEAR` and
3.8× `INTER_CUBIC`, so verify we genuinely need 64-tap resampling; and Pillow-SIMD's
AVX2 alpha compositing is **4.5×** stock Pillow, with AVX2 guaranteed on Cloud Run.

**4K breaks the budget.** Every stage scales ~4× with pixel count (encode measured at
3.69×, primitives linear), putting a 4K clip at **~10–19 min**. 4K therefore needs its
own longer lane, or processing at reduced scale with the composite back at native
resolution — see §4.6.

Two numbers here are unverifiable from any published source, and both should be measured
on the real Cloud Run shape before the worker count is fixed: **LaMa CPU inference time**
(no benchmark stating CPU model and thread count exists anywhere — our own ~10 s figure
is neither corroborated nor contradicted) and **OpenCV DIS at true 1080p** (OpenCV ships
a perf test for exactly this and never publishes its results).

---

## 3. Architecture

```
markai-Web-cms                  /creative-fit gains an [ Image | Video ] toggle.
   │                            Image side untouched. Video side = new components.
   ▼
markai-signage-api              creative_fit_jobs gains media_kind ('image'|'video')
   │  app/creative_fit/         DEFAULT 'image' — every existing row and query is
   │                            unchanged. Separate worker pool for video.
   ▼  HTTP
markai-creative-fit             NEW app/video/ module, NEW /api/video/* routes.
      app/video/                Existing image modules and routes untouched.
```

### Why one job table, two worker pools

The queue is the part that is genuinely hard and already correct: `FOR UPDATE SKIP
LOCKED` claiming, attempt limits, stale-claim reclaim after a crashed instance, one
history list, one status contract the frontend already speaks. Duplicating it means
duplicating its bugs.

But a 15-minute video job must never occupy an image worker. So:

- `media_kind` column, `String(16)`, `NOT NULL DEFAULT 'image'`, indexed.
- Image workers claim `WHERE status='queued' AND media_kind='image'`.
- Video workers claim `WHERE status='queued' AND media_kind='video'`.
- `CREATIVE_FIT_VIDEO_WORKERS` settings knob, default 1.

Same table, same claim SQL shape, separate lanes. Image throughput is then provably
unchanged, not merely probably unchanged.

### Deployment

`markai-creative-fit` deploys as **two Cloud Run services from one image**: the
existing image service (CPU, small) and a new video service (8 vCPU / 32 GiB, 1800 s
timeout, instance-based billing, scale to zero). A heavy video job cannot slow image
fitting because it is a different service.

A per-frame LaMa fallback, when the router cannot avoid it, runs as a Cloud Run
**Job** with an L4 GPU. GPU jobs cap at 1 hour; our 15-minute budget fits inside.

---

## 4. Pipeline

Mirrors the image path's proven split — analyse once, render many.

| Stage | Runs | Produces | Cached artifact |
|---|---|---|---|
| **Probe** | once per video | dimensions, fps, rotation, colour tags, VFR | `probe.json` |
| **Segment** | once per video | shot boundaries + per-frame MAFD | `shots.json` |
| **Read** | once per video | per-shot regions, roles, overlay classification | `blueprint.json` |
| **Plate** | once per video | erased background | `plate.mov` (ProRes 422 HQ) |
| **Render** | once per **target resolution** | fitted, slot-length mp4 | `out_WxH.mp4` |

Keyed on `sha256(source_bytes)`, exactly as `pipeline.creative_id_for` does today.
The second screen shape costs only a render.

### 4.1 The fast path — the biggest cost lever

Before anything else, the same three-tier shape check the image path uses
(`rules.fit_mode`):

| Aspect shift | Tier | Cost |
|---|---|---|
| ≤ 1.08× | **stretch** | one ffmpeg invocation |
| ≤ 1.25× | **crop** | one ffmpeg invocation |
| > 1.25× | reframe or compose | full pipeline |

Below 1.25× we never decode to Python at all. Most bookings land here (1920×1080 →
1920×1080 is the common case). This mirrors image rule 1 and is the single largest
saving in the design.

```bash
# ≤1.25x tier — scale + centre crop, one shot, no Python
ffmpeg -i in.mp4 -vf \
 "scale=w=2560:h=960:force_original_aspect_ratio=increase,crop=2560:960,format=yuv420p" \
 -c:v libx264 -profile:v high -level:v 5.0 -preset slow -crf 17 \
 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
 -movflags +faststart -an out.mp4
```

### 4.2 Four tiers, not three

The image path has three tiers. Video needs a fourth, because of arithmetic:

| Condition | Tier | What happens |
|---|---|---|
| shift ≤ 1.08× | stretch | resize |
| shift ≤ 1.25× | crop | scale + centre-crop |
| larger, required regions fit, effective upscale ≤ 1.5× | **reframe** | moving crop window on an L1-optimal path |
| larger, and they do not | **compose** | rebuild the frame around the footage |

**Why `compose` must exist.** A 1920×1080 ad onto a 1080×2400 portrait panel gives a
crop window of **486×1080**, upscaled **2.22×** to fill — 25% of the original's width
blown up over twofold, on a premium panel. No parameter fixes this; it is arithmetic.

Independent corroboration: Google's own Imagen outpainting documentation warns that
expanding beyond **200%** produces distorted details. Landscape → portrait is a
**3.9× area** expansion, nearly double where Google says its own model degrades.

`compose` is the image path's `layout-led` strategy applied to video: treat the video
as the **STAGE** region on a canvas built for the panel, and re-typeset the rescued
copy into HEADER / COPY / FOOTER around it. The footage plays at a sane scale inside a
composition designed for the shape, instead of being gouged out of itself. Reuses
`ROLE_HEIGHT`, `fit_to_budget`, `SACRIFICE_ORDER` unchanged.

### 4.3 Reading the video

Analysis never runs at full resolution. Following AutoFlip's two cheapest decisions:

- analyse at **480 px wide**;
- sample at **5 fps**, not frame rate — ~100 analysed frames on a 20 s clip, not 600.

Crop decisions interpolate between sampled frames. All crop math happens at native
resolution.

Division of labour, mirroring the image path:

- **Gemini** reads *meaning* on shot keyframes — exact wording, role
  (headline/subhead/body/contact/legal/badge/logo), font family, colour. Same prompt
  vocabulary as `blueprint/service.py`, so `VideoBlueprint` is recognisably the same
  artifact.
- **PP-OCR** (or Video Intelligence API) supplies *precise per-frame geometry*.

Regions are weighted and flagged required/optional:

| Region | Weight | Required |
|---|---|---|
| Text | 0.90–0.95 | **yes** (ours) |
| Logo | 0.90–0.95 | **yes** (ours) |
| Face | 0.85–0.90 | **yes** |
| Human / pet / car | 0.70–0.80 | no |
| Generic object | 0.10–0.20 | no |

Weights are AutoFlip's shipped values; the text and logo rows are our additions, and
they are what makes this an *ad* reframer rather than a generic one.

### 4.4 Stable boxes from unstable detections

No off-the-shelf video text tracker is shippable — TransDETR and CoText both have **no
LICENSE file** (TransDETR's MIT badge is in its README, which is not a grant). We
build from permissive primitives (~300 lines): ByteTrack-style IoU association (MIT) +
OpenCV motion estimation (Apache-2.0).

Per shot:

1. Detect on **7 sampled frames** (evenly spaced, plus first and last).
2. **Compensate global motion** — estimate a similarity transform with RANSAC, and
   **mask out the candidate text regions before fitting**. A static lower-third
   covering 15% of the frame will otherwise win the RANSAC vote and you conclude the
   camera is locked when it is not.
3. Associate warped boxes, IoU gate **0.45**.
4. **Temporal voting** — keep a track only if present in ≥ **60%** of sampled frames.
   This is where most flicker originates.
5. Collapse each track to one geometry, and the two consumers want **opposite** error
   handling:
   - **erase mask** → temporal **union** (per-edge max), then dilate. Over-erasing is
     cheap; leaving glyph fragments is not.
   - **re-typeset box** → per-edge **10th/90th percentile**. Rejects the frame where
     the polygon blew out.
6. Densify with SAM 2 (Apache-2.0, code *and* weights) seeded on the reference frame
   and propagated through the shot. Its memory bank *is* the temporal-consistency
   mechanism, so this is coherent by construction rather than smoothed after the fact.

### 4.5 The erase router

Three **independent** tests. Conflating them is the main bug in naive implementations.

- **Test A — has the box moved?** `IoU(box_t, box_t+1) ≥ 0.98`, or max corner drift
  ≤ 1.0 px at 1080p.
- **Test B — have the pixels changed?** MAFD on the box crop, luma only, after a 2×
  downscale, using the **median** absolute difference (a few blocky macroblock
  outliers drag the mean over threshold).
- **Test C — is the background recoverable?** The *surround* must move:
  `MAFD_ring ≥ 0.02` sustained.

**Threshold correction that matters:** ffmpeg's `freezedetect` defaults to −60 dB
(0.001 ≈ 0.26 grey levels). That is wrong for a compressed source — a genuinely static
overlay in a re-encoded ad sits at **0.002–0.01**, because quantisation resets at each
GOP and deblocking strength varies with neighbouring QP. Use a **relative** test
instead of any constant:

```
static  iff  MAFD_box ≤ 0.25 × MAFD_surrounding_ring
```

This self-calibrates to the clip's own bitrate and noise floor.

Then route, cheapest-exact-first:

| Case | Method | Flicker |
|---|---|---|
| A+B pass, background static | LaMa on **one** frame → paste that patch to every frame | **none, by construction** |
| Overlay semi-transparent | estimate (α, W), invert `I = (J − αW)/(1 − α)` | **none** — exact recovery |
| A+B pass, background moves (C passes) | register neighbours, temporal-**median** the warped stack | **none** — real pixels recovered |
| no temporal support | per-frame LaMa + flow-warped blend | residual, mitigated |

The first three recover pixels that genuinely exist elsewhere in the file. Only the
fourth is an estimate.

**Expect roughly 50–70% of overlay frames to satisfy A+B.** Routing is per shot, per
track — never one global decision for the video.

**Alpha inversion is far easier for us than the CVPR-2017 general case.** There, the
watermark's position, scale and blend factor vary across a heterogeneous collection.
Here α and W are constant and already pixel-registered, so it collapses to **per-pixel
linear regression**: across frames, `J_k = αW + (1−α)I_k` is a straight line in `I_k`
with slope `(1−α)`. Ad overlays almost always fade in and out, which hands us clean
`I_k` frames for free.

Guards: require `std(I_k) ≥ 20/255` before trusting a per-pixel fit; clamp α ≤ 0.95;
**do not invert above α ≈ 0.7** — inversion amplifies codec noise by `1/(1−α)`, and
the paper's own finding is that a 2-intensity-level error is already visible, so above
0.7 a LaMa fill is cleaner. Fit in linear light, on 4:4:4-upsampled planes.

### 4.6 Rules carried over from the image path

1. **Never pass the whole frame through a model.** IOPaint's own strategy above 800 px
   is not to downscale — it crops around the mask with a **128 px margin** and runs
   LaMa at 1:1. The patch composites back onto the untouched native-resolution frame.
   This is `plate.service.build`'s existing behaviour extended in time: 99% of every
   frame stays bit-identical.
2. **Never let a generative model repaint a brand asset.** The logo is cut, not
   redrawn. The product is untouched.

### 4.7 One rule that exists only for video

**Freeze the mask per shot segment.** A mask whose boundary quantises differently each
frame makes the seam crawl visibly — the inpainter sees a different problem each frame
and gives a different answer even for identical pixels. Union the detections, dilate
once, reuse across the segment. Cheapest flicker mitigation available, and it costs
nothing.

Dilation: base **5 px** (IOPaint's shipped 11×11 elliptical kernel, 1 iteration),
scaled as `max(4, 0.06 × cap_height)`, **+2 px** for chroma bleed on 4:2:0 sources,
plus `shadow_offset + 2×shadow_blur` **asymmetrically on the shadow side** — an
un-erased drop shadow is the most common cause of a leftover ghost. The mask fed to
LaMa stays hard; the composite back is feathered ~4 px.

### 4.8 Camera path

**L1, not L2.** Minimising the first, second and third derivatives in L1 (Grundmann et
al., CVPR 2011; weights `w₁=10, w₂=1, w₃=100`) yields a path composed of *exactly*
static, *exactly* linear and parabolic segments. An L2 fit leaves residual micro-drift.
On a physical panel a drifting crop reads as a broken player, so "truly static or
deliberately moving, never floating" is precisely the property we want.

AutoFlip itself uses L2 — this is the one place we deliberately improve on it. Prefer
static aggressively: most 15-second ad shots should resolve to a completely fixed crop.

---

## 5. Rendering

### 5.1 Process boundary

```
ffmpeg subprocess ──rawvideo rgb24──▶ Python/numpy ──rawvideo──▶ ffmpeg subprocess
  decode, colour pinned                erase router               x264, colour pinned
  -fps_mode cfr (VFR→CFR)              numpy sub-pixel crop       + faststart
  -autorotate (default on)             text layer composited      -an
```

**Not PyAV.** The subprocess boundary gives explicit colour control, free
auto-rotation, free VFR→CFR flattening, and keeps GPL'd libx264 out of our process
address space.

**On the GPL question:** GPLv2 obligations fire on *distribution*. A hosted service is
not distribution — there is no network-copyleft clause in GPLv2/v3 (that is AGPL, and
x264 is not AGPL). Our container is never handed to a customer. An LGPL-only build
using `h264_nvenc` on the L4 is available as an even cleaner fallback, behind one
config switch.

**The crop happens in numpy, not in ffmpeg.** ffmpeg's `crop` filter evaluates `w`/`h`
**once** at configuration; only `x`/`y` are per-frame, and they are **integers**, so a
slow pan judders. A numpy sub-pixel `warpAffine` (~3–8 ms/frame at 1080p) gives smooth
motion and real easing curves. We are already decoding to numpy for the erase work, so
the crop is nearly free.

### 5.2 Colour — four silent failures

None of these throw. They produce output that is *slightly* wrong, which survives code
review and ships.

1. **Colour tags convert nothing.** `-colorspace bt709` only labels; it does not
   change pixels. You need the `scale` filter **and** the tags.
2. **Round-tripping through unspecified colour fields** makes swscale fall back to
   BT.601 limited — the "video just looks a bit flat" bug.
3. **`overlay` defaults to `format=yuv420`** — a text layer composited through it gets
   chroma-halved *before* the encoder halves it again. Compositing in numpy makes this
   impossible.
4. **Debian's ffmpeg is 5.1**, which predates `drawtext`'s HarfBuzz requirement.
   Devanagari and Kannada render as disconnected code points, silently.

Mitigations: pin a static ffmpeg ≥ 7.x; assert at startup
(`ffmpeg -buildconf | grep -q -- --enable-libharfbuzz || exit 1`); probe every input
rather than assuming; and add a golden-frame colour regression check before writing any
of the interesting code.

Decode and encode, colour pinned both ways:

```bash
# decode
ffmpeg -nostdin -v error -i in.mp4 \
  -vf "scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt709:out_range=pc,format=rgb24" \
  -fps_mode cfr -r 30 -f rawvideo -pix_fmt rgb24 -

# encode — tags written via setparams, NOT via -color_* output flags (see below)
ffmpeg -nostdin -v error -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - \
  -vf "scale=in_range=pc:in_color_matrix=bt709:out_range=tv:out_color_matrix=bt709,format=yuv420p,\
setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv" \
  -c:v libx264 -profile:v high -level:v 4.0 -preset slow -crf 17 \
  -x264-params "keyint=60:min-keyint=60:scenecut=0:bframes=2:ref=3:b-pyramid=none" \
  -movflags +faststart -an out.mp4
```

**Measured on ffmpeg 8.1.2, not assumed.** Writing the tags with `-color_primaries
bt709 -color_trc bt709 -colorspace bt709` output flags leaves the VUI incomplete:

```
color_range=tv  color_space=bt709  color_transfer=unknown  color_primaries=unknown
```

Only `setparams` (or `-x264-params colorprim=…:transfer=…:colormatrix=…`) produces all
four. Use `setparams` everywhere the pipeline writes an MP4.

Four encode recipes measured against the same source, patch-median max Δ (0–255):

| Recipe | Δ | Verdict |
|---|---|---|
| `scale=…out_color_matrix=bt709` + `setparams` | **1** | correct **and** correctly tagged |
| no `-vf`, no tags | **1** | round-trips, but **untagged** → wrong on the panel |
| `setparams` only, matrix not forced | **30** | the BT.601-encoded-tagged-709 bug |
| `colorspace=all=bt709:iall=bt709:irange=pc:range=tv` | **40** | wrong filter for the RGB→YUV leg |

Two consequences. **Tagging without forcing the matrix is the silent bug** — swscale
encodes with its default 601 matrix while the tag tells the decoder to invert with 709;
cyan drifts `(0,190,190) → (0,171,192)`. And **a clean round-trip is not sufficient
evidence**: the naive recipe scores Δ=1, perfectly self-consistent, and ships an
untagged file that a BT.709 panel renders wrong. So the golden check asserts **pixels
AND tags**, independently.

### 5.3 Text rendering

Render each text block **once** with Pillow + raqm into an RGBA layer, then composite
that layer onto every frame with a numpy alpha blend (~3–5 ms/frame at 1080p). Text in
a re-typeset ad is static for the duration of its block, so per-frame *shaping* — the
expensive part — is eliminated entirely. 600 frames × 5 ms ≈ 3 s.

Reuses `app/layout/rules.py` unchanged: `ROLE_HEIGHT` sizing by canvas height,
`fit_to_budget`, `script_font` for Devanagari/Kannada/Tamil, `readable_on`.

### 5.4 Encoding for the AndBox players

The S905X4 decodes H.264 at **4K High@L5.1 30 fps** — exactly at the ceiling.

| Panel | Macroblocks/frame | Level | Note |
|---|---|---|---|
| 1920×1080 | 8,160 | **4.0** | fits |
| 2560×960 | 9,600 | **5.0** | *not* 4.2 — exceeds its 8,704 MB limit |
| 3840×2160@30 | 32,400 | **5.1** | at the ceiling, no headroom |
| 3840×2160@60 | 32,400 | 5.2 | **will not decode — never emit** |

`-crf 17`, `keyint=60 min-keyint=60 scenecut=0` (hard 2 s GOP → clean loop restarts,
predictable seek), `bframes=2 ref=3 b-pyramid=none` (weak SoC decoders trip on
B-pyramid first), `-pix_fmt yuv420p` (mandatory), `-movflags +faststart`, `-an`.
Dimensions forced even via `force_divisible_by=2`.

**x264 `slow` on CPU, not NVENC — confirmed by NVIDIA's own published data.** Their
chart puts **L4 NVENC H.264 p4 at −5.2% bitrate savings vs x264 `medium`**: it needs
~5% *more* bitrate for equal PSNR, and it is the only negative number on that chart.
Their own methodology doc maps p4 ↔ `medium`, and there is no NVIDIA claim of parity
with `slow` anywhere — so the gap to our chosen preset is worse than 5.2%.

Independent VMAF testing found hardware encoders *win* on fast-motion simple content and
*lose* on static, detail-dense, text-heavy content. A DOOH ad is squarely the losing
case. NVIDIA's own marketing image shows NVENC H.264 blocking and smearing on billboard
lettering at 1080p60.

Since the encode is only ~5% of the budget, buying speed there would trade the thing we
care about for time we do not need. **NVENC/NVDEC for decode and CMS previews; x264
`slow` for the master.**

### 5.5 Quality parity with images is impossible — state it plainly

The image path uses `JPEG_SUBSAMPLING=0` (4:4:4) deliberately, because 4:2:0 smears
coloured type. **There is no video equivalent**: H.264 4:4:4 is High 4:4:4 Predictive,
which the S905X4 cannot decode.

The mechanism: 4:2:0 keeps 25% of the chroma samples. Luma-contrasting text (white on
dark) is carried by the full-resolution luma plane and survives. **Chroma-only edges**
(saturated red on blue at matched luma) are reconstructed from ¼-density chroma — a
1 px stroke bleeds ~2 px and its contrast collapses.

Three mitigations, all cheap and all decided here rather than discovered later:

1. **Extend `readable_on` to require a minimum luma (Y′) delta**, not just perceptual
   colour difference. Highest value per line of code, and a small edit to an existing
   rule.
2. **Raise `ROLE_HEIGHT` / `ROLE_FLOOR` for the video path** so minimum stroke width
   lands ≥ 3 px.
3. **Add a luma-contrasting `stroke_width` outline**, putting the edge back into the
   full-resolution luma plane.

Do **not** compensate by encoding a 1080p panel's content at 4K — that forces the SoC
to decode 4K H.264 at its exact ceiling for a gain the panel's scaler discards.

### 5.6 The legibility floor — when text gets rescued

This is the number that decides whether a text block is "too small to read on that
panel" and therefore must be erased and re-typeset.

The OOH standard is **1 inch of cap height per 10 feet of viewing distance** =
**8.33 mm of cap height per metre** (ratio 1:120, or 28.6 arcminutes). It is ~1.4×
stricter than ISO 9241-303's display recommendation, which is correct: a glance at a
moving ad by an unmotivated viewer is a harder task than reading a document.

```
panel_h_mm       = diagonal_in * 25.4 * 0.49029          # 16:9
min_cap_mm       = 8.33 * viewing_distance_m
min_cap_frac     = clamp(min_cap_mm / panel_h_mm, 0.030, 0.075)
min_cap_px       = min_cap_frac * output_height_px
min_font_size_px = min_cap_px / CAP_RATIO                # CAP_RATIO = 0.72, existing
```

Defaults: **viewing distance 3.5 m** (café band is 2–5 m; ISO puts "presentation
tasks" at 2–10 m), giving **min cap height ≈ 4.5% of panel height** ≈ 49 px on a
1080-tall output. Hard reject below **15 px** cap height at any panel size — that is
Vistar's published floor (15 px on their 400 px-tall billboard creatives = 3.75%,
which lands inside our computed band and corroborates it).

**The existing typography already satisfies this.** `ROLE_HEIGHT[HEADLINE] = 0.055`
sits above the 4.5% comfortable-reading target, and `ROLE_FLOOR[HEADLINE] = 0.032`
lands at the 3.0% absolute minimum. `rules.py:239` already converts cap height to em
size via `CAP_RATIO = 0.72` — the classic 30% under-sizing bug (every legibility
standard specifies *cap* height; every font API takes *em* size) is already avoided.

Copy limits, for the `compose` tier and for reporting: **≤ 8 words** on any held
frame, **≤ 3 lines**, **≤ 5 words per line**, **≤ 20 words** per spot. Contrast floor
4.5:1, target 7:1 — and per §5.5 the video path additionally requires a minimum
**luma** delta, not just colour contrast.

### 5.7 Duration

**The industry rule is exact match, not tolerance.** Networks enumerate discrete slot
lengths (8, 10, 15, 30 s), never ranges. JCDecaux Lithuania: *"We only broadcast
10-second digital spots."* A creative that does not match its slot "can throw off the
loop or be rejected." Indian DOOH is **10 s spots in a 60–90 s loop**, not 15 s.

So `duration.tolerance_seconds = 0.0` — the output equals the slot exactly.

**Longer than slot** → trim at the nearest **shot boundary** ≤ target, choosing the
retained window by subject salience *and* text-hold coverage. Never a blind head-trim:
the end-card logo is usually the last thing on screen. Never speed-ramp — no standards
body or vendor documents retiming to fit.

**Shorter than slot** → **extend a designed end-frame**, not an accidental freeze.
Xibo's documented behaviour is that a short video "plays once and freezes on the last
frame" — a failure mode, and ugly on a café wall. We instead extend the final
composition (logo + CTA, re-typeset) to fill the remainder, turning that failure into a
deliberate card.

**Looping** is not required and mostly not wanted: in a booked loop each spot plays once
with other ads in between, so there is no loop point to hide. A 250 ms fade at each end
is the safer general answer. Only when frame 0 and frame N−1 are perceptually
near-identical — i.e. the clip was authored to loop — do we loop it seamlessly.

Every distinct text state holds **≥ 2 s**, per the 3–5 s glance window.

---

## 6. Licensing

Every component is Apache-2.0, MIT, BSD or LGPL. Nothing AGPL, nothing
non-commercial, nothing unlicensed.

**Blocked, and why it matters that we checked:**

| Component | Licence | Note |
|---|---|---|
| ProPainter | S-Lab 1.0 | "non-commercial purpose" |
| E2FGVI | CC BY-NC 4.0 | |
| VideoPainter | Tencent custom | "refrain from... any commercial or production purposes" |
| DiffuEraser | Apache shell | ProPainter core |
| Deep Video Prior | **none** | no LICENSE file = all rights reserved |
| TransDETR / CoText | **none** | MIT badge in README is not a grant |
| Ultralytics YOLO | **AGPL-3.0** | their licence explicitly covers *models produced by* the training code; §13 fires on network use |
| InsightFace weights | non-commercial | code is MIT, weights are not |
| ffmpeg `delogo`, `boxblur` | GPL v2+ | needs `--enable-gpl`; `removelogo` is LGPL and better anyway |

**Hosted removal APIs are disqualified on three independent counts:** every one caps
at ≤ 720p (against the never-downscale rule); Bria's video eraser has a hard **5-second
input cap**; fal runs on AWS so the GCP credits cannot pay for it; and fal's terms
never grant output IP and expressly disclaim non-infringement — poor paper for an asset
billed to an advertiser.

### The two MIT video inpainters: investigated and rejected

STTN and FGT were the only shippable learned video inpainters, and this design
originally budgeted a 2–3 day spike to benchmark them against the router's hardest
branch. **That spike is cancelled** — the evidence settles it without spending the time.

**FGT fails our literal spec.** It crashes past **~200 frames** (issue #41,
`ValueError: need at least one array to stack`, on an 8-second clip) — our clips are
450–600 frames, so its practical wall is roughly half our *minimum* length. It also
cannot run on an L4: `torch 1.10.1` tops out at sm_86, the L4 is sm_89, and issue #47
has sat open with `CUDA error: no kernel image is available` since Aug 2024. Long clips
silently lose head and tail frames (#42, zero replies). FGT++ was never released and
will not be (#33, open since Apr 2023). Its README cannot install itself —
`python=3.6.8` cannot satisfy its own `numpy==1.22.2`.

**STTN fails both ways, which is the more interesting result.** Run it at native 1080p
and quality degrades, because it was never trained above ~432×256 — someone got exactly
that working on a 24 GB A10-G and reported *"The results aren't great though."* Run it
in its trained band and composite back, and the default path is **640×120**, so on a 4K
frame every repaired pixel is upscaled **6× linearly**. There is no third option: it
cannot be fine-tuned to our data either, because the published checkpoint ships `netG`
only — no discriminator, no optimizer state — and nobody has reproduced the paper
numbers from scratch.

Both routes collide with the same rule that governs the image path: repairs composite
back onto native-resolution pixels. **Per-frame LaMa on a mask-cropped region is the
resolution-correct architecture**, and this is the evidence for it.

Two notes kept for the record. **ISVI** (MIT, same author as FGT) is what that author
redirects high-resolution users to — *"could process videos with larger resolution (up
to 4K)"* — but it is less maintained than FGT (last touched Jan 2023). Worth **30
minutes of triage**, not a spike. And if STTN is ever revisited, do not clone
`researchmm/STTN`: lift the inpaint modules from `video-subtitle-remover` (Apache-2.0,
compatible with STTN's MIT), which already has VRAM-adaptive chunking, streaming frame
I/O and native-frame alpha compositing written and proven.

---

## 7. What runs on GCP credits

| Service | Use | Cost |
|---|---|---|
| Cloud Run Jobs + L4 | LaMa fallback | ~$1.42/hr all-in; $25k ≈ 17,600 hrs |
| Video Intelligence API | text/logo boxes with timestamps, object tracking | $0.15/min each, **first 1,000 min/month free** |
| Transcoder API | rendition fan-out | **$0.010** per 20 s clip at 1080p |
| Gemini video understanding | judgement calls | ~$0.0005 per 20 s ad |

**Closed questions:** Veo is temporal extension only (video is an *output-only*
modality; 9:16 and 16:9 only) — our 2560×960 panels are unreachable in principle.
There is **no spatial video editing on GCP at any price**. Transcoder's `pad` is
**black bars only**, so ffmpeg stays for any blurred or plate-based fill.

**Two risks logged:** Video Intelligence has had **no release notes since November
2021** — frozen, so we build behind an interface. Gemini bounding-box detection is
Pre-GA and therefore not covered by Google's indemnity; keep it off the critical path.

---

## 8. Storage

| Artifact | Size (20 s, 1080p) | Retention |
|---|---|---|
| `probe.json`, `shots.json`, `blueprint.json` | < 100 KB | forever |
| `plate.mov` (ProRes 422 HQ) | ~460 MB | 30-day TTL |
| `text_*.png` | 1–5 MB | 30-day TTL |
| `out_WxH.mp4` | 20–60 MB | per media-library policy |

ProRes 422 HQ because it is visually lossless for one generation and **ffmpeg's ProRes
encoder is native and LGPL**, so the mezzanine path carries no GPL at all. 1,000 cached
plates ≈ **$6/month**. The JSON artifacts are kilobytes and are what a re-render
actually needs, so they are kept indefinitely.

---

## 9. Error handling and the operator contract

Every job reports what it did, in plain language: *"followed the product, re-typeset
the phone number, trimmed at 14.7 s."*

**Hard gates** (not a quality score — automatic retargeting metrics were shown to have
near-zero correlation with human preference, so scoring is a dead end):

- every detected text box fully inside the window, for every frame it is visible;
- logo fully inside;
- no partial faces;
- safe areas: tracked subjects inside the **5%** action-safe box, and all re-typeset
  text inside the **10%** title-safe box. The 10% figure is the DOOH consensus, not
  merely broadcast convention — SMPTE ST 2046-1 defines safe title as "80% of the width
  and 80% of the height", DPAA-aligned guidance says "10% margin from edges", and DOOH
  spec aggregators say "keep all text in center 80% of frame". It is stricter than
  EBU R95's 3.5%/5%, and the stricter number wins;
- effective upscale ≤ 1.5×;
- bounded crop travel per shot.

Any failure routes to `compose`, or to the letterbox fallback, and flags the job. The
CMS always offers one-click fallback to the safe letterbox version — the same escape
hatch the image path has today.

Failure modes and their handling:

| Failure | Handling |
|---|---|
| Gemini unavailable | fall back to geometry-only reframe; report reduced confidence |
| Erase produces visible flicker | measured, reported; operator can choose letterbox |
| Source is VFR / rotated / HDR | normalised at probe; HDR tone-mapped to BT.709 |
| Source shorter/longer than slot | held or trimmed at a shot boundary, and reported |
| Worker dies mid-job | existing stale-claim reclaim returns it to the queue, bounded by `attempts` |

---

## 10. Verification

No pytest in this repo. Verification is by running the CLI on a real asset and looking
at the output, mirroring `python cli.py fit <banner.jpg> ... --sheet`. `cli.py fit`
sniffs the input and dispatches, so muscle memory carries over:

```bash
python cli.py fit ad.mp4 1080x2400 1920x1080 --sheet --compare --overlay --report --check
```

| Flag | Writes | What you look at |
|---|---|---|
| `--sheet` | `sheet.png` | the default — filmstrip of source + one row per variant, **same time positions**, so a column compares one moment across every resolution. Safe-area guides and text bboxes drawn on |
| `--compare` | `compare_WxH.mp4` | original ∥ fitted, in motion |
| `--overlay` | `overlay_WxH.mp4` | crop-window path drawn over the original — shows the *decision*, and exposes a jittering crop window, which no still frame ever will |
| `--report` | `decisions.md` + `.json` | per-shot decision table; the JSON is diffable, turning "did my refactor change any decision?" into a `git diff` |
| `--check` | stdout PASS/FAIL | encode assertions + golden-frame + flicker |

**Golden-frame colour check** — build this *before* the interesting code. Generate
`smptehdbars`, push it through decode → numpy → encode, decode, and assert. Measured
anchor: the 75%-white patch decodes to **191** (`0.75 × 255`), proving limited→full
expansion is correct. Sample **8×8 patch medians on a 6×4 grid, avoiding bar edges** —
per-pixel max is the wrong statistic, since a *correct* round-trip measures 20 purely
from 4:2:0 ringing at hard bar edges while patch medians measure 1. Gate: ≤2 PASS, 3–8
WARN, ≥9 FAIL.

**Encode assertions**, one `ffprobe` call. Note `level` returns an **integer**
(`40`, `50`, `51`), not `"4.0"`. And a real trap: **`-preset ultrafast` silently
overrides `-profile:v high`**, yielding Constrained Baseline — no CABAC, no B-frames,
measurably worse at the same bitrate, from a one-word change. Assert `profile == High`.
`faststart` is not an ffprobe field; check `moov` appears before `mdat` in the file.

**Flicker ratio** — the metric, defined so it is comparable across clips:

> mean frame-to-frame absolute luma difference **inside the erased region** ÷ the same
> quantity in a **control region of equal area that was never erased**.

The control denominator is what makes it portable: a raw difference score just tracks
how much the footage moves, so a fast pan scores high whether or not the erase is
stable. **1.0 means the erased region is as stable as untouched footage.** Gate: ≤1.5×
PASS, 1.5–2.0× WARN, >2.0× FAIL — calibrated against the locked-off test clip, which
gives the noise floor.

The same machinery checks the **loop seam**: difference between last and first frame
versus the median inter-frame difference. A spike means a visible jump every loop,
forever, on a screen playing this all day.

**Test corpus — none of it exists yet; nothing in this repo is a video.** Build it
synthetically first (`testsrc2`/`gradients` + Pillow for type and scrims + `concat` for
cuts), because synthetic clips give **exact ground truth of what was erased**, making
the flicker denominator and the text-containment check exact rather than judged. Add
2–3 real client ads for the final eyeball.

| Clip | Branch it exercises |
|---|---|
| Static overlay on moving footage | the primary flicker test — sets the budget |
| Static overlay on a locked-off shot | the noise floor; should be ≈1.0. If this flickers, the inpainter is broken, not the footage |
| Semi-transparent scrim | alpha inversion; the "faint rectangle survives" failure |
| Animated kinetic type | forces a per-frame mask; the only branch that would justify optical flow |
| Multi-shot ad with cuts | shot segmentation and per-shot routing; mask must not bleed across a cut |
| Corner logo, whole duration | rule 6 — must survive verbatim at every target |
| Near-same-aspect (1920×1080 → 2560×1440) | must report `stretch`/`crop`, **not** `relayout` |
| Non-Latin kinetic type | raqm conjunct shaping, in motion |
| 4K 30fps dark gradient | level 5.1, banding, and the `ultrafast` trap |

**Record the measured flicker ratios in `CLAUDE.md` before shipping** — that measurement
is the evidence for reversing the "images only, no video path" decision, exactly as the
32%-coverage real-estate ad is the recorded evidence for the photo-led/layout-led split.

### What this machine has, and what it does not

| | Status |
|---|---|
| Present | ffmpeg **8.1.2** (gpl, x264, x265, vmaf, videotoolbox), ffprobe, **Pillow 11.3 with raqm** (harfbuzz 11.2.1 — Indic shaping intact), numpy 2.5.1, torch 2.13 (MPS), onnxruntime 1.28, and the `psnr`/`ssim`/`libvmaf`/`signalstats`/`tblend`/`scdet`/`freezedetect`/`tile`/`drawbox` filters |
| **Absent** | **`drawtext`, `subtitles`, `ass`** (no harfbuzz/libass in this build) → every label, guide and box is drawn in **Pillow**, not ffmpeg. **`zscale`** (no libzimg) → all colour work goes through `scale`'s options, not the zscale route most guides recommend |
| **Absent, and a decision** | **opencv is installed in no Python on this machine**, so `DISOpticalFlow` is unavailable. `pyproject.toml` deliberately avoids the packages that drag it in. The verification tooling above needs it for *nothing*; add it only if the production router needs flow-based mask propagation, and pin it in its own Poetry group so `--check` never depends on it |

---

## 11. CMS surface

**The toggle is a route, not a state flag.** A `useState` mode switch inside
`creative-fit/page.tsx` would force the image workbench into branches — exactly the
refactor that is forbidden. Instead:

```
src/app/(dashboard)/creative-fit/
  layout.tsx          NEW       — PageHeader + FitModeToggle + {children}
  page.tsx            MODIFIED  — delete only the 4-line <PageHeader> block
  video/page.tsx      NEW       — the video workbench
```

`page.tsx` loses four lines and one import. Every hook, effect, handler, guard and JSX
node below that is byte-identical. The video workbench never mounts for image users, so
its players and pollers cost nothing, and Next code-splits it for free. `Sidebar`
already matches with `pathname.startsWith`, so the nav item stays lit with no change.

### Two blockers found by reading the code, not assumed

1. **`JobHistory.tsx:103` renders `<img src={job.result_url}>`.** Hand it an `.mp4` and
   the operator sees a broken thumbnail. Therefore `GET /cms/creative-fit/jobs` gains
   `?kind=`, **defaulting to `image`**. The image page calls `api.creativeFit.jobs()`
   with no arguments, so it keeps receiving exactly what it receives today and can never
   be handed a video job. Without that default, the first video job breaks the image
   page's history strip.

2. **`api.creativeFit.upload()` is `requestMultipart` — it proxies bytes through the
   API.** Your own comment at `api.ts:513` states the consequence: *"Cloud Run rejects
   request bodies over 32 MiB, so a proxied upload can never carry a full-size video."*
   Video source upload therefore **cannot** reuse this path; it needs the
   `upload-session → PUT → commit` flow that `api.uploadMedia` already uses. This is the
   largest piece of frontend plumbing in the work and has no image-mode equivalent.

### Progress for a 15-minute job

The existing `RunningState` is a spinner plus "This usually takes 20–60 seconds" —
honest at 60 s, and it reads as "hung" at 900 s. Video gets a **five-step stepper**
where each completed stage keeps its own duration and its one-line finding, so the card
becomes a growing receipt rather than a spinner that has been turning for nine minutes:

```
✓ Probe      1080×1920 · 30fps · 28.4s · h264        0:03
✓ Segment    11 shots found                          0:19
◉ Read       Shot 4 of 11 — reading burned-in copy   1:42  ⟳
○ Plate      —
○ Render     3 targets
  ▓▓▓▓▓▓▓▓░░░░░░░░  42%     3:47 elapsed · about 4 min left
```

`percent` and `eta_seconds` are **server-computed and monotonic** — a bar that goes
backwards is worse than no bar, and a browser-side ETA would drift from the server's.
Poll cadence backs off (2 s → 5 s → 10 s) and skips while the tab is hidden: ~110 polls
for a full job instead of 450.

### Reused vs duplicated

Reused unchanged: every `components/ui/*`, `PageHeader`, `useToast`, and all of
`lib/creative-fit.ts`'s geometry (`previewBox`, `ratioLabel`, `formatElapsed`,
`analyzeFit`, `RESOLUTION_PRESETS`) — geometry is resolution-only and does not care that
the pixels move. Also `lib/media.ts`'s `probeMediaFile`, which already returns
`{kind:"video", width, height, durationSeconds}`.

Duplicated deliberately: `JobHistory`, `ResultPreview`, `VerdictCard`, `ScanCard`,
`TargetPicker`, `SaveToContentModal`, `ResizeControls`. Each genuinely diverges in
content, not just in type — video needs n targets, four outcomes, shot timelines,
durations and trim copy. The alternative is adding `kind` props and conditional copy to
seven shared files, which is the "refactor to be generic" outcome that was ruled out.
The duplication is the price of the constraint, and it is paid knowingly.

### New API surface, all additive and nullable

`JobResponse` gains `media_kind` (default `'image'`), `progress`, `video`, `variants[]`.
An image job's JSON is byte-identical to today's. New types: `VideoProbePayload`,
`ShotDecision`, `VideoVariant`, `JobProgress`. The four outcomes — `stretch`, `crop`,
`reframe`, `compose` — are reported per target, each with its own confidence, because a
9:16 `compose` can be far less certain than the 16:9 `crop` rendered from the same
analysis.

**The letterbox safe version is rendered eagerly beside every variant**, not on demand.
It is one cheap ffmpeg `scale+pad` pass with no model calls, and having it already on
disk is what makes the fallback genuinely one click rather than "one click and another
wait".

**Retention caveat:** `cleanup_expired_fits` must sweep the whole variant set and every
per-shot poster, not just `result_url` — otherwise the sweep quietly stops reclaiming
most of what video mode writes.

---

## 12. Target shapes to support

From the IAB/DPAA primer and Vistar's venue tables — note the third row, which is easy
to forget:

`16:9` (1920×1080, 3840×2160) · `9:16` (1080×1920, 2160×3840) · **`4:3` (1280×960) —
casual dining and bars run these** · `16:10` (1920×1200) · `32:9` (3840×1080) · banner
strips (1400×400, 840×400, 1600×400).

Frame rate: preserve source, cap 30, force CFR. India and Europe default to **25 fps**
(PAL heritage); JCDecaux specifies max 25.

The IAB/DPAA primer is explicit that this service is solving a real, named problem:

> "Because of the visibility of the pixels on direct view LEDs, content should ideally
> be the **exact resolution of the display**… rather than another 16:9 aspect ratio
> resolution."

And JCDecaux Sweden states the need even more plainly: *"Remember not to use existing
print ads or television commercials. They must be adapted or redesigned."*

**Where this sits against the market:** Vistar's own answer to this problem is a help
article titled *"Creative transcoding, resizing, and letterboxing."* DOOH SSPs
letterbox. Adobe's Auto Reframe crops and **has no concept of text** — burnt-in titles
get sliced. Nobody in DOOH re-typesets. That is the gap this service fills, and it also
means there is no prior art to copy for the text step. Celtra's Auto-Layout plus its
Automated Text Treatment (orphan / widow / keep-together rules across 30+ languages) is
the closest existing model and is worth studying directly.

---

## 13. Open items

1. **Two numbers the internet does not contain.** Measure **LaMa CPU inference time**
   and **OpenCV DIS at true 1080p** on the real Cloud Run shape before fixing the worker
   count. No published benchmark exists for either (§2).
2. **The 4K lane.** A 4K clip lands at ~10–19 min against a 15-min budget. Decide
   between a longer dedicated lane, processing at reduced scale with the composite back
   at native resolution, or refusing 4K sources at upload with a clear message.
3. **The one experiment that actually matters.** Not "which inpainter" — that is settled
   (§6) — but **"does our per-frame LaMa output visibly flicker at all?"** Run the
   temporal-median-background test *first*, since for the dominant case (static overlay
   over moving footage) it may delete the problem entirely and make the question moot.
   Measure with the flicker ratio in §10 and record the numbers in `CLAUDE.md`.
3. **opencv as a dependency.** The erase router's flow-based branch (kinetic type) wants
   `DISOpticalFlow`, but opencv is installed in no Python on this machine and
   `pyproject.toml` is built to avoid the packages that pull it in. Decide whether that
   branch justifies the dependency; if yes, it goes in its own Poetry group.
4. **Single-target first?** The design renders n targets off one analysis, which is what
   makes video economically sane. If we would rather ship single-target first, the
   response shape already supports it — `variants` stays a one-element list and nothing
   is wasted.
5. **ffmpeg build for production.** The local build lacks harfbuzz, libass and libzimg.
   The container must pin a static ffmpeg ≥7.x and assert its buildconf at startup, so a
   silent Indic-shaping failure can never ship.
