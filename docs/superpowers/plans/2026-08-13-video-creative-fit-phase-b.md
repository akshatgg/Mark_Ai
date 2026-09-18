# Video Creative Fit — Phase B (analysis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read a video ad and produce a `VideoBlueprint` — where the shots are, what text and brand marks are in them, whether each overlay is static, and whether the background behind it is recoverable — without rendering anything.

**Architecture:** Analysis only. Nothing here erases, reframes or re-encodes. The stage produces a JSON artifact cached beside the probe, exactly as the image path's `blueprint.json` is. Division of labour mirrors the image path: **Gemini reads meaning** (the exact wording, the role, the font, the colour) on a handful of shot keyframes; **cheap deterministic machinery reads geometry and motion** (ffmpeg `scdet` for cuts, `signalstats` for per-region change). Analysis runs on a 480px-wide proxy at ~5fps, never on full frames.

**Tech Stack:** Python 3.12, Poetry, ffmpeg/ffprobe subprocess, Pillow, numpy, google-genai. **No new dependencies.**

## Global Constraints

- **The image path does not change.** Nothing under `app/blueprint/`, `app/plate/`, `app/layout/`, `app/pipeline.py`, `app/api/` may be edited. Read them for patterns only.
- **Phase A modules are closed.** `app/video/ffmpeg.py`, `schemas.py` (additive only), `probe.py`, `encode.py`, `render.py`, `pipeline.py`, `check.py` are reviewed and closed. Extend by adding; do not rewrite.
- **No new dependency.** `scdet`, `metadata`, `signalstats`, `freezedetect` are confirmed present in the local ffmpeg. **opencv is deliberately NOT added in this phase** — see Task 4.
- **No pytest.** `python cli.py check` is the test suite and must stay at 9/9 PASS throughout. New analysis checks are added to it in Task 6.
- **ruff is the gate.** `poetry run ruff check app/video cli.py` clean before every task ends. Line length 100, py312.
- **Analysis proxy is 480px wide at 5fps** (AutoFlip's shipped values). Geometry is stored normalised 0–1000, like the image path's `box_2d`, so it is resolution-independent.
- **Nothing is committed.** Same as Phase A — the user works uncommitted. Implementers must not run any git write command.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/video/shots.py` | NEW — `scdet` shot boundaries + per-frame MAFD, in one decode pass |
| `app/video/blueprint.py` | NEW — multi-frame sampling, the Gemini calls, `VideoBlueprint` assembly |
| `app/video/tracking.py` | NEW — associate per-frame detections into one stable region per shot |

**Task order note:** Task 4 (`tracking.py`) is pure, dependency-free geometry and is
implemented BEFORE Task 3 consumes it. Task 3's assembly then feeds real multi-frame
observations through it, so nothing in this phase is built unused.
| `app/video/motion.py` | NEW — the three static tests (A: box moved, B: pixels changed, C: background recoverable) |
| `app/video/schemas.py` | MODIFIED, additive only — `Shot`, `TextRegion`, `VideoBlueprint`, `RegionMotion` |
| `app/video/pipeline.py` | MODIFIED — an `analyse()` stage between `ingest()` and rendering, cached as `blueprint.json` |
| `app/video/check.py` | MODIFIED — analysis checks appended to `run_all()` |
| `cli.py` | MODIFIED — `--report` flag and an `analyse` subcommand |

---

### Task 1: Shot boundaries and per-frame MAFD

One decode pass yields both. `scdet` emits `lavfi.scd.mafd` for every frame and `lavfi.scd.time` at each detected cut, so shot segmentation and the change signal that Task 5 needs come from the same invocation — free, and LGPL.

**Files:**
- Create: `app/video/shots.py`
- Modify: `app/video/schemas.py` (append `Shot`)

**Interfaces:**
- Consumes: `ffmpeg.run` (Phase A)
- Produces: `schemas.Shot`, `shots.detect(path: Path, duration: float, fps: float, threshold: float | None = None) -> list[Shot]`, `shots.frame_mafd(path: Path) -> list[float]`

- [ ] **Step 1: Write the failing check**

Create `app/video/shots.py`:

```python
"""Shot boundaries and the per-frame change signal, from ONE decode pass.

ffmpeg's `scdet` filter sets `lavfi.scd.mafd` on every frame and
`lavfi.scd.time` on the frames it calls a cut. Reading both out of a single
`metadata=print` pass means shot segmentation costs the same as the change
signal that the static tests need later — one decode, not two.

scdet is LGPL (libavfilter/vf_scdet.c). PySceneDetect would also work and is
BSD-3, but it is a new dependency for something already in the binary we ship.

MAFD is "mean average absolute difference", normalised 0-1 by bit depth. It is
the same statistic `freezedetect` thresholds on, which is why the static tests
in motion.py can reuse it rather than inventing a metric.
"""

from __future__ import annotations
```

Append to `app/video/schemas.py`:

```python
class Shot(BaseModel):
    """One continuous camera take.

    Every temporal assumption in the analysis is per-shot: a mask must never
    bleed across a cut, and "has this overlay moved?" is only meaningful
    within one take.
    """

    index: int
    start_seconds: float
    end_seconds: float
    start_frame: int
    end_frame: int

    @property
    def duration_seconds(self) -> float:
        return self.end_seconds - self.start_seconds
```

- [ ] **Step 2: Run it to verify it fails**

Run: `poetry run python -c "from app.video import shots; print(shots.detect)"`
Expected: FAIL with `AttributeError: module 'app.video.shots' has no attribute 'detect'`

- [ ] **Step 3: Write the implementation**

Append to `app/video/shots.py`:

```python
import logging
import re
from pathlib import Path

from app.core.config import settings
from app.video import ffmpeg
from app.video.schemas import Shot

logger = logging.getLogger(__name__)

#: ffmpeg's own default. Its docs say "good values are in the [8.0, 14.0]
#: range" — lower catches soft transitions, higher only hard cuts. Ad creatives
#: are cut-heavy, so the default is a reasonable middle.
DEFAULT_SCENE_THRESHOLD = 10.0

#: A cut closer than this to the previous one is treated as the same shot.
#: Flash frames and one-frame transitions otherwise produce shots too short to
#: analyse, and a "shot" of 2 frames has no temporal evidence in it at all.
MIN_SHOT_SECONDS = 0.4

_MAFD = re.compile(r"lavfi\.scd\.mafd=([0-9.]+)")
_TIME = re.compile(r"lavfi\.scd\.time=([0-9.]+)")


def _scdet_metadata(path: Path, threshold: float) -> tuple[list[float], list[float]]:
    """Run scdet once; return (per-frame MAFD, cut times in seconds).

    Analysis runs on a downscaled copy: a cut is a global change, so detecting
    it at 480px is identical to detecting it at 4K and costs a fraction as much.
    """
    raw = ffmpeg.run(
        [
            "-i", str(path),
            "-vf", (
                f"scale={settings.VIDEO_ANALYSIS_WIDTH}:-2,"
                f"scdet=threshold={threshold},"
                "metadata=print:file=-"
            ),
            "-f", "null", "-",
        ]
    ).decode("utf-8", "replace")

    mafd = [float(m) for m in _MAFD.findall(raw)]
    cuts = [float(t) for t in _TIME.findall(raw)]
    return mafd, cuts


def frame_mafd(path: Path, threshold: float | None = None) -> list[float]:
    """Per-frame mean-absolute-difference, 0-1. Index i is frame i."""
    mafd, _ = _scdet_metadata(path, threshold or DEFAULT_SCENE_THRESHOLD)
    return mafd


def detect(
    path: Path, duration: float, fps: float, threshold: float | None = None
) -> list[Shot]:
    """Segment ``path`` into shots.

    A video with no detected cut is ONE shot spanning the whole clip — that is
    the common case for a 15-second ad, and it must not come back empty.
    """
    _, cuts = _scdet_metadata(path, threshold or DEFAULT_SCENE_THRESHOLD)

    # Merge cuts that land too close together, and drop any at t=0 (the first
    # frame is a boundary by definition, not a cut).
    boundaries: list[float] = [0.0]
    for cut in sorted(cuts):
        if cut <= 0.0 or cut >= duration:
            continue
        if cut - boundaries[-1] < MIN_SHOT_SECONDS:
            continue
        boundaries.append(cut)
    boundaries.append(duration)

    shots: list[Shot] = []
    for index, (start, end) in enumerate(zip(boundaries, boundaries[1:], strict=True)):
        shots.append(
            Shot(
                index=index,
                start_seconds=round(start, 3),
                end_seconds=round(end, 3),
                start_frame=int(round(start * fps)),
                end_frame=max(int(round(end * fps)) - 1, int(round(start * fps))),
            )
        )
    logger.info("%d shot(s): cuts at %s", len(shots), [round(c, 2) for c in boundaries[1:-1]])
    return shots
```

Append to the video block of `app/core/config.py`:

```python
    # Analysis runs on a proxy, never on full frames. 480px wide and ~5fps are
    # MediaPipe AutoFlip's shipped values: a cut, a face and a text box are all
    # just as findable at 480px, and the analysis then costs a fraction of what
    # it would at 1080p or 4K. Crop geometry is computed at native resolution
    # afterwards, so this never limits output quality.
    VIDEO_ANALYSIS_WIDTH: int = 480
    VIDEO_ANALYSIS_FPS: float = 5.0
```

- [ ] **Step 4: Run the check to verify it passes**

Build a 3-cut fixture by concatenating visually distinct sources, then segment it:

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import ffmpeg, probe, shots

parts = []
for i, src in enumerate([
    "testsrc2=size=640x360:rate=25:duration=2",
    "color=c=red:size=640x360:rate=25:duration=2",
    "smptebars=size=640x360:rate=25:duration=2",
]):
    p = f"/tmp/seg{i}.mp4"
    ffmpeg.run(["-y", "-f", "lavfi", "-i", src, "-c:v", "libx264",
                "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-an", p])
    parts.append(p)
Path("/tmp/segs.txt").write_text("".join(f"file '{p}'\n" for p in parts))
ffmpeg.run(["-y", "-f", "concat", "-safe", "0", "-i", "/tmp/segs.txt",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", "/tmp/cuts.mp4"])

p = probe.probe(Path("/tmp/cuts.mp4"))
found = shots.detect(Path("/tmp/cuts.mp4"), p.duration_seconds, p.fps)
print(f"duration {p.duration_seconds:.2f}s fps {p.fps:g}")
for s in found:
    print(f"  shot {s.index}: {s.start_seconds:.2f}-{s.end_seconds:.2f}s "
          f"frames {s.start_frame}-{s.end_frame}")
print("PASS 3 shots" if len(found) == 3 else f"FAIL got {len(found)} shots, want 3")
PY
```

Expected: three shots with boundaries near 2.0s and 4.0s.

- [ ] **Step 5: Verify the single-shot case**

A 15-second ad with no cut must return exactly one shot spanning the clip, not zero:

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import probe, shots
p = probe.probe(Path("/tmp/ad.mp4"))
found = shots.detect(Path("/tmp/ad.mp4"), p.duration_seconds, p.fps)
ok = len(found) == 1 and abs(found[0].end_seconds - p.duration_seconds) < 0.05
print(("PASS" if ok else "FAIL"), f"{len(found)} shot(s), spans "
      f"{found[0].start_seconds:.2f}-{found[0].end_seconds:.2f} of {p.duration_seconds:.2f}")
PY
```

Expected: `PASS 1 shot(s), spans 0.00-5.00 of 5.00`

- [ ] **Step 6: Verify MAFD comes back per frame**

```bash
poetry run python -c "
from pathlib import Path
from app.video import shots
m = shots.frame_mafd(Path('/tmp/ad.mp4'))
print(f'{len(m)} MAFD values, min {min(m):.4f} max {max(m):.4f}')
print('PASS' if len(m) > 100 else 'FAIL too few values')"
```

Expected: roughly one value per frame (150 for a 5s 30fps clip), all in 0–1.

- [ ] **Step 7: Lint and confirm no regression**

```bash
poetry run ruff check app/video app/core/config.py
poetry run python cli.py check   # must still be 9/9 PASS
```

---

### Task 2: The VideoBlueprint schemas

**Files:**
- Modify: `app/video/schemas.py` (additive)

**Interfaces:**
- Produces: `schemas.TextRegion`, `schemas.RegionMotion`, `schemas.VideoBlueprint`

- [ ] **Step 1: Write the failing check**

Run: `poetry run python -c "from app.video.schemas import VideoBlueprint"`
Expected: FAIL with `ImportError: cannot import name 'VideoBlueprint'`

- [ ] **Step 2: Write the implementation**

Append to `app/video/schemas.py`:

```python
class RegionMotion(BaseModel):
    """The three static tests, kept separate on purpose.

    Conflating them is the classic bug in this area. They answer genuinely
    different questions and a region can pass one and fail another:

      box_static        has the BOX moved? (geometry)
      pixels_static     have the pixels INSIDE it changed? (content)
      background_moves  does the SURROUND move? (is the truth recoverable
                        from other frames, or does it exist nowhere?)

    Only the third decides whether an erase can recover real pixels or must
    invent them.
    """

    box_static: bool
    pixels_static: bool
    background_moves: bool

    #: Median absolute luma difference inside the region, and in a control ring
    #: around it. The ratio is what the decision actually uses — a raw figure
    #: just tracks how much the footage moves.
    mafd_region: float
    mafd_ring: float

    @property
    def mafd_ratio(self) -> float:
        """Region change relative to its surroundings. Below ~0.25 = static.

        Relative rather than absolute because a fixed threshold cannot survive
        a change of bitrate: quantisation resets at every GOP, so a genuinely
        static overlay in a re-encoded ad measures 0.002-0.01, not the 0.001
        that ffmpeg's freezedetect defaults to.
        """
        return self.mafd_region / self.mafd_ring if self.mafd_ring > 0 else 1.0


class TextRegion(BaseModel):
    """One overlay tracked across one shot.

    `erase_box` and `retypeset_box` are deliberately DIFFERENT geometries from
    the same observations, because the two consumers want opposite errors:

      erase_box      the per-edge UNION over the shot, then dilated. Erasing a
                     few pixels too many is invisible; leaving a glyph fragment
                     is a defect that ships.
      retypeset_box  the per-edge 10th/90th PERCENTILE. Rejects the one frame
                     where the detector's polygon blew out, so re-typeset copy
                     lands where the type actually was.
    """

    shot_index: int
    role: str
    text: str | None = None

    #: [ymin, xmin, ymax, xmax] normalised 0-1000, matching the image path's
    #: Element.box_2d so the two blueprints read the same way.
    erase_box: list[int]
    retypeset_box: list[int]

    font_family: str | None = None
    color_hex: str | None = None

    #: Share of sampled frames in the shot where this region was detected.
    #: Below the voting threshold it never becomes a TextRegion at all; this is
    #: kept so an operator can see how confident the track was.
    presence: float

    first_seconds: float
    last_seconds: float

    motion: RegionMotion | None = None


class VideoBlueprint(BaseModel):
    """What a finished video ad is made of. The analysis artifact.

    Produced ONCE per creative and cached, exactly like the image path's
    Blueprint: every later stage and every target resolution reads this rather
    than re-running the models. Putting a model call in the render path is what
    destroys the economics.
    """

    duration_seconds: float
    fps: float
    width: int
    height: int
    shots: list[Shot] = Field(default_factory=list)
    regions: list[TextRegion] = Field(default_factory=list)

    #: Dominant background colour of the LAYOUT, as hex. Used by a later phase
    #: when rebuilding a frame rather than repairing one.
    background_hex: str | None = None

    #: Set when analysis ran but a stage degraded (e.g. the model was
    #: unavailable). The CMS surfaces this rather than pretending confidence.
    warnings: list[str] = Field(default_factory=list)

    def regions_in(self, shot_index: int) -> list[TextRegion]:
        return [r for r in self.regions if r.shot_index == shot_index]
```

- [ ] **Step 3: Run the check to verify it passes**

```bash
poetry run python - <<'PY'
from app.video.schemas import VideoBlueprint, TextRegion, RegionMotion, Shot
m = RegionMotion(box_static=True, pixels_static=True, background_moves=True,
                 mafd_region=0.004, mafd_ring=0.05)
print(f"ratio {m.mafd_ratio:.3f} (static if <= 0.25)")
r = TextRegion(shot_index=0, role="headline", text="Hi", erase_box=[10,10,90,90],
               retypeset_box=[12,12,88,88], presence=0.86,
               first_seconds=0.0, last_seconds=2.0, motion=m)
b = VideoBlueprint(duration_seconds=5.0, fps=30.0, width=1920, height=1080,
                   shots=[Shot(index=0, start_seconds=0, end_seconds=5,
                               start_frame=0, end_frame=149)], regions=[r])
print(b.model_dump_json(indent=2)[:200])
print("regions in shot 0:", len(b.regions_in(0)))
print("PASS")
PY
```

Expected: `ratio 0.080`, valid JSON, `regions in shot 0: 1`, `PASS`.

- [ ] **Step 4: Lint and confirm no regression**

```bash
poetry run ruff check app/video
poetry run python cli.py check   # 9/9 PASS
```

---

### Task 3: Keyframe extraction and the Gemini read

Mirrors `app/blueprint/service.py`: the model reads MEANING, not geometry. Same role vocabulary so the two blueprints are recognisably the same artifact.

**Files:**
- Create: `app/video/blueprint.py`

**Interfaces:**
- Consumes: `ffmpeg.run`, `schemas.Shot`, `schemas.VideoBlueprint`, `settings.AI_MODEL`, `settings.GEMINI_API_KEY`
- Produces: `blueprint.keyframes(path: Path, shots: list[Shot]) -> list[tuple[int, bytes]]`, `blueprint.analyse(path, probe_data, shots) -> VideoBlueprint`

- [ ] **Step 1: Write the failing check**

Create `app/video/blueprint.py`:

```python
"""Stage 2 — read a video ad's MEANING with Gemini, once per shot.

The division of labour is the same one the image path uses, and it is the
reason this is affordable: the model is asked what things ARE (the exact
wording, the role it plays, the font, the colour), and cheap deterministic
machinery is asked where they are and whether they moved. Asking a model for
per-frame geometry would be both slower and less stable than measuring it.

One keyframe per shot, not per frame. A shot is by definition a continuous
take, so its text does not change identity within it; what changes is
position, and position is measured, not inferred.
"""

from __future__ import annotations
```

- [ ] **Step 2: Run it to verify it fails**

Run: `poetry run python -c "from app.video import blueprint; print(blueprint.analyse)"`
Expected: FAIL with `AttributeError`

- [ ] **Step 3: Write the implementation**

Append to `app/video/blueprint.py`:

```python
import logging
from pathlib import Path

from app.core.config import settings
from app.video import ffmpeg
from app.video.schemas import Shot, TextRegion, VideoBlueprint, VideoProbe

logger = logging.getLogger(__name__)

#: Deliberately the same vocabulary as app/blueprint/service.py's PROMPT. A
#: role means the same thing in both blueprints, so the layout rules that
#: already exist for images apply unchanged to a video's copy.
PROMPT = """You are analysing a frame from a finished video advertisement so it
can be rebuilt for a different screen shape.

Return EVERY distinct element you can see, tagged with the role it plays:

- `headline`  the main claim or product name, the biggest type on screen
- `subhead`   secondary line supporting the headline
- `body`      supporting detail, features, locations
- `legal`     fine print, disclaimers, registration numbers
- `contact`   phone, website, email, address — the reply-to block
- `badge`     text INSIDE a coloured shape: a pill, circle, sticker, ribbon.
              Tag by the SHAPE it sits in, not by what it says.
- `logo`      the brand mark
- `product`   the main product or subject being advertised

Rules:
- `text` must be the exact wording, character for character, in the original
  script. Do NOT transliterate or translate. Null for logo/product.
- `box_2d` is [ymin, xmin, ymax, xmax] normalised 0-1000.
- `font_family` MUST be chosen from: {fonts}
- `background_hex` is the dominant background of the LAYOUT, not of any photo.

Be exhaustive. An element you miss survives into the rebuilt ad as a smear."""


def keyframes(path: Path, shots: list[Shot]) -> list[tuple[int, bytes]]:
    """One representative JPEG per shot, as (shot_index, bytes).

    Sampled a quarter into the shot rather than at its first frame: the first
    frame of a shot is frequently mid-transition (a dissolve, a wipe, a fade
    from black) and reads as a muddy blend of two scenes.
    """
    out: list[tuple[int, bytes]] = []
    for shot in shots:
        at = shot.start_seconds + shot.duration_seconds * 0.25
        data = ffmpeg.run(
            [
                "-ss", f"{at:.3f}", "-i", str(path),
                "-frames:v", "1",
                "-vf", f"scale={settings.VIDEO_ANALYSIS_WIDTH}:-2",
                "-f", "image2", "-c:v", "mjpeg", "-q:v", "3", "-",
            ]
        )
        if data:
            out.append((shot.index, data))
        else:
            logger.warning("no keyframe extracted for shot %d at %.2fs", shot.index, at)
    return out


def _client():
    from google import genai

    if not settings.ai_configured:
        raise RuntimeError("Video analysis needs GEMINI_API_KEY.")
    return genai.Client(api_key=settings.GEMINI_API_KEY)


def _read_frame(client, image: bytes) -> dict:
    """Ask the model what is in one frame. Returns the raw parsed dict."""
    import json

    from google.genai import types

    from app.layout.rules import FONTS

    resp = client.models.generate_content(
        model=settings.AI_MODEL,
        contents=[
            types.Part.from_bytes(data=image, mime_type="image/jpeg"),
            PROMPT.format(fonts=", ".join(FONTS)),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )
    return json.loads(resp.text)


def analyse(
    path: Path, probe_data: VideoProbe, shots: list[Shot]
) -> VideoBlueprint:
    """Read every shot's keyframe and assemble the blueprint.

    A failed read on one shot degrades that shot rather than the job: an ad
    whose third shot could not be read is still better refitted knowing shots
    one and two than knowing nothing.
    """
    blueprint = VideoBlueprint(
        duration_seconds=probe_data.duration_seconds,
        fps=probe_data.fps,
        width=probe_data.width,
        height=probe_data.height,
        shots=shots,
    )

    frames = keyframes(path, shots)
    if not frames:
        blueprint.warnings.append("No keyframes could be extracted; analysis is empty.")
        return blueprint

    client = _client()
    by_shot = {s.index: s for s in shots}

    for shot_index, image in frames:
        shot = by_shot[shot_index]
        try:
            parsed = _read_frame(client, image)
        except Exception:  # noqa: BLE001 — one bad shot must not sink the job
            logger.warning("shot %d could not be read", shot_index, exc_info=True)
            blueprint.warnings.append(f"Shot {shot_index} could not be analysed.")
            continue

        if blueprint.background_hex is None:
            background = parsed.get("background_hex")
            if isinstance(background, str):
                blueprint.background_hex = background

        for element in parsed.get("elements", []) or []:
            box = element.get("box_2d")
            if not isinstance(box, list) or len(box) != 4:
                continue
            blueprint.regions.append(
                TextRegion(
                    shot_index=shot_index,
                    role=str(element.get("role") or "body"),
                    text=element.get("text"),
                    # Task 4 replaces these with tracked geometry. Until then
                    # the keyframe's own box stands in for both.
                    erase_box=[int(v) for v in box],
                    retypeset_box=[int(v) for v in box],
                    font_family=element.get("font_family"),
                    color_hex=element.get("color_hex"),
                    presence=1.0,
                    first_seconds=shot.start_seconds,
                    last_seconds=shot.end_seconds,
                )
            )

    logger.info(
        "blueprint: %d shot(s), %d region(s) (%s)",
        len(shots), len(blueprint.regions),
        ", ".join(sorted({r.role for r in blueprint.regions})) or "none",
    )
    return blueprint
```

- [ ] **Step 4: Verify keyframe extraction without calling the model**

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import blueprint, probe, shots
p = probe.probe(Path("/tmp/cuts.mp4"))
found = shots.detect(Path("/tmp/cuts.mp4"), p.duration_seconds, p.fps)
kf = blueprint.keyframes(Path("/tmp/cuts.mp4"), found)
print(f"{len(kf)} keyframe(s) for {len(found)} shot(s)")
for i, (idx, data) in enumerate(kf):
    Path(f"/tmp/kf{idx}.jpg").write_bytes(data)
    print(f"  shot {idx}: {len(data)} bytes -> /tmp/kf{idx}.jpg")
print("PASS" if len(kf) == len(found) else "FAIL")
PY
```

Expected: one keyframe per shot, each a valid non-empty JPEG. **Open them and confirm they show visibly different content** — that proves they were sampled inside distinct shots rather than all from the same moment.

- [ ] **Step 5: Verify the full analysis against a real creative**

This calls Gemini and costs a few tokens.

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import blueprint, probe, shots
src = Path("/tmp/ad.mp4")
p = probe.probe(src)
found = shots.detect(src, p.duration_seconds, p.fps)
bp = blueprint.analyse(src, p, found)
print(f"shots {len(bp.shots)}  regions {len(bp.regions)}  bg {bp.background_hex}")
for r in bp.regions:
    print(f"  shot{r.shot_index} {r.role:9s} {str(r.erase_box):24s} {(r.text or '')[:40]}")
print("warnings:", bp.warnings or "none")
PY
```

`/tmp/ad.mp4` is a synthetic test pattern, so few or no text regions is the CORRECT result — what matters is that it completes, returns valid JSON and records no warnings. **Then run it against a real ad creative if one is available** and confirm the text comes back verbatim.

- [ ] **Step 6: Verify graceful degradation**

Point the key at nonsense and confirm one unreadable shot does not sink the job:

```bash
GEMINI_API_KEY=invalid_key poetry run python - <<'PY'
from pathlib import Path
from app.video import blueprint, probe, shots
src = Path("/tmp/cuts.mp4")
p = probe.probe(src)
found = shots.detect(src, p.duration_seconds, p.fps)
try:
    bp = blueprint.analyse(src, p, found)
    print(f"regions {len(bp.regions)}, warnings {len(bp.warnings)}")
    print("PASS degraded cleanly" if bp.warnings else "FAIL no warning recorded")
except Exception as exc:
    print(f"FAIL raised instead of degrading: {type(exc).__name__}: {exc}")
PY
```

Expected: it completes, records one warning per shot, and does not raise.

- [ ] **Step 7: Lint and confirm no regression**

```bash
poetry run ruff check app/video
poetry run python cli.py check   # 9/9 PASS
```

---

### Task 4: Stable geometry from unstable detections

**Files:**
- Create: `app/video/tracking.py`

**Interfaces:**
- Consumes: `ffmpeg.run`, `schemas.Shot`, `schemas.TextRegion`
- Produces: `tracking.sample_times(shot: Shot, count: int) -> list[float]`, `tracking.union_box(boxes) -> list[int]`, `tracking.percentile_box(boxes, low=10, high=90) -> list[int]`, `tracking.associate(detections, iou_gate=0.45) -> list[list[dict]]`, `tracking.iou(a, b) -> float`

**Design note this task must honour — no opencv, deliberately.** Global-motion compensation would need `cv2.estimateAffinePartial2D`, and opencv is not a dependency of this project (`pyproject.toml` is explicitly built to avoid the packages that drag it in). It is not needed here: a static overlay on moving footage keeps its box fixed in SCREEN space, which is the dominant case and which plain IoU association handles exactly. Motion compensation only matters when the camera moves AND the overlay tracks a scene element. Phase C adds opencv if and when the flow-based erase branch forces it.

- [ ] **Step 1: Write the failing check**

Create `app/video/tracking.py`:

```python
"""Turn flickering per-frame detections into ONE stable region per shot.

Detectors re-decide from scratch every frame: a 0.51-confidence line drops to
0.49 and vanishes, and polygon post-processing shifts edges by 1-3px even when
the pixels are identical. So no single frame is trusted.

The two outputs want OPPOSITE errors, which is why this module produces two
geometries from the same observations:

    union       per-edge maximum -> the erase mask. Over-erasing is invisible;
                a surviving glyph fragment is a defect that ships.
    percentile  per-edge 10th/90th -> the re-typeset box. Rejects the one frame
                where the polygon blew out.

No global-motion compensation, and that is deliberate. It would require opencv,
which this project avoids on purpose, and it buys nothing for the dominant case:
a static overlay on moving footage keeps its box fixed in screen space. When a
later phase genuinely needs flow, it can add the dependency then.
"""

from __future__ import annotations
```

- [ ] **Step 2: Run it to verify it fails**

Run: `poetry run python -c "from app.video import tracking; print(tracking.union_box)"`
Expected: FAIL with `AttributeError`

- [ ] **Step 3: Write the implementation**

Append to `app/video/tracking.py`:

```python
import logging

from app.video.schemas import Shot

logger = logging.getLogger(__name__)

#: Frames sampled per shot. Enough to vote away a one-frame hallucination,
#: few enough that a 30-second ad is not a detector marathon.
SAMPLES_PER_SHOT = 7

#: A track must appear in at least this share of a shot's sampled frames to be
#: believed. This is where most detector flicker is discarded.
MIN_PRESENCE = 0.60

#: Tighter than a general MOT tracker's gate. Overlays do not occlude each
#: other, so a loose gate merges adjacent lines of the same block rather than
#: recovering from occlusion.
IOU_GATE = 0.45


def sample_times(shot: Shot, count: int = SAMPLES_PER_SHOT) -> list[float]:
    """Evenly spaced sample times inside ``shot``, avoiding its exact edges.

    The first and last frames of a shot are often mid-transition, so samples
    are inset rather than spanning the full range.
    """
    if count < 1:
        return []
    span = shot.duration_seconds
    if span <= 0:
        return [shot.start_seconds]
    inset = span * 0.05
    lo, hi = shot.start_seconds + inset, shot.end_seconds - inset
    if count == 1:
        return [(lo + hi) / 2]
    step = (hi - lo) / (count - 1)
    return [round(lo + step * i, 3) for i in range(count)]


def iou(a: list[int], b: list[int]) -> float:
    """Intersection over union for [ymin, xmin, ymax, xmax] boxes."""
    ay0, ax0, ay1, ax1 = a
    by0, bx0, by1, bx1 = b
    iy0, ix0 = max(ay0, by0), max(ax0, bx0)
    iy1, ix1 = min(ay1, by1), min(ax1, bx1)
    if iy1 <= iy0 or ix1 <= ix0:
        return 0.0
    inter = (iy1 - iy0) * (ix1 - ix0)
    area_a = max(0, ay1 - ay0) * max(0, ax1 - ax0)
    area_b = max(0, by1 - by0) * max(0, bx1 - bx0)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def union_box(boxes: list[list[int]]) -> list[int]:
    """Per-edge maximum extent — the erase mask's geometry."""
    if not boxes:
        raise ValueError("union_box needs at least one box")
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


def _percentile(values: list[float], pct: float) -> float:
    """Linear-interpolated percentile. Avoids a numpy import for four numbers."""
    if not values:
        raise ValueError("percentile needs values")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * (pct / 100.0)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    weight = position - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def percentile_box(boxes: list[list[int]], low: float = 10, high: float = 90) -> list[int]:
    """Per-edge percentile — the re-typeset box's geometry.

    Percentile rather than mean: one blown-out polygon drags a mean badly, and
    the whole point is to reject that frame.
    """
    if not boxes:
        raise ValueError("percentile_box needs at least one box")
    return [
        round(_percentile([b[0] for b in boxes], low)),
        round(_percentile([b[1] for b in boxes], low)),
        round(_percentile([b[2] for b in boxes], high)),
        round(_percentile([b[3] for b in boxes], high)),
    ]


def associate(
    detections: list[list[dict]], iou_gate: float = IOU_GATE
) -> list[list[dict]]:
    """Group per-frame detections into tracks.

    ``detections`` is one list per sampled frame; each item needs a ``box``
    (normalised [ymin, xmin, ymax, xmax]) and may carry any other keys, which
    are preserved. Returns one list of member detections per track.

    Greedy nearest-IoU rather than Hungarian: overlays are few and do not
    occlude, so the optimal assignment and the greedy one agree, and greedy is
    far easier to reason about when a result looks wrong.
    """
    tracks: list[list[dict]] = []
    for frame_index, frame in enumerate(detections):
        for item in frame:
            box = item["box"]
            best, best_iou = None, iou_gate
            for track in tracks:
                # Compare against the track's most recent box, not its first —
                # an overlay that drifts slowly would otherwise fall out of the
                # gate partway through the shot.
                score = iou(track[-1]["box"], box)
                if score >= best_iou:
                    best, best_iou = track, score
            enriched = {**item, "frame_index": frame_index}
            if best is None:
                tracks.append([enriched])
            else:
                best.append(enriched)
    return tracks


def presence(track: list[dict], sampled: int) -> float:
    """Share of sampled frames this track was seen in."""
    if sampled <= 0:
        return 0.0
    return len({m["frame_index"] for m in track}) / sampled
```

- [ ] **Step 4: Run the check to verify it passes**

The geometry functions are pure, so they can be checked exactly:

```bash
poetry run python - <<'PY'
from app.video import tracking as t
from app.video.schemas import Shot

# A jittering box plus ONE blown-out frame — the case this exists for.
boxes = [[100,100,200,200],[102,98,198,202],[99,101,201,199],
         [101,100,199,201],[100,99,200,200],[98,102,202,198],
         [50,50,400,400]]  # the outlier

u = t.union_box(boxes)
p = t.percentile_box(boxes)
print("union     ", u, "<- absorbs the outlier, as it must for an erase mask")
print("percentile", p, "<- rejects it, as it must for a re-typeset box")
assert u == [50,50,400,400], f"union wrong: {u}"
assert p[2] < 250 and p[3] < 250, f"percentile did not reject the outlier: {p}"

assert t.iou([0,0,100,100],[0,0,100,100]) == 1.0
assert t.iou([0,0,10,10],[90,90,100,100]) == 0.0
assert abs(t.iou([0,0,100,100],[0,0,50,100]) - 0.5) < 1e-9

s = Shot(index=0, start_seconds=0.0, end_seconds=4.0, start_frame=0, end_frame=119)
times = t.sample_times(s)
print("sample times", times)
assert len(times) == 7 and times[0] > 0.0 and times[-1] < 4.0

# Two overlays present in every frame, plus a one-frame hallucination.
det = [[{"box":[100,100,200,200]},{"box":[500,500,600,600]}] for _ in range(6)]
det.append([{"box":[100,100,200,200]},{"box":[500,500,600,600]},{"box":[800,800,900,900]}])
tracks = t.associate(det)
pres = sorted(round(t.presence(tr, 7), 2) for tr in tracks)
print("tracks", len(tracks), "presence", pres)
assert len(tracks) == 3, f"expected 3 tracks, got {len(tracks)}"
kept = [tr for tr in tracks if t.presence(tr, 7) >= t.MIN_PRESENCE]
assert len(kept) == 2, f"voting should keep 2, kept {len(kept)}"
print("PASS — voting discarded the 1-frame hallucination")
PY
```

Expected: all assertions pass, ending `PASS — voting discarded the 1-frame hallucination`.

- [ ] **Step 5: Lint and confirm no regression**

```bash
poetry run ruff check app/video
poetry run python cli.py check   # 9/9 PASS
```

---

### Task 5: The three static tests

**Files:**
- Create: `app/video/motion.py`

**Interfaces:**
- Consumes: `ffmpeg.run`, `schemas.Shot`, `schemas.RegionMotion`
- Produces: `motion.region_mafd(path, box, shot, width, height) -> float`, `motion.classify(path, region_box, shot, width, height) -> RegionMotion`

- [ ] **Step 1: Write the failing check**

Create `app/video/motion.py`:

```python
"""The three static tests — the inputs the erase router will decide on.

They are separate functions answering separate questions, and conflating them
is the standard bug here:

  A  has the BOX moved?          geometry, from tracking.py's observations
  B  have its PIXELS changed?    content, measured here
  C  does the SURROUND move?     whether the truth behind the overlay exists
                                 in any other frame at all

C is the one that decides everything downstream. If the surround is also
static, the pixels behind the overlay were never visible in any frame, and no
amount of temporal reasoning recovers them — that case must be inpainted. If
the surround moves, the real pixels are somewhere in the clip and can be
recovered exactly, with no model and no flicker.

Thresholds are RELATIVE, not absolute. ffmpeg's freezedetect defaults to
-60dB (0.001 normalised, ~0.26 grey levels), which is right for a genuinely
frozen signal and wrong for a re-encoded ad: quantisation resets at every GOP
and deblocking strength varies with neighbouring QP, so a visually static
overlay measures 0.002-0.01. A ratio against a control ring self-calibrates to
whatever bitrate the creative happens to have been delivered at.
"""

from __future__ import annotations
```

- [ ] **Step 2: Run it to verify it fails**

Run: `poetry run python -c "from app.video import motion; print(motion.classify)"`
Expected: FAIL with `AttributeError`

- [ ] **Step 3: Write the implementation**

Append to `app/video/motion.py`:

```python
import logging
import re
import statistics
from pathlib import Path

from app.video import ffmpeg
from app.video.schemas import RegionMotion, Shot

logger = logging.getLogger(__name__)

#: A region changing less than a quarter as much as its surroundings is static.
#: Relative, so it holds at any bitrate.
STATIC_RATIO = 0.25

#: The surround must move at least this much (absolute, normalised) before the
#: background behind an overlay counts as recoverable. Below it the whole shot
#: is essentially frozen and there is nothing to recover FROM.
SURROUND_MOVES_MIN = 0.02

#: How far outside the region the control ring extends, as a share of the
#: region's size.
RING_MARGIN = 0.5

_YAVG = re.compile(r"lavfi\.signalstats\.YAVG=([0-9.]+)")


def _crop_mafd(path: Path, crop: tuple[int, int, int, int], shot: Shot) -> float:
    """Median frame-to-frame absolute luma difference inside ``crop``.

    `tblend=all_mode=difference` turns consecutive frames into their absolute
    difference, and `signalstats` then reports that frame's average luma — so
    YAVG on the blended stream IS the mean absolute difference. Median over the
    shot rather than mean: a handful of blocky macroblock outliers drag a mean
    over any threshold while the median stays put.
    """
    width, height, x, y = crop
    raw = ffmpeg.run(
        [
            "-ss", f"{shot.start_seconds:.3f}",
            "-t", f"{max(shot.duration_seconds, 0.1):.3f}",
            "-i", str(path),
            "-vf", (
                f"crop={width}:{height}:{x}:{y},"
                "format=gray,"
                "tblend=all_mode=difference,"
                "signalstats,"
                "metadata=print:key=lavfi.signalstats.YAVG:file=-"
            ),
            "-f", "null", "-",
        ]
    ).decode("utf-8", "replace")

    values = [float(v) for v in _YAVG.findall(raw)]
    if not values:
        return 0.0
    # YAVG is 0-255; normalise to 0-1 so the thresholds read the same way as
    # scdet's MAFD.
    return statistics.median(values) / 255.0


def _pixels(box: list[int], width: int, height: int) -> tuple[int, int, int, int]:
    """Normalised [ymin,xmin,ymax,xmax] -> even (w, h, x, y) crop, clamped."""
    y0 = max(0, min(height - 2, round(box[0] / 1000 * height)))
    x0 = max(0, min(width - 2, round(box[1] / 1000 * width)))
    y1 = max(y0 + 2, min(height, round(box[2] / 1000 * height)))
    x1 = max(x0 + 2, min(width, round(box[3] / 1000 * width)))
    # crop dimensions must be even for the yuv pipeline
    w = max(2, (x1 - x0) - ((x1 - x0) % 2))
    h = max(2, (y1 - y0) - ((y1 - y0) % 2))
    return w, h, x0, y0


def _ring(box: list[int], width: int, height: int) -> tuple[int, int, int, int]:
    """A control crop surrounding ``box``, clamped to the frame.

    Deliberately a larger box around the region rather than a true annulus:
    ffmpeg has no annulus crop, and a surrounding box that INCLUDES the region
    still moves markedly more than the region alone whenever the background is
    live, which is all this test needs to distinguish.
    """
    h_span, w_span = box[2] - box[0], box[3] - box[1]
    grown = [
        max(0, round(box[0] - h_span * RING_MARGIN)),
        max(0, round(box[1] - w_span * RING_MARGIN)),
        min(1000, round(box[2] + h_span * RING_MARGIN)),
        min(1000, round(box[3] + w_span * RING_MARGIN)),
    ]
    return _pixels(grown, width, height)


def region_mafd(path: Path, box: list[int], shot: Shot, width: int, height: int) -> float:
    return _crop_mafd(path, _pixels(box, width, height), shot)


def classify(
    path: Path, box: list[int], shot: Shot, width: int, height: int,
    box_static: bool = True,
) -> RegionMotion:
    """Measure tests B and C for one region. ``box_static`` (test A) is passed in.

    Test A is geometry and belongs to tracking.py, which has the per-frame
    observations; this module only measures pixels.
    """
    inside = _crop_mafd(path, _pixels(box, width, height), shot)
    around = _crop_mafd(path, _ring(box, width, height), shot)

    pixels_static = (inside <= around * STATIC_RATIO) if around > 0 else (inside < 1e-4)
    background_moves = around >= SURROUND_MOVES_MIN

    logger.info(
        "region %s: mafd %.5f vs ring %.5f (ratio %.3f) -> pixels_static=%s "
        "background_moves=%s",
        box, inside, around, (inside / around) if around else 0.0,
        pixels_static, background_moves,
    )
    return RegionMotion(
        box_static=box_static,
        pixels_static=pixels_static,
        background_moves=background_moves,
        mafd_region=round(inside, 6),
        mafd_ring=round(around, 6),
    )
```

- [ ] **Step 4: Build the two discriminating fixtures**

The whole value of this task is telling these two cases apart, so both must be built and measured:

```bash
poetry run python - <<'PY'
from app.video import ffmpeg
# A: static text box over MOVING footage -> recoverable
ffmpeg.run(["-y","-f","lavfi","-i","testsrc2=size=640x360:rate=25:duration=4",
            "-vf","drawbox=x=100:y=250:w=300:h=60:color=white@1.0:t=fill",
            "-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-an",
            "/tmp/static_on_moving.mp4"])
# B: static text box over a LOCKED-OFF still -> NOT recoverable
ffmpeg.run(["-y","-f","lavfi","-i","color=c=navy:size=640x360:rate=25:duration=4",
            "-vf","drawbox=x=100:y=250:w=300:h=60:color=white@1.0:t=fill",
            "-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-an",
            "/tmp/static_on_still.mp4"])
print("fixtures written")
PY
```

- [ ] **Step 5: Run the check to verify it passes**

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import motion, probe
from app.video.schemas import Shot

# The drawn box: y 250-310 of 360, x 100-400 of 640 -> normalised
box = [round(250/360*1000), round(100/640*1000), round(310/360*1000), round(400/640*1000)]

for name, expect_recoverable in [("static_on_moving", True), ("static_on_still", False)]:
    path = Path(f"/tmp/{name}.mp4")
    p = probe.probe(path)
    shot = Shot(index=0, start_seconds=0.0, end_seconds=p.duration_seconds,
                start_frame=0, end_frame=int(p.duration_seconds*p.fps)-1)
    m = motion.classify(path, box, shot, p.width, p.height)
    ok = m.background_moves == expect_recoverable and m.pixels_static
    print(f"{'PASS' if ok else 'FAIL'} {name}: pixels_static={m.pixels_static} "
          f"background_moves={m.background_moves} ratio={m.mafd_ratio:.3f} "
          f"(region {m.mafd_region:.5f} ring {m.mafd_ring:.5f})")
PY
```

Expected: both `pixels_static=True` (the box is drawn identically every frame), but `background_moves=True` for the moving fixture and `False` for the still one. **That difference is the entire point of the task** — it is what decides whether an erase can recover real pixels or must invent them.

- [ ] **Step 6: Lint and confirm no regression**

```bash
poetry run ruff check app/video
poetry run python cli.py check   # 9/9 PASS
```

---

### Task 6: Wire analysis into the pipeline, add `--report`, extend the harness

**Files:**
- Modify: `app/video/pipeline.py` (add `analyse()`, cached)
- Modify: `app/video/check.py` (append analysis checks to `run_all()`)
- Modify: `cli.py` (`analyse` subcommand and `--report`)

**Interfaces:**
- Produces: `pipeline.analyse(creative_id, source, probe_data, force=False) -> VideoBlueprint`, `check.analysis_assertions() -> list[CheckResult]`

- [ ] **Step 1: Write the failing check**

Run: `poetry run python -c "from app.video import pipeline; print(pipeline.analyse)"`
Expected: FAIL with `AttributeError`

- [ ] **Step 2: Add the cached analysis stage**

Append to `app/video/pipeline.py` (and add `BLUEPRINT = "blueprint.json"` beside the existing `SOURCE` / `PROBE` constants):

```python
def analyse(
    creative_id: str, source: Path, probe_data: VideoProbe, force: bool = False
) -> VideoBlueprint:
    """Stage 2 — segment, read and measure. Cached beside the probe.

    Cached for the same reason the image path caches its blueprint: this is the
    only stage that costs model calls, and every target resolution renders off
    the same artifact. A new screen shape must never re-run analysis.
    """
    from app.video import blueprint as blueprint_module
    from app.video import motion, shots as shots_module

    folder = creative_dir(creative_id)
    path = folder / BLUEPRINT

    if not force and path.exists():
        try:
            logger.info("blueprint cache hit for %s", creative_id)
            return VideoBlueprint.model_validate_json(path.read_text())
        except ValueError:
            logger.warning("blueprint cache unreadable; re-analysing")

    found = shots_module.detect(source, probe_data.duration_seconds, probe_data.fps)
    result = blueprint_module.analyse(source, probe_data, found)

    by_index = {s.index: s for s in result.shots}
    for region in result.regions:
        shot = by_index.get(region.shot_index)
        if shot is None:
            continue
        try:
            region.motion = motion.classify(
                source, region.erase_box, shot, probe_data.width, probe_data.height
            )
        except Exception:  # noqa: BLE001 — a measurement failure degrades one region
            logger.warning("motion classify failed for %s", region.erase_box, exc_info=True)

    path.write_text(result.model_dump_json(indent=2))
    return result
```

- [ ] **Step 3: Add the CLI surface**

In `cli.py`, add above `main()`:

```python
def cmd_analyse(args) -> None:
    """Analyse a video without rendering anything."""
    from app.video import pipeline as video_pipeline

    creative_id, source, probe_data = video_pipeline.ingest(
        _load(args.video), force=args.force
    )
    blueprint = video_pipeline.analyse(
        creative_id, source, probe_data, force=args.force
    )
    print(f"creative_id: {creative_id}")
    print(f"artifacts:   {video_pipeline.creative_dir(creative_id)}")
    print(
        f"\nsource: {probe_data.width}x{probe_data.height} {probe_data.fps:g}fps "
        f"{probe_data.duration_seconds:.2f}s"
    )
    print(f"\n{len(blueprint.shots)} shot(s):")
    for shot in blueprint.shots:
        regions = blueprint.regions_in(shot.index)
        print(
            f"  shot {shot.index}: {shot.start_seconds:6.2f}-{shot.end_seconds:6.2f}s "
            f"({shot.duration_seconds:5.2f}s)  {len(regions)} region(s)"
        )
        for region in regions:
            motion = region.motion
            state = "?" if motion is None else (
                "static/recoverable" if motion.pixels_static and motion.background_moves
                else "static/locked" if motion.pixels_static
                else "moving"
            )
            print(
                f"      {region.role:9s} {str(region.erase_box):24s} {state:18s} "
                f"{(region.text or '')[:36]}"
            )
    if blueprint.warnings:
        print("\nwarnings:")
        for warning in blueprint.warnings:
            print(f"  - {warning}")
```

and register it inside `main()`, after the `check` subparser:

```python
    p_an = sub.add_parser("analyse", help="segment, read and measure — no rendering")
    p_an.add_argument("video", type=Path)
    p_an.add_argument("--force", action="store_true")
    p_an.set_defaults(func=cmd_analyse)
```

- [ ] **Step 4: Extend the harness**

Append to `app/video/check.py`, and add these results to `run_all()`:

```python
def analysis_assertions() -> list[CheckResult]:
    """Prove the analysis stage can tell its two decisive cases apart.

    A shot detector that finds no cuts and a static test that says everything
    is static would both "pass" a smoke test while being useless. These two
    fixtures are built to discriminate.
    """
    from app.video import motion, probe as probe_module, shots as shots_module
    from app.video.schemas import Shot

    results: list[CheckResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        # Three visually distinct segments concatenated -> must find 3 shots.
        parts = []
        for index, source in enumerate([
            "testsrc2=size=320x180:rate=25:duration=1",
            "color=c=red:size=320x180:rate=25:duration=1",
            "smptebars=size=320x180:rate=25:duration=1",
        ]):
            part = Path(tmp) / f"p{index}.mp4"
            ffmpeg.run(["-y", "-f", "lavfi", "-i", source, "-c:v", "libx264",
                        "-preset", "ultrafast", "-crf", "25", "-pix_fmt", "yuv420p",
                        "-an", str(part)])
            parts.append(part)
        listing = Path(tmp) / "list.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in parts))
        cuts = Path(tmp) / "cuts.mp4"
        ffmpeg.run(["-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25",
                    "-an", str(cuts)])

        cut_probe = probe_module.probe(cuts)
        found = shots_module.detect(cuts, cut_probe.duration_seconds, cut_probe.fps)
        results.append(CheckResult(
            "analysis-shots", len(found) == 3,
            f"{len(found)} shot(s) in a 3-cut fixture (expected 3)",
        ))

        # A static box over moving footage: pixels static, background recoverable.
        moving = Path(tmp) / "moving.mp4"
        ffmpeg.run(["-y", "-f", "lavfi",
                    "-i", "testsrc2=size=320x180:rate=25:duration=2",
                    "-vf", "drawbox=x=60:y=130:w=150:h=30:color=white@1.0:t=fill",
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25",
                    "-pix_fmt", "yuv420p", "-an", str(moving)])
        move_probe = probe_module.probe(moving)
        shot = Shot(index=0, start_seconds=0.0, end_seconds=move_probe.duration_seconds,
                    start_frame=0, end_frame=49)
        box = [round(130 / 180 * 1000), round(60 / 320 * 1000),
               round(160 / 180 * 1000), round(210 / 320 * 1000)]
        measured = motion.classify(moving, box, shot, move_probe.width, move_probe.height)
        results.append(CheckResult(
            "analysis-static-region", measured.pixels_static,
            f"drawn box measured static (ratio {measured.mafd_ratio:.3f})",
        ))
        results.append(CheckResult(
            "analysis-background-moves", measured.background_moves,
            f"surround measured moving (ring mafd {measured.mafd_ring:.5f})",
        ))
    return results
```

and change `run_all()` to:

```python
def run_all() -> list[CheckResult]:
    return [*golden_frame(), *encode_assertions(), *analysis_assertions()]
```

- [ ] **Step 5: Run the checks to verify they pass**

```bash
poetry run python cli.py check
```

Expected: **twelve** PASS lines — the nine from Phase A plus `analysis-shots`, `analysis-static-region`, `analysis-background-moves`.

- [ ] **Step 6: Verify the CLI end to end**

```bash
poetry run python cli.py analyse /tmp/cuts.mp4
poetry run python cli.py analyse /tmp/cuts.mp4    # second run: blueprint cache hit
```

Expected: a shot listing with per-region motion states; the second run logs `blueprint cache hit` and returns immediately.

- [ ] **Step 7: Confirm no regression**

```bash
poetry run ruff check app/video cli.py
poetry run python cli.py fit /tmp/ad.mp4 1920x1080          # Phase A path intact
poetry run python cli.py fit .work/<an-image-id>/source.png 1920x1080   # image path intact
```

---

## What Phase B deliberately does not do

- **No erasing, no inpainting, no LaMa.** Phase C.
- **No reframing, no compose tier, no duration fitting.** Phase D.
- **No opencv, so no optical flow and no global-motion compensation.** Task 4 explains why; Phase C adds it if the flow branch needs it.
- **No dedicated per-frame text detector** (PaddleOCR/docTR). Multi-frame observations come from Gemini on sampled frames, which is enough to exercise and prove the union/percentile geometry. A cheap dedicated detector can replace the sampling later without changing `tracking.py` at all.
- **No API endpoint, no CMS wiring.** Phase E.

## Open items carried into Phase C

1. **Measure LaMa CPU inference and OpenCV DIS at 1080p** on the real Cloud Run shape. Still unmeasured, still no published benchmark, and Phase C's architecture depends on both.
2. **The 4K lane** — 4K clips land at ~10–19 min against a 15-minute budget.
3. **The `.part` cleanup wart** from Phase A: no `try/finally` removes the temp file if a write raises mid-way. Self-healing and cannot corrupt the source, but worth closing.
