# Video Creative Fit — Phase A (foundation + fast path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `markai-creative-fit` a video path that correctly refits a video ad whose target shape is within 1.25× of the source, with provably correct colour and a panel-legal encode.

**Architecture:** A new `app/video/` module beside the untouched image modules. ffmpeg runs as a subprocess at both ends (explicit colour control, free auto-rotate and VFR→CFR, GPL kept out of our process). Phase A implements only the `stretch` and `crop` tiers, which need no model calls and no frame-by-frame Python — one ffmpeg invocation per target. The colour-correctness harness is built *first*, before any pipeline code, because a colour bug is invisible in review and only shows up on a panel.

**Tech Stack:** Python 3.12, Poetry, FastAPI, Pillow, ffmpeg/ffprobe subprocess, ruff.

## Global Constraints

- **The image path must not change.** No file under `app/blueprint/`, `app/plate/`, `app/layout/`, or `app/pipeline.py` is edited in this phase. `cli.py` gains dispatch only.
- **No pytest in this repo.** Verification is a CLI command whose output you read. `python cli.py check` is the test suite.
- **ruff is the gate.** `poetry run ruff check .` must pass before every commit. Line length 100, target py312.
- **Output resolution is never capped and never downscaled.** `MAX_ANALYSIS_EDGE` limits only what models see.
- **Encode is `-pix_fmt yuv420p`, `-profile:v high`, `-preset slow`, `-crf 17`, `-an`, `-movflags +faststart`,** with `keyint=60:min-keyint=60:scenecut=0:bframes=2:ref=3:b-pyramid=none`.
- **Colour tags are written with the `setparams` filter, never with `-color_*` output flags** — measured: on ffmpeg 8.1.2 the output flags leave `color_transfer` and `color_primaries` as `unknown`.
- **Never emit 3840×2160@60 H.264** — the AndBox S905X4 tops out at 4K High@L5.1 30fps and will not decode it.
- **ffmpeg ≥ 7.x required.** Debian's 5.1 predates `drawtext`'s HarfBuzz requirement and would silently render Devanagari/Kannada as disconnected code points.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/video/__init__.py` | Module docstring — what lives where, mirroring `app/creative_fit/__init__.py`'s style |
| `app/video/schemas.py` | `VideoProbe`, `VideoVariant`, `FitMode` — the artifacts every other module passes around |
| `app/video/ffmpeg.py` | The subprocess boundary: locating the binary, asserting its build, running it, raising useful errors |
| `app/video/probe.py` | `ffprobe` → `VideoProbe`, including the colour-tag fallback heuristic |
| `app/video/encode.py` | H.264 level arithmetic and the encode argument list. Pure where possible |
| `app/video/render.py` | The fast path: one ffmpeg invocation for `stretch` / `crop` |
| `app/video/pipeline.py` | Orchestration + content-hash caching, mirroring `app/pipeline.py`'s split |
| `app/video/check.py` | Golden-frame colour harness + ffprobe encode assertions. The test suite |
| `cli.py` | MODIFIED — `fit` sniffs the input and dispatches; new `check` subcommand |

---

### Task 1: ffmpeg subprocess boundary and build assertion

**Files:**
- Create: `app/video/__init__.py`
- Create: `app/video/ffmpeg.py`
- Modify: `app/core/config.py` (append video settings)

**Interfaces:**
- Produces: `ffmpeg.run(args: list[str], stdin: bytes | None = None) -> bytes`, `ffmpeg.binary() -> str`, `ffmpeg.probe_binary() -> str`, `ffmpeg.assert_build() -> None`, `ffmpeg.FfmpegError`

- [ ] **Step 1: Write the failing check**

Create `app/video/ffmpeg.py` with only this, so the check exists before the implementation:

```python
"""The ffmpeg subprocess boundary.

Everything that touches ffmpeg goes through here. It is a subprocess and not a
library binding on purpose:

* colour handling is explicit and auditable per invocation, which is the whole
  ballgame (see check.py) — a library that defaults to BT.601 on unspecified
  input produces output that is subtly wrong and passes review;
* `-autorotate` and `-fps_mode cfr` come free, so rotation metadata and
  variable-frame-rate sources are normalised at the boundary rather than in
  our code;
* libx264 is GPL. A hosted service is not distribution, but keeping it behind a
  process boundary rather than linking it into our address space is the
  cheaper posture to defend.
"""

from __future__ import annotations


class FfmpegError(RuntimeError):
    """ffmpeg exited non-zero. Carries stderr, which is where the reason is."""
```

- [ ] **Step 2: Run it to verify it fails**

Run: `poetry run python -c "from app.video import ffmpeg; ffmpeg.assert_build()"`
Expected: FAIL with `AttributeError: module 'app.video.ffmpeg' has no attribute 'assert_build'`

- [ ] **Step 3: Write the implementation**

Create `app/video/__init__.py`:

```python
"""Video creative fit — refit a finished video ad to a screen's real resolution.

Self-contained. Nothing here imports from app.blueprint / app.plate /
app.layout, and nothing there imports from here: the image path is untouched by
design, and video is a parallel path that shares only the config object.

    ffmpeg.py    the subprocess boundary — binary discovery, build assertion, run
    probe.py     ffprobe -> VideoProbe, with the colour-tag fallback heuristic
    encode.py    H.264 level arithmetic + the encode argument list
    render.py    the fast path (stretch / crop) — one ffmpeg invocation
    pipeline.py  orchestration + content-hash caching
    check.py     golden-frame colour harness + encode assertions (the test suite)
    schemas.py   VideoProbe, VideoVariant, FitMode
"""
```

Append to `app/video/ffmpeg.py`:

```python
import logging
import shutil
import subprocess
from functools import lru_cache

from app.core.config import settings

logger = logging.getLogger(__name__)

#: Build flags we refuse to start without, and why.
#:
#: libharfbuzz is the one that matters and the one that fails silently: without
#: it ffmpeg's text path does no shaping, so Devanagari and Kannada render as
#: disconnected code points rather than raising. Nobody on the team reads
#: Kannada well enough to catch that in review, so it is asserted at startup.
REQUIRED_BUILD_FLAGS: tuple[str, ...] = ("--enable-libharfbuzz",)

#: Below this, `drawtext` predates the HarfBuzz requirement entirely.
MIN_MAJOR_VERSION = 7


@lru_cache(maxsize=1)
def binary() -> str:
    path = settings.FFMPEG_BIN or shutil.which("ffmpeg")
    if not path:
        raise FfmpegError("ffmpeg not found. Set FFMPEG_BIN or install it.")
    return path


@lru_cache(maxsize=1)
def probe_binary() -> str:
    path = settings.FFPROBE_BIN or shutil.which("ffprobe")
    if not path:
        raise FfmpegError("ffprobe not found. Set FFPROBE_BIN or install it.")
    return path


@lru_cache(maxsize=1)
def version() -> tuple[int, int]:
    out = subprocess.run(
        [binary(), "-hide_banner", "-version"],
        capture_output=True, text=True, check=False,
    ).stdout
    # "ffmpeg version 8.1.2 Copyright ..." / "ffmpeg version n7.1-..." / "...-static"
    for token in out.split():
        cleaned = token.lstrip("n")
        parts = cleaned.split(".")
        if parts[0].isdigit():
            minor = parts[1] if len(parts) > 1 and parts[1].isdigit() else "0"
            return int(parts[0]), int(minor)
    raise FfmpegError(f"Could not parse an ffmpeg version from: {out[:120]!r}")


@lru_cache(maxsize=1)
def buildconf() -> str:
    return subprocess.run(
        [binary(), "-hide_banner", "-buildconf"],
        capture_output=True, text=True, check=False,
    ).stdout


def assert_build() -> None:
    """Fail loudly at startup rather than silently at render time."""
    major, minor = version()
    if major < MIN_MAJOR_VERSION:
        raise FfmpegError(
            f"ffmpeg {major}.{minor} is too old; need >= {MIN_MAJOR_VERSION}. "
            "Debian's 5.1 predates drawtext's HarfBuzz requirement and would "
            "render Indic scripts as disconnected code points without erroring."
        )
    conf = buildconf()
    missing = [flag for flag in REQUIRED_BUILD_FLAGS if flag not in conf]
    if missing:
        raise FfmpegError(
            f"ffmpeg is missing {', '.join(missing)}. Indic text would not shape. "
            "Pin a static build that has it."
        )
    logger.info("ffmpeg %d.%d at %s — build OK", major, minor, binary())


def run(args: list[str], stdin: bytes | None = None) -> bytes:
    """Run ffmpeg with ``args`` (without the binary) and return stdout."""
    command = [binary(), "-nostdin", "-v", "error", *args]
    logger.debug("ffmpeg %s", " ".join(args))
    result = subprocess.run(command, input=stdin, capture_output=True, check=False)
    if result.returncode != 0:
        raise FfmpegError(result.stderr.decode("utf-8", "replace").strip()[:2000])
    return result.stdout


def run_probe(args: list[str]) -> str:
    command = [probe_binary(), "-v", "error", *args]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise FfmpegError(result.stderr.strip()[:2000])
    return result.stdout
```

Append to `app/core/config.py`, immediately before the `@property ai_configured` line:

```python
    # --- Video ------------------------------------------------------------
    # Explicit paths win; otherwise PATH. Set these in the container, where a
    # pinned static build lives at a known location rather than on PATH.
    FFMPEG_BIN: str | None = None
    FFPROBE_BIN: str | None = None

    # Encode settings for the delivered file. These play on physical panels, so
    # the file IS the product: CRF 17 is at/below visually lossless, and the
    # fixed 2s GOP (keyint == 2 x fps, scenecut off) gives a clean restart at
    # every loop point rather than wherever x264 felt like an I-frame.
    VIDEO_CRF: int = 17
    VIDEO_PRESET: str = "slow"
    VIDEO_GOP_SECONDS: float = 2.0

    # The AndBox Prime X4 (S905X4) decodes H.264 up to 4K High@L5.1 30fps and
    # NOT 4K60 — that is a hardware ceiling, so a job that would need L5.2 is
    # refused rather than shipped to a screen that cannot play it.
    VIDEO_MAX_LEVEL: str = "5.1"

    # Guard against a typo'd input, not a quality ceiling.
    VIDEO_MAX_UPLOAD_MB: int = 500
    VIDEO_MAX_DURATION_SECONDS: int = 120
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `poetry run python -c "from app.video import ffmpeg; ffmpeg.assert_build(); print('build OK', ffmpeg.version())"`
Expected on a correct machine: `build OK (7, 1)` or higher.
Expected on this dev machine (Homebrew ffmpeg 8.1.2, no libharfbuzz): `FfmpegError: ffmpeg is missing --enable-libharfbuzz...`

**That failure is correct and is the point of the task.** Phase A does not render text, so to continue locally set `REQUIRED_BUILD_FLAGS = ()` in your working copy *without committing it*, or install a full build: `brew install ffmpeg --with-libass` is not available on modern Homebrew, so use `brew install ffmpeg` and accept the local gap, or pull a static build from https://johnvansickle.com/ffmpeg/. The container pins a full build (Phase C).

- [ ] **Step 5: Lint and commit**

```bash
poetry run ruff check app/video app/core/config.py
git add app/video/__init__.py app/video/ffmpeg.py app/core/config.py
git commit -m "feat(video): ffmpeg subprocess boundary with startup build assertion"
```

---

### Task 2: The golden-frame colour harness

Built before any pipeline code, because a colour bug produces output that is *slightly* wrong, survives code review, and is only visible on a panel.

**Files:**
- Create: `app/video/check.py`
- Modify: `cli.py` (add the `check` subcommand)

**Interfaces:**
- Consumes: `ffmpeg.run`, `ffmpeg.run_probe` (Task 1)
- Produces: `check.golden_frame() -> CheckResult`, `check.CheckResult` (dataclass: `name: str`, `passed: bool`, `detail: str`), `check.DECODE_FILTER: str`, `check.encode_filter(...) -> str`

- [ ] **Step 1: Write the failing check**

Create `app/video/check.py`:

```python
"""The colour-correctness harness — build this before anything that renders.

A colour bug in a video pipeline does not raise. It produces a file that looks
*slightly* flat, passes review, and is only obviously wrong once it is on a
three-metre panel in a cafe. So the pipeline gets a test that fails loudly
instead.

Two independent assertions, and BOTH are required:

1. **Pixels.** Push a known pattern through decode -> raw RGB -> encode, decode
   it again, and compare patch medians.
2. **Tags.** Assert the output actually carries bt709/bt709/bt709/tv.

Why both: a naive encode with no colour handling at all round-trips at delta=1,
perfectly self-consistent, and ships an UNTAGGED file that a BT.709 panel
renders wrong. Pixel equality alone would call that a pass.

Measured on ffmpeg 8.1.2, four recipes, same source, patch-median max delta:

    scale=...out_color_matrix=bt709 + setparams   ->  1   correct AND tagged
    no -vf, no tags                               ->  1   untagged: wrong on glass
    setparams only, matrix not forced             -> 30   601-encoded, 709-tagged
    colorspace=all=bt709:iall=bt709:...           -> 40   wrong filter for RGB->YUV
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    detail: str
```

- [ ] **Step 2: Run it to verify it fails**

Run: `poetry run python -c "from app.video import check; print(check.golden_frame())"`
Expected: FAIL with `AttributeError: module 'app.video.check' has no attribute 'golden_frame'`

- [ ] **Step 3: Write the implementation**

Append to `app/video/check.py`:

```python
import json
import tempfile
from pathlib import Path

import numpy as np

from app.video import ffmpeg

#: Decode leg. Pins the input matrix/range explicitly rather than letting
#: swscale guess — on unspecified input it falls back to BT.601 limited, and
#: that silent fallback is where the shift is born. RGB is always full range,
#: hence out_range=pc.
DECODE_FILTER = (
    "scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt709:out_range=pc,"
    "format=rgb24"
)

#: Encode leg. `out_color_matrix=bt709` is the whole ballgame — without it
#: swscale encodes with its default 601 matrix while setparams tags the file
#: 709, and the decoder inverts with the wrong one. `setparams` writes the
#: tags; the `-color_*` OUTPUT FLAGS DO NOT (measured on 8.1.2: they leave
#: color_transfer and color_primaries as "unknown").
ENCODE_FILTER = (
    "scale=in_range=pc:in_color_matrix=bt709:out_range=tv:out_color_matrix=bt709,"
    "format=yuv420p,"
    "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
)

#: Patch medians on a grid, NOT per-pixel max. A CORRECT round-trip measures a
#: per-pixel max of ~20 purely from 4:2:0 chroma ringing at the hard edges
#: between colour bars; patch medians on that same correct file measure 1.
PATCH = 8
GRID_X, GRID_Y = 6, 4
PASS_DELTA = 2
WARN_DELTA = 8

EXPECTED_TAGS = {
    "color_space": "bt709",
    "color_transfer": "bt709",
    "color_primaries": "bt709",
    "color_range": "tv",
}


def _patch_medians(frame: np.ndarray) -> np.ndarray:
    """Median of a PATCH x PATCH block at each grid point, avoiding bar edges."""
    height, width, _ = frame.shape
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            cy = round(height * (gy + 0.5) / GRID_Y)
            cx = round(width * (gx + 0.5) / GRID_X)
            half = PATCH // 2
            block = frame[cy - half : cy + half, cx - half : cx + half]
            out.append(np.median(block.reshape(-1, 3), axis=0))
    return np.asarray(out)


def _decode_first_frame(path: Path, width: int, height: int) -> np.ndarray:
    raw = ffmpeg.run(
        ["-i", str(path), "-vf", DECODE_FILTER, "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    )
    return np.frombuffer(raw, np.uint8)[: width * height * 3].reshape(height, width, 3)


def _tags(path: Path) -> dict[str, str]:
    out = ffmpeg.run_probe(
        ["-select_streams", "v:0", "-show_entries",
         "stream=color_space,color_transfer,color_primaries,color_range",
         "-of", "json", str(path)]
    )
    return json.loads(out)["streams"][0]


def golden_frame(width: int = 1920, height: int = 1080) -> list[CheckResult]:
    """Generate SMPTE bars, round-trip them, assert pixels AND tags."""
    results: list[CheckResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "bars.mp4"
        roundtrip = Path(tmp) / "roundtrip.mp4"

        ffmpeg.run([
            "-y", "-f", "lavfi",
            "-i", f"smptehdbars=size={width}x{height}:rate=25:duration=1",
            "-vf", "format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:"
                   "colorspace=bt709:range=tv",
            "-c:v", "libx264", "-preset", "slow", "-crf", "10",
            "-profile:v", "high", "-an", str(source),
        ])

        before = _decode_first_frame(source, width, height)

        # The 75% white bar must decode to ~191 (0.75 * 255). If this drifts to
        # ~180 or ~204 the DECODE leg is mishandling range and nothing
        # downstream can be trusted, so it is asserted before anything else.
        white = float(np.median(before[height // 6, int(width * 0.20) : int(width * 0.24)]))
        results.append(CheckResult(
            "decode-range",
            abs(white - 191) <= 3,
            f"75% white decoded to {white:.1f}, expected ~191",
        ))

        raw = before.tobytes()
        ffmpeg.run([
            "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{width}x{height}", "-r", "25", "-i", "-",
            "-vf", ENCODE_FILTER,
            "-c:v", "libx264", "-preset", "slow", "-crf", "12",
            "-profile:v", "high", "-an", "-movflags", "+faststart", str(roundtrip),
        ], stdin=raw)

        after = _decode_first_frame(roundtrip, width, height)
        delta = float(np.abs(_patch_medians(before) - _patch_medians(after)).max())
        results.append(CheckResult(
            "golden-pixels",
            delta <= PASS_DELTA,
            f"patch-median max delta {delta:.1f} "
            f"(pass <= {PASS_DELTA}, warn <= {WARN_DELTA})",
        ))

        tags = _tags(roundtrip)
        wrong = {k: tags.get(k) for k, v in EXPECTED_TAGS.items() if tags.get(k) != v}
        results.append(CheckResult(
            "golden-tags",
            not wrong,
            "all four colour tags present" if not wrong else f"wrong/missing: {wrong}",
        ))
    return results
```

- [ ] **Step 4: Wire it into the CLI**

In `cli.py`, add this function immediately above `def main() -> None:`:

```python
def cmd_check(args) -> None:
    """Run the colour and encode harness. This repo's test suite."""
    from app.video import check

    results = check.golden_frame()
    width = max(len(r.name) for r in results)
    for result in results:
        mark = "PASS" if result.passed else "FAIL"
        print(f"  {mark}  {result.name:{width}s}  {result.detail}")
    if not all(r.passed for r in results):
        sys.exit(1)
```

and register it inside `main()`, immediately after the `p_fit.set_defaults(func=cmd_fit)` line:

```python
    p_check = sub.add_parser("check", help="colour + encode harness (the test suite)")
    p_check.set_defaults(func=cmd_check)
```

The `check` command must not require a Gemini key. Replace the guard in `main()`:

```python
    args = parser.parse_args()
    if not settings.ai_configured:
        sys.exit("GEMINI_API_KEY is not set (put it in .env).")
```

with:

```python
    args = parser.parse_args()
    # `check` exercises ffmpeg only — no model calls, so no key needed.
    if args.func is not cmd_check and not settings.ai_configured:
        sys.exit("GEMINI_API_KEY is not set (put it in .env).")
```

- [ ] **Step 5: Run the check to verify it passes**

Run: `poetry run python cli.py check`
Expected:

```
  PASS  decode-range   75% white decoded to 191.0, expected ~191
  PASS  golden-pixels  patch-median max delta 1.0 (pass <= 2, warn <= 8)
  PASS  golden-tags    all four colour tags present
```

- [ ] **Step 6: Prove the harness actually catches the bug**

This is the step that verifies the *test*, not the code. Temporarily edit `ENCODE_FILTER` in `app/video/check.py` to drop the matrix, keeping only the tags:

```python
ENCODE_FILTER = (
    "format=yuv420p,"
    "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
)
```

Run: `poetry run python cli.py check`
Expected: `FAIL  golden-pixels  patch-median max delta ~30`

Then revert the edit and re-run to confirm PASS. **Do not commit the broken filter.**

- [ ] **Step 7: Lint and commit**

```bash
poetry run ruff check app/video cli.py
git add app/video/check.py cli.py
git commit -m "feat(video): golden-frame colour harness, asserting pixels and tags"
```

---

### Task 3: Probe

**Files:**
- Create: `app/video/schemas.py`
- Create: `app/video/probe.py`

**Interfaces:**
- Consumes: `ffmpeg.run_probe` (Task 1)
- Produces: `schemas.VideoProbe` (pydantic; fields `width`, `height`, `fps`, `duration_seconds`, `codec`, `pix_fmt`, `has_audio`, `color_space`, `color_transfer`, `color_primaries`, `color_range`, `rotation`, `is_vfr`, `size_bytes`), `probe.probe(path: Path) -> VideoProbe`

- [ ] **Step 1: Write the failing check**

Create `app/video/schemas.py`:

```python
"""The artifacts the video path passes around.

Deliberately shaped like the image path's schemas: flat, pydantic, and carrying
the numbers a CMS operator needs to see rather than internal state.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class VideoProbe(BaseModel):
    """What ffprobe found, after the unspecified-tag heuristic has been applied."""

    width: int
    height: int
    fps: float
    duration_seconds: float
    codec: str
    pix_fmt: str
    has_audio: bool
    size_bytes: int | None = None

    #: Post-heuristic — never "unknown". See probe.py for how these are filled
    #: when the container does not declare them.
    color_space: str
    color_transfer: str
    color_primaries: str
    color_range: str

    #: True when the source declared no colour tags and we inferred them. The
    #: CMS surfaces this, because an inferred guess is worth telling an
    #: operator about when a result looks off.
    color_inferred: bool = False

    #: Degrees from the display matrix. ffmpeg's -autorotate (default on)
    #: applies this during filtering, so our code must NOT rotate again.
    rotation: int = 0

    #: Variable frame rate. Flattened to CFR at the decode boundary so that
    #: frame index and time stay interchangeable.
    is_vfr: bool = False


class FitMode:
    """How to get from the source shape to the target shape."""

    STRETCH = "stretch"
    CROP = "crop"
    REFRAME = "reframe"
    COMPOSE = "compose"


class VideoVariant(BaseModel):
    """One rendered target."""

    width: int
    height: int
    mode: str
    aspect_shift: float
    path: str
    duration_seconds: float | None = None
    bytes: int | None = None
    level: str | None = None
    warnings: list[str] = Field(default_factory=list)
```

Create `app/video/probe.py` with only the docstring:

```python
"""ffprobe -> VideoProbe.

Probe, never assume. A creative re-encoded elsewhere carries whatever tags that
tool felt like writing, and roughly half of real-world ad masters declare no
colour tags at all. Guessing wrong is the "video looks a bit flat" bug.
"""

from __future__ import annotations
```

- [ ] **Step 2: Run it to verify it fails**

```bash
poetry run python -c "
from pathlib import Path
from app.video import probe
print(probe.probe(Path('x.mp4')))"
```
Expected: FAIL with `AttributeError: module 'app.video.probe' has no attribute 'probe'`

- [ ] **Step 3: Write the implementation**

Append to `app/video/probe.py`:

```python
import json
import logging
from fractions import Fraction
from pathlib import Path

from app.video import ffmpeg
from app.video.schemas import VideoProbe

logger = logging.getLogger(__name__)

UNSPECIFIED = {"", "unknown", "unspecified", None}

#: Below this height a source without tags is far more likely to be SD-era
#: BT.601 than BT.709. Above it, 709 is the safe assumption.
HD_HEIGHT = 720


def _fraction(value: str | None) -> float:
    if not value or value in {"0/0", "N/A"}:
        return 0.0
    try:
        return float(Fraction(value))
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe(path: Path) -> VideoProbe:
    raw = ffmpeg.run_probe([
        "-select_streams", "v:0",
        "-show_entries",
        "stream=width,height,codec_name,pix_fmt,r_frame_rate,avg_frame_rate,"
        "color_space,color_transfer,color_primaries,color_range,duration",
        "-show_entries", "stream_side_data=rotation",
        "-show_entries", "format=duration,size,nb_streams",
        "-of", "json", str(path),
    ])
    parsed = json.loads(raw)
    if not parsed.get("streams"):
        raise ffmpeg.FfmpegError(f"No video stream in {path.name}.")
    stream = parsed["streams"][0]
    fmt = parsed.get("format", {})

    r_rate = _fraction(stream.get("r_frame_rate"))
    avg_rate = _fraction(stream.get("avg_frame_rate"))
    fps = avg_rate or r_rate
    if not fps:
        raise ffmpeg.FfmpegError(f"Could not determine a frame rate for {path.name}.")

    # r_frame_rate is the smallest rate that ticks every frame exactly; when it
    # differs meaningfully from the average, the source is variable.
    is_vfr = bool(r_rate and avg_rate and abs(r_rate - avg_rate) / max(r_rate, avg_rate) > 0.01)

    duration = float(stream.get("duration") or fmt.get("duration") or 0.0)
    if duration <= 0:
        raise ffmpeg.FfmpegError(f"Could not determine a duration for {path.name}.")

    height = int(stream["height"])
    pix_fmt = stream.get("pix_fmt") or "yuv420p"

    space = stream.get("color_space")
    transfer = stream.get("color_transfer")
    primaries = stream.get("color_primaries")
    crange = stream.get("color_range")
    inferred = any(v in UNSPECIFIED for v in (space, transfer, primaries, crange))
    if inferred:
        default = "bt709" if height >= HD_HEIGHT else "smpte170m"
        space = space if space not in UNSPECIFIED else default
        transfer = transfer if transfer not in UNSPECIFIED else default
        primaries = primaries if primaries not in UNSPECIFIED else default
        # A `yuvj*` pix_fmt literally means full range; everything else is tv.
        crange = crange if crange not in UNSPECIFIED else (
            "pc" if pix_fmt.startswith("yuvj") else "tv"
        )
        logger.info(
            "%s declared no colour tags — assuming %s/%s (height %d)",
            path.name, space, crange, height,
        )

    rotation = 0
    for side in stream.get("side_data_list", []):
        if "rotation" in side:
            rotation = int(round(float(side["rotation"]))) % 360

    return VideoProbe(
        width=int(stream["width"]),
        height=height,
        fps=fps,
        duration_seconds=duration,
        codec=stream.get("codec_name") or "unknown",
        pix_fmt=pix_fmt,
        has_audio=int(fmt.get("nb_streams", 1)) > 1,
        size_bytes=int(fmt["size"]) if fmt.get("size") else None,
        color_space=space,
        color_transfer=transfer,
        color_primaries=primaries,
        color_range=crange,
        color_inferred=inferred,
        rotation=rotation,
        is_vfr=is_vfr,
    )
```

- [ ] **Step 4: Run the check to verify it passes**

Generate a known input and probe it:

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import ffmpeg, probe
out = Path("/tmp/probe_test.mp4")
ffmpeg.run(["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=3",
            "-vf", "format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:"
                   "colorspace=bt709:range=tv",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", str(out)])
print(probe.probe(out).model_dump_json(indent=2))
PY
```

Expected: `width: 1920`, `height: 1080`, `fps: 30.0`, `duration_seconds: ~3.0`, `codec: "h264"`, `has_audio: false`, all four colour fields `bt709`/`tv`, `color_inferred: false`, `is_vfr: false`.

- [ ] **Step 5: Verify the inference path fires**

Re-encode with no colour handling at all, then probe:

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import ffmpeg, probe
out = Path("/tmp/probe_untagged.mp4")
ffmpeg.run(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=25:duration=2",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", str(out)])
p = probe.probe(out)
print("inferred:", p.color_inferred, "| space:", p.color_space, "| range:", p.color_range)
PY
```

Expected: `inferred: True | space: smpte170m | range: tv` — 480-line source falls below `HD_HEIGHT`, so it infers BT.601 rather than 709.

- [ ] **Step 6: Lint and commit**

```bash
poetry run ruff check app/video
git add app/video/schemas.py app/video/probe.py
git commit -m "feat(video): ffprobe wrapper with colour-tag inference and VFR detection"
```

---

### Task 4: H.264 level arithmetic

The one piece of pure logic in Phase A, and the one that silently ships an unplayable file if it is wrong.

**Files:**
- Create: `app/video/encode.py`

**Interfaces:**
- Consumes: `settings.VIDEO_*` (Task 1)
- Produces: `encode.h264_level(width: int, height: int, fps: float) -> str`, `encode.LevelTooHigh`, `encode.encode_args(width, height, fps, level=None) -> list[str]`

- [ ] **Step 1: Write the failing check**

Create `app/video/encode.py`:

```python
"""H.264 level arithmetic and the encode argument list.

The level is not cosmetic. Declare one the decoder cannot meet and an Amlogic
box either refuses the stream or silently drops to a software decoder that
cannot keep up — either way the panel shows a stutter or a black screen, and
neither failure reaches us.

The arithmetic, so it can be checked by hand:

    macroblocks/frame = ceil(w/16) * ceil(h/16)
    macroblocks/sec   = macroblocks/frame * fps

    1920x1080  = 120 x 68  =  8,160 mb  @30 =   244,800 mb/s -> level 4.0
    2560x960   = 160 x 60  =  9,600 mb  @30 =   288,000 mb/s -> level 5.0  (NOT 4.2)
    3840x2160  = 240 x 135 = 32,400 mb  @30 =   972,000 mb/s -> level 5.1  (at the ceiling)
    3840x2160  = 240 x 135 = 32,400 mb  @60 = 1,944,000 mb/s -> level 5.2  REFUSED

2560x960 is the trap: it exceeds level 4.2's 8,704 macroblock limit, so the
level you would reach for by habit is wrong.
"""

from __future__ import annotations


class LevelTooHigh(ValueError):
    """The target needs a level the player cannot decode."""
```

- [ ] **Step 2: Run it to verify it fails**

```bash
poetry run python -c "from app.video import encode; print(encode.h264_level(1920,1080,30))"
```
Expected: FAIL with `AttributeError: module 'app.video.encode' has no attribute 'h264_level'`

- [ ] **Step 3: Write the implementation**

Append to `app/video/encode.py`:

```python
import math

from app.core.config import settings

#: (level, MaxFS macroblocks/frame, MaxMBPS macroblocks/sec). Ordered, so the
#: first row that fits is the lowest level that will play.
H264_LEVELS: tuple[tuple[str, int, int], ...] = (
    ("3.0", 1620, 40500),
    ("3.1", 3600, 108000),
    ("3.2", 5120, 216000),
    ("4.0", 8192, 245760),
    ("4.1", 8192, 245760),
    ("4.2", 8704, 522240),
    ("5.0", 22080, 589824),
    ("5.1", 36864, 983040),
    ("5.2", 36864, 2073600),
)


def _level_rank(level: str) -> int:
    for index, (name, _, _) in enumerate(H264_LEVELS):
        if name == level:
            return index
    raise ValueError(f"Unknown H.264 level {level!r}")


def h264_level(width: int, height: int, fps: float) -> str:
    """Lowest level that can carry this resolution and frame rate."""
    macroblocks = math.ceil(width / 16) * math.ceil(height / 16)
    per_second = macroblocks * fps
    ceiling = _level_rank(settings.VIDEO_MAX_LEVEL)

    for index, (name, max_fs, max_mbps) in enumerate(H264_LEVELS):
        if macroblocks <= max_fs and per_second <= max_mbps:
            if index > ceiling:
                raise LevelTooHigh(
                    f"{width}x{height}@{fps:g} needs H.264 level {name}, but the "
                    f"player tops out at {settings.VIDEO_MAX_LEVEL}. "
                    "Reduce the frame rate to 30, or deliver HEVC."
                )
            return name
    raise LevelTooHigh(f"{width}x{height}@{fps:g} exceeds every defined H.264 level.")


def encode_args(width: int, height: int, fps: float, level: str | None = None) -> list[str]:
    """The x264 argument list for a delivered file.

    Conservative reference structure on purpose: weak SoC decoders have a small
    DPB and b-pyramid is the first thing that trips them. The GOP is fixed and
    scenecut is off so every loop restart lands on a keyframe rather than
    wherever x264 decided a scene changed.
    """
    if width % 2 or height % 2:
        raise ValueError(
            f"{width}x{height} has an odd dimension; yuv420p has no integer "
            "chroma plane for it. Round to even before encoding."
        )
    resolved = level or h264_level(width, height, fps)
    keyint = max(1, round(fps * settings.VIDEO_GOP_SECONDS))
    return [
        "-c:v", "libx264",
        "-profile:v", "high",
        "-level:v", resolved,
        "-preset", settings.VIDEO_PRESET,
        "-crf", str(settings.VIDEO_CRF),
        "-x264-params",
        f"keyint={keyint}:min-keyint={keyint}:scenecut=0:bframes=2:ref=3:b-pyramid=none",
        "-movflags", "+faststart",
        "-an",
    ]
```

- [ ] **Step 4: Run the check to verify it passes**

```bash
poetry run python - <<'PY'
from app.video import encode
cases = [(1920,1080,30,"4.0"), (2560,960,30,"5.0"), (3840,2160,30,"5.1"), (1280,720,25,"3.1")]
for w,h,f,want in cases:
    got = encode.h264_level(w,h,f)
    print(("PASS" if got==want else "FAIL"), f"{w}x{h}@{f} -> {got} (want {want})")
try:
    encode.h264_level(3840,2160,60)
    print("FAIL 4K60 was accepted")
except encode.LevelTooHigh as e:
    print("PASS 4K60 refused:", str(e)[:60])
try:
    encode.encode_args(1921,1080,30)
    print("FAIL odd width accepted")
except ValueError:
    print("PASS odd width refused")
PY
```

Expected: six `PASS` lines, no `FAIL`.

- [ ] **Step 5: Lint and commit**

```bash
poetry run ruff check app/video
git add app/video/encode.py
git commit -m "feat(video): H.264 level arithmetic with a player ceiling that refuses 4K60"
```

---

### Task 5: The fast path renderer

**Files:**
- Create: `app/video/render.py`

**Interfaces:**
- Consumes: `probe.probe`, `encode.encode_args`, `encode.h264_level`, `ffmpeg.run`, `schemas.VideoProbe`, `schemas.VideoVariant`, `schemas.FitMode`
- Produces: `render.aspect_shift(sw, sh, dw, dh) -> float`, `render.fit_mode(sw, sh, dw, dh) -> str`, `render.render_fast(source: Path, out: Path, probe_data: VideoProbe, width: int, height: int) -> VideoVariant`

- [ ] **Step 1: Write the failing check**

Create `app/video/render.py`:

```python
"""The fast path — one ffmpeg invocation, no Python in the frame loop.

This is the biggest cost lever in the whole design. Most bookings are a small
shape change (1920x1080 onto a 1920x1080 panel, or a mild crop), and for those
there is nothing to analyse and nothing to rebuild: decoding 600 frames into
numpy to put them back unchanged would be pure waste.

The three-tier rule is copied from the image path (app/layout/rules.py) because
it was measured there, and the measurement holds for video:

    shift <= STRETCH_TOLERANCE  stretch to the exact target. Nothing cropped,
                                nothing lost, distortion under a few percent.
    <= ASPECT_TOLERANCE         scale + centre-crop. Past ~8% a stretch starts
                                to visibly oval a round logo.
    above that                  needs a real rebuild -> not this module.
"""

from __future__ import annotations
```

- [ ] **Step 2: Run it to verify it fails**

```bash
poetry run python -c "from app.video import render; print(render.fit_mode(1920,1080,1920,1080))"
```
Expected: FAIL with `AttributeError: module 'app.video.render' has no attribute 'fit_mode'`

- [ ] **Step 3: Write the implementation**

Append to `app/video/render.py`:

```python
import logging
from pathlib import Path

from app.core.config import settings
from app.video import encode, ffmpeg
from app.video.schemas import FitMode, VideoProbe, VideoVariant

logger = logging.getLogger(__name__)


class NeedsRebuild(RuntimeError):
    """The shape gap is past the fast path. Phase B+ handles these."""


def aspect_shift(src_w: int, src_h: int, dst_w: int, dst_h: int) -> float:
    """How far apart two shapes are. Symmetric, and 1.0 when they match."""
    src = src_w / src_h
    dst = dst_w / dst_h
    return max(src, dst) / min(src, dst)


def fit_mode(src_w: int, src_h: int, dst_w: int, dst_h: int) -> str:
    shift = aspect_shift(src_w, src_h, dst_w, dst_h)
    if shift <= settings.STRETCH_TOLERANCE:
        return FitMode.STRETCH
    if shift <= settings.ASPECT_TOLERANCE:
        return FitMode.CROP
    return FitMode.REFRAME


def render_fast(
    source: Path, out: Path, probe_data: VideoProbe, width: int, height: int
) -> VideoVariant:
    """Render a stretch or crop target in a single ffmpeg pass."""
    if width % 2 or height % 2:
        raise ValueError(f"Target {width}x{height} must have even dimensions.")

    mode = fit_mode(probe_data.width, probe_data.height, width, height)
    if mode not in (FitMode.STRETCH, FitMode.CROP):
        raise NeedsRebuild(
            f"{probe_data.width}x{probe_data.height} -> {width}x{height} is a "
            f"{aspect_shift(probe_data.width, probe_data.height, width, height):.2f}x "
            "shift; the fast path only covers stretch and crop."
        )

    fps = min(probe_data.fps, 30.0)
    level = encode.h264_level(width, height, fps)

    if mode == FitMode.STRETCH:
        geometry = f"scale={width}:{height}"
    else:
        # increase + crop == cover: fill the frame, trim the overflow.
        geometry = (
            f"scale=w={width}:h={height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}"
        )

    # Colour is converted AND tagged in one chain. The conversion is the scale
    # filter's in_/out_ options; the tags are setparams. Doing only the tags
    # produces a 601-encoded file labelled 709 — see check.py.
    source_range = probe_data.color_range if probe_data.color_range in ("tv", "pc") else "tv"
    video_filter = (
        f"{geometry},"
        f"scale=in_color_matrix={probe_data.color_space}:in_range={source_range}:"
        f"out_color_matrix=bt709:out_range=tv,"
        f"format=yuv420p,"
        f"setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
    )

    ffmpeg.run([
        "-y", "-i", str(source),
        "-vf", video_filter,
        "-fps_mode", "cfr", "-r", f"{fps:g}",
        *encode.encode_args(width, height, fps, level=level),
        str(out),
    ])

    warnings: list[str] = []
    if probe_data.color_inferred:
        warnings.append(
            "Source declared no colour tags; assumed "
            f"{probe_data.color_space}/{probe_data.color_range}."
        )
    if probe_data.is_vfr:
        warnings.append(f"Source was variable frame rate; flattened to {fps:g}fps.")
    if probe_data.has_audio:
        warnings.append("Audio stripped (panels are silent).")

    logger.info(
        "%s %dx%d -> %dx%d level %s", mode, probe_data.width, probe_data.height,
        width, height, level,
    )
    return VideoVariant(
        width=width, height=height, mode=mode,
        aspect_shift=aspect_shift(probe_data.width, probe_data.height, width, height),
        path=str(out),
        duration_seconds=probe_data.duration_seconds,
        bytes=out.stat().st_size if out.exists() else None,
        level=level,
        warnings=warnings,
    )
```

- [ ] **Step 4: Run the check to verify it passes**

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import ffmpeg, probe, render
src = Path("/tmp/fast_src.mp4")
ffmpeg.run(["-y","-f","lavfi","-i","testsrc2=size=1920x1080:rate=30:duration=3",
            "-vf","format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:"
                  "colorspace=bt709:range=tv",
            "-c:v","libx264","-preset","fast","-crf","20","-an",str(src)])
p = probe.probe(src)
for w,h in [(1920,1080),(1600,900),(2560,960)]:
    out = Path(f"/tmp/fast_{w}x{h}.mp4")
    try:
        v = render.render_fast(src, out, p, w, h)
        print(f"PASS {w}x{h} mode={v.mode} shift={v.aspect_shift:.2f} level={v.level}")
    except render.NeedsRebuild as e:
        print(f"PASS {w}x{h} correctly refused: {str(e)[:50]}")
PY
```

Expected:
```
PASS 1920x1080 mode=stretch shift=1.00 level=4.0
PASS 1600x900 mode=stretch shift=1.00 level=4.0
PASS 2560x960 correctly refused: 1920x1080 -> 2560x960 is a 1.50x shift
```

- [ ] **Step 5: Verify the rendered file is panel-legal**

```bash
ffprobe -v error -select_streams v:0 -show_entries \
  stream=codec_name,profile,level,pix_fmt,width,height,color_space,color_transfer,color_primaries,color_range \
  -show_entries format=nb_streams -of json /tmp/fast_1920x1080.mp4
```

Expected: `"profile": "High"`, `"level": 40` (an **integer**, not `"4.0"`), `"pix_fmt": "yuv420p"`, all four colour fields `bt709`/`tv`, `"nb_streams": 1`.

Then confirm faststart:

```bash
poetry run python -c "
d=open('/tmp/fast_1920x1080.mp4','rb').read(4_000_000)
m,x=d.find(b'moov'),d.find(b'mdat')
print('PASS faststart' if 0<=m<x else 'FAIL not faststart', f'(moov@{m} mdat@{x})')"
```
Expected: `PASS faststart`

- [ ] **Step 6: Lint and commit**

```bash
poetry run ruff check app/video
git add app/video/render.py
git commit -m "feat(video): fast-path renderer for the stretch and crop tiers"
```

---

### Task 6: Pipeline orchestration and CLI dispatch

**Files:**
- Create: `app/video/pipeline.py`
- Modify: `cli.py`

**Interfaces:**
- Consumes: everything above
- Produces: `pipeline.creative_id_for(data: bytes) -> str`, `pipeline.creative_dir(creative_id: str) -> Path`, `pipeline.fit_video(data: bytes, targets: list[tuple[int,int]], force: bool=False) -> tuple[str, VideoProbe, list[VideoVariant]]`

- [ ] **Step 1: Write the failing check**

Create `app/video/pipeline.py`:

```python
"""Orchestration — probe once, render many.

Mirrors app/pipeline.py's split and its content-hash caching, for the same
reason: the expensive stages run once per creative, and a new screen shape is
then a cheap render. In Phase A only the probe is cached, because the fast path
has no analysis to reuse; Phase B adds shots.json, blueprint.json and the
erased plate under the same key.
"""

from __future__ import annotations
```

- [ ] **Step 2: Run it to verify it fails**

```bash
poetry run python -c "from app.video import pipeline; print(pipeline.fit_video)"
```
Expected: FAIL with `AttributeError: module 'app.video.pipeline' has no attribute 'fit_video'`

- [ ] **Step 3: Write the implementation**

Append to `app/video/pipeline.py`:

```python
import hashlib
import logging
from pathlib import Path

from app.core.config import settings
from app.video import probe as probe_module
from app.video import render
from app.video.schemas import VideoProbe, VideoVariant

logger = logging.getLogger(__name__)

SOURCE = "source.mp4"
PROBE = "probe.json"


def creative_id_for(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:20]


def creative_dir(creative_id: str) -> Path:
    path = settings.WORK_DIR / creative_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _variant_name(width: int, height: int) -> str:
    return f"var_{width}x{height}.mp4"


def ingest(data: bytes, force: bool = False) -> tuple[str, Path, VideoProbe]:
    """Park the source and probe it. Cached by content hash."""
    if len(data) > settings.VIDEO_MAX_UPLOAD_MB * 1024 * 1024:
        raise ValueError(f"Video exceeds the {settings.VIDEO_MAX_UPLOAD_MB}MB limit.")

    creative_id = creative_id_for(data)
    folder = creative_dir(creative_id)
    source = folder / SOURCE
    probe_path = folder / PROBE

    if not source.exists():
        source.write_bytes(data)

    if not force and probe_path.exists():
        logger.info("probe cache hit for %s", creative_id)
        return creative_id, source, VideoProbe.model_validate_json(probe_path.read_text())

    probe_data = probe_module.probe(source)
    if probe_data.duration_seconds > settings.VIDEO_MAX_DURATION_SECONDS:
        raise ValueError(
            f"Video is {probe_data.duration_seconds:.1f}s; the limit is "
            f"{settings.VIDEO_MAX_DURATION_SECONDS}s."
        )
    probe_path.write_text(probe_data.model_dump_json(indent=2))
    return creative_id, source, probe_data


def fit_video(
    data: bytes, targets: list[tuple[int, int]], force: bool = False
) -> tuple[str, VideoProbe, list[VideoVariant]]:
    creative_id, source, probe_data = ingest(data, force=force)
    folder = creative_dir(creative_id)

    variants: list[VideoVariant] = []
    for width, height in targets:
        out = folder / _variant_name(width, height)
        if not force and out.exists():
            logger.info("variant cache hit for %dx%d", width, height)
        variants.append(render.render_fast(source, out, probe_data, width, height))
    return creative_id, probe_data, variants


def parse_target(value: str) -> tuple[int, int]:
    """'1080x2400' -> (1080, 2400)."""
    try:
        width, height = value.lower().split("x")
        parsed = (int(width), int(height))
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"bad resolution {value!r}, expected WIDTHxHEIGHT") from exc
    if parsed[0] < 1 or parsed[1] < 1:
        raise ValueError(f"bad resolution {value!r}")
    if max(parsed) > settings.MAX_OUTPUT_EDGE:
        raise ValueError(
            f"{value} exceeds the {settings.MAX_OUTPUT_EDGE}px limit on the long edge"
        )
    return parsed
```

- [ ] **Step 4: Wire the CLI to sniff and dispatch**

In `cli.py`, add above `def cmd_fit(args) -> None:`:

```python
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}


def cmd_fit_video(args) -> None:
    """The video path. Same command, sniffed from the file."""
    from app.video import pipeline as video_pipeline

    targets = [video_pipeline.parse_target(t) for t in args.targets]
    creative_id, probe_data, variants = video_pipeline.fit_video(
        _load(args.image), targets, force=args.force
    )
    print(f"creative_id: {creative_id}")
    print(f"artifacts:   {video_pipeline.creative_dir(creative_id)}")
    print(
        f"\nsource: {probe_data.width}x{probe_data.height} "
        f"{probe_data.fps:g}fps {probe_data.duration_seconds:.2f}s "
        f"{probe_data.codec} audio={'yes' if probe_data.has_audio else 'no'}"
    )
    print("\nvariants:")
    for variant in variants:
        print(
            f"  {variant.width}x{variant.height:<6d} {variant.mode:9s} "
            f"shift={variant.aspect_shift:.2f}x  level={variant.level:4s} "
            f"{Path(variant.path).name}"
        )
        for warning in variant.warnings:
            print(f"      note: {warning}")
```

Then make `cmd_fit` dispatch — replace its first line:

```python
def cmd_fit(args) -> None:
    targets = [pipeline.parse_target(t) for t in args.targets]
```

with:

```python
def cmd_fit(args) -> None:
    if args.image.suffix.lower() in VIDEO_SUFFIXES:
        return cmd_fit_video(args)
    targets = [pipeline.parse_target(t) for t in args.targets]
```

- [ ] **Step 5: Run the check to verify it passes**

```bash
poetry run python - <<'PY'
from pathlib import Path
from app.video import ffmpeg
ffmpeg.run(["-y","-f","lavfi","-i","testsrc2=size=1920x1080:rate=30:duration=5",
            "-vf","format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:"
                  "colorspace=bt709:range=tv",
            "-c:v","libx264","-preset","fast","-crf","20","-an","/tmp/ad.mp4"])
PY
poetry run python cli.py fit /tmp/ad.mp4 1920x1080 1600x900
```

Expected:
```
creative_id: <20 hex chars>
artifacts:   .work/<id>

source: 1920x1080 30fps 5.00s h264 audio=no

variants:
  1920x1080   stretch   shift=1.00x  level=4.0  var_1920x1080.mp4
  1600x900    stretch   shift=1.00x  level=4.0  var_1600x900.mp4
```

Then confirm the image path is untouched:

```bash
poetry run python cli.py fit .work/<any-existing-image-id>/source.png 1920x1080
```
Expected: the image pipeline runs exactly as before.

- [ ] **Step 6: Confirm caching works**

Re-run the same video command and check the log shows `probe cache hit`:

```bash
poetry run python cli.py fit /tmp/ad.mp4 1920x1080 2>&1 | head -3
```
Expected: completes in well under a second, with no re-probe.

- [ ] **Step 7: Lint and commit**

```bash
poetry run ruff check app/video cli.py
git add app/video/pipeline.py cli.py
git commit -m "feat(video): pipeline orchestration and CLI dispatch by file type"
```

---

### Task 7: Encode assertions in the check harness

Closes the loop: `python cli.py check` now verifies both colour *and* that a rendered file is panel-legal.

**Files:**
- Modify: `app/video/check.py`
- Modify: `cli.py` (extend `cmd_check`)

**Interfaces:**
- Consumes: `render.render_fast`, `probe.probe`, `encode.h264_level`
- Produces: `check.encode_assertions(width: int, height: int, fps: float) -> list[CheckResult]`, `check.run_all() -> list[CheckResult]`

- [ ] **Step 1: Write the failing check**

Run: `poetry run python -c "from app.video import check; check.run_all()"`
Expected: FAIL with `AttributeError: module 'app.video.check' has no attribute 'run_all'`

- [ ] **Step 2: Write the implementation**

Append to `app/video/check.py`:

```python
def encode_assertions(width: int = 1920, height: int = 1080, fps: float = 30.0
                      ) -> list[CheckResult]:
    """Render a real target and assert the file a panel would actually receive."""
    # Imported here, not at module scope: check.py is the harness that tests
    # render.py, so a module-level import would make the dependency circular.
    from app.video import encode, probe as probe_module, render

    results: list[CheckResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "src.mp4"
        out = Path(tmp) / "out.mp4"
        ffmpeg.run([
            "-y", "-f", "lavfi",
            "-i", f"testsrc2=size={width}x{height}:rate={fps:g}:duration=2",
            "-vf", "format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:"
                   "colorspace=bt709:range=tv",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", str(source),
        ])
        source_probe = probe_module.probe(source)
        render.render_fast(source, out, source_probe, width, height)

        raw = ffmpeg.run_probe([
            "-select_streams", "v:0", "-show_entries",
            "stream=profile,level,pix_fmt,width,height,codec_type",
            "-show_entries", "format=nb_streams", "-of", "json", str(out),
        ])
        parsed = json.loads(raw)
        stream = parsed["streams"][0]

        expected_level = encode.h264_level(width, height, fps)
        # ffprobe reports the level as an INTEGER: 4.0 -> 40, 5.1 -> 51.
        expected_int = int(round(float(expected_level) * 10))
        results.append(CheckResult(
            "encode-level",
            stream.get("level") == expected_int,
            f"level {stream.get('level')} (expected {expected_int} for "
            f"{width}x{height}@{fps:g})",
        ))
        # `-preset ultrafast` SILENTLY overrides `-profile:v high`, yielding
        # Constrained Baseline: no CABAC, no B-frames, measurably worse at the
        # same bitrate. Nothing else in the pipeline would catch it.
        results.append(CheckResult(
            "encode-profile", stream.get("profile") == "High",
            f"profile {stream.get('profile')!r} (expected 'High')",
        ))
        results.append(CheckResult(
            "encode-pix-fmt", stream.get("pix_fmt") == "yuv420p",
            f"pix_fmt {stream.get('pix_fmt')!r}",
        ))
        results.append(CheckResult(
            "encode-even-dims",
            stream["width"] % 2 == 0 and stream["height"] % 2 == 0,
            f"{stream['width']}x{stream['height']}",
        ))
        results.append(CheckResult(
            "encode-no-audio",
            int(parsed["format"]["nb_streams"]) == 1,
            f"{parsed['format']['nb_streams']} stream(s)",
        ))

        head = out.read_bytes()[:4_000_000]
        moov, mdat = head.find(b"moov"), head.find(b"mdat")
        results.append(CheckResult(
            "encode-faststart", 0 <= moov < mdat,
            f"moov@{moov} mdat@{mdat}",
        ))
    return results


def run_all() -> list[CheckResult]:
    return [*golden_frame(), *encode_assertions()]
```

- [ ] **Step 3: Point the CLI at `run_all`**

In `cli.py`, change the one line inside `cmd_check`:

```python
    results = check.golden_frame()
```

to:

```python
    results = check.run_all()
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `poetry run python cli.py check`
Expected:

```
  PASS  decode-range      75% white decoded to 191.0, expected ~191
  PASS  golden-pixels     patch-median max delta 1.0 (pass <= 2, warn <= 8)
  PASS  golden-tags       all four colour tags present
  PASS  encode-level      level 40 (expected 40 for 1920x1080@30)
  PASS  encode-profile    profile 'High' (expected 'High')
  PASS  encode-pix-fmt    pix_fmt 'yuv420p'
  PASS  encode-even-dims  1920x1080
  PASS  encode-no-audio   1 stream(s)
  PASS  encode-faststart  moov@36 mdat@1194
```

- [ ] **Step 5: Prove the profile assertion catches the ultrafast trap**

In `app/core/config.py`, temporarily set `VIDEO_PRESET: str = "ultrafast"`, then run:

Run: `poetry run python cli.py check`
Expected: `FAIL  encode-profile  profile 'Constrained Baseline' (expected 'High')`

Revert to `"slow"` and re-run to confirm PASS. **Do not commit `ultrafast`.**

- [ ] **Step 6: Lint and commit**

```bash
poetry run ruff check app/video cli.py
git add app/video/check.py cli.py
git commit -m "feat(video): encode assertions covering level, profile, pix_fmt and faststart"
```

---

### Task 8: Document the video path

**Files:**
- Modify: `markai-creative-fit/CLAUDE.md`

- [ ] **Step 1: Replace the "images only" paragraph**

The current text reads:

```markdown
**Images only. There is no video path.** Do not add one without a decision — video
faithful re-layout needs per-frame inpainting and temporal consistency, and the best
open-source video inpainter (ProPainter) is non-commercial licensed.
```

Replace it with:

```markdown
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
```

- [ ] **Step 2: Add the video section**

Append to `markai-creative-fit/CLAUDE.md`, immediately before `## Dependency trap`:

```markdown
## The video path (`app/video/`)

```
probe.py     ffprobe -> VideoProbe. Probe, never assume: half of real ad masters
             declare no colour tags, and guessing wrong is the "looks flat" bug.
encode.py    H.264 level arithmetic. 2560x960 needs level 5.0, NOT the 4.2 you
             would reach for by habit — it exceeds 4.2's 8,704-macroblock limit.
render.py    the fast path: stretch/crop in one ffmpeg pass, no Python per frame.
check.py     the test suite. There is no pytest here; `python cli.py check` is it.
pipeline.py  probe once, render many — same split and cache key as app/pipeline.py.
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
3. **`-preset ultrafast` silently overrides `-profile:v high`** and yields Constrained
   Baseline — no CABAC, no B-frames. A one-word change that measurably degrades a
   premium panel, caught only by asserting `profile == High`.
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

### Verifying the video path

```bash
python cli.py check                              # colour + encode harness
python cli.py fit ad.mp4 1920x1080 1600x900      # same command as images
```

`check` must pass before any commit that touches `app/video/`. It needs no Gemini key.
```

- [ ] **Step 3: Verify the docs match reality**

Run: `poetry run python cli.py check && poetry run python cli.py fit /tmp/ad.mp4 1920x1080`
Expected: both succeed, exactly as the docs claim.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the video path decision and its load-bearing rules"
```

---

## What Phase A deliberately does not do

Stated so a reviewer does not read these as omissions:

- **No reframe or compose tier.** A shift above 1.25× raises `NeedsRebuild`. Phase D.
- **No shot detection, no `VideoBlueprint`, no Gemini call.** Phase B.
- **No erase router, no LaMa, no text rescue.** Phase C.
- **No duration/slot fitting.** Phase D.
- **No API endpoints.** `app/api/router.py` is untouched; the CLI is the whole surface.
- **No CMS or signage-api changes.** Separate plans, and both depend on this one's contract.

Phase A is nonetheless shippable on its own: it correctly and verifiably refits video for the majority of real bookings, where source and panel are close in shape.

## Subsequent phases

| Phase | Delivers | Depends on |
|---|---|---|
| **B — Analysis** | `scdet` shot segmentation, `VideoBlueprint` via Gemini on keyframes, text tracking with union/percentile geometry, static tests A/B/C, `--report` | A |
| **C — Erase** | The four-branch router (clean plate / alpha inversion / temporal median / per-frame LaMa), flicker metric, `--overlay` | B |
| **D — Rebuild** | Reframe tier with L1 camera path, compose tier, duration/slot fitting, `--sheet`, `--compare` | C |
| **E — Service** | `/api/video/*` endpoints, Cloud Run deployment, then the signage-api and CMS plans | D |

Before Phase C, close open item 1 from the spec by measuring **LaMa CPU inference time** and **OpenCV DIS at true 1080p** on the real Cloud Run shape — no published benchmark exists for either, and the phase's worker sizing depends on both.
