# Video Creative Fit — Plan A (port the engine into signage-api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A video file on disk can be refit to a target resolution by a Python call inside `markai-signage-api`, and `poetry run python scripts/video_check.py` prints **16/16**. Nothing else. No job table, no agent, no routes, no CMS — those are Plans B and C.

**Architecture:** `markai-creative-fit/app/video/` (25 modules, 8,152 lines) moves into `markai-signage-api/app/video/` as a self-contained package. It reaches outside itself for exactly one thing — `app.core.config.settings` — because signage-api has a settings object too. The two modules it used to borrow from the image repo (`app/core/fonts.py`, `app/plate/lama.py`) and the one helper it needed (`app/core/models.ensure_weights`) become `app/video/fonts.py`, `app/video/lama.py`, `app/video/weights.py`, so the package has no edge into `app/creative_fit/` at all. `torch` enters the process only when `app/video/erase/plate.py` is imported, and that import is lazy at every call site — the FastAPI process never pays for it.

**Tech Stack:** Python 3.12, Poetry 2.2.1, ffmpeg/ffprobe 7.1.5 (Debian trixie) as a subprocess, Pillow 11, numpy 2.x, torch 2.5 (CPU wheel only), google-genai (already present via `pydantic-ai-slim[google]`).

## Global Constraints

- **THE FREEZE:** `markai-signage-api/app/creative_fit/` image behaviour must not change. Plan A's only permitted edit to an existing signage-api file is **additive settings** in `app/core/config.py`.
- **Forbidden everywhere:** editing `service.execute_job`, `service._sniff`, `service._run_rebuild`, `service.resolve_source`, `resizer.py`, `gemini_image.py`, `agent.py`, `prompts.py`, `analysis.py`. Video gets its OWN modules; where video needs something image has, DUPLICATE it.
- **Plan A touches no other existing signage-api file** — not `models.py`, not `worker.py`, not `router.py`, not `schemas.py`, not `service.py`, not `app/main.py`. Those belong to Plan B.
- **`app/video/**` is copied verbatim** except the six edits this plan spells out line by line: two import rewrites (Task 3 Steps 5–6), two font-path rewrites (Task 5 Steps 3–4), and two settings-name rewrites plus the model-id fix (Task 6 Steps 1–3). Do not refactor, rename or "tidy" ported code.
- **torch must stay lazily imported.** Nothing reachable from `import app.main` may pull `torch` into `sys.modules`. This is the condition the user accepted torch-in-the-API-image on. **Task 8 is its guard** — re-run it after any later change to `app/video/` or `app/main.py`.
- **No pytest.** Verification is `poetry run ruff check app/`, `poetry run python -c "..."` import/assert checks, and `poetry run python scripts/video_check.py`. Do not write pytest.
- **`scripts/video_check.py` needs NO Gemini key** and downloads no model weights. If a step ever wants a key, that step is wrong.
- **Tell the user BEFORE anything makes a real Gemini API call.** Nothing in Plan A should.
- **Do NOT run git write commands.** The user works uncommitted. End every task with a lint/verify step, never a commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `markai-signage-api/pyproject.toml` | MODIFY — `numpy`, CPU-only `torch`, the `pytorch-cpu` explicit source |
| `markai-signage-api/Dockerfile` | MODIFY — `ffmpeg` in the apt line |
| `markai-signage-api/app/video/**` | CREATE — 25 modules copied from `markai-creative-fit/app/video/**` |
| `markai-signage-api/app/video/fonts.py` | CREATE — was `markai-creative-fit/app/core/fonts.py` |
| `markai-signage-api/app/video/lama.py` | CREATE — was `markai-creative-fit/app/plate/lama.py` |
| `markai-signage-api/app/video/weights.py` | CREATE — was `markai-creative-fit/app/core/models.py` (`ensure_weights` only) |
| `markai-signage-api/app/core/config.py` | MODIFY — additive `VIDEO_*` block + two `mkdir` lines |
| `markai-signage-api/.env.example` | MODIFY — additive `VIDEO_*` block |
| `markai-signage-api/assets/fonts/**` | CREATE — 16 TTFs, 10 MB, copied from `markai-creative-fit/assets/fonts/**` |
| `markai-signage-api/scripts/video_check.py` | CREATE — the 16-check entrypoint |
| `markai-signage-api/CLAUDE.md` | MODIFY — append a `## Video Creative Fit` section at the end |

---

### Task 1: CPU-only torch + numpy in signage-api's pyproject

**Files:**
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/pyproject.toml` (dependency list ends at line 31 `reportlab = "^5.0.0"`; `[tool.poetry.group.dev.dependencies]` starts at line 33)
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/poetry.lock` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: `import torch`, `import numpy` resolvable inside the signage-api venv and inside the Cloud Run image, with **no** `nvidia-*` CUDA packages in the lock.

- [ ] **Step 1: Add the two dependency lines.** In `/Users/akshat/projects/MarkAi/markai-signage-api/pyproject.toml`, replace the line `reportlab = "^5.0.0"` with:

```toml
reportlab = "^5.0.0"
# --- Video Creative Fit (app/video/) ---------------------------------------
# numpy is the frame buffer for every per-pixel stage (erase, compose, reframe).
numpy = "^2.1.0"
# LaMa is a TorchScript checkpoint loaded directly (app/video/lama.py). We do NOT
# depend on `simple-lama-inpainting`: it declares numpy<2 / pillow<10, which Poetry
# enforces even though the model runs fine past both.
#
# Routed per platform on purpose. PyPI's LINUX torch wheel declares the whole
# nvidia-cu* stack (~2 GB) as hard dependencies, which would land in the Cloud Run
# image for a service that has no GPU; download.pytorch.org/whl/cpu ships the same
# torch with those deps stripped. On macOS/Windows the PyPI wheel is ALREADY
# CPU-only, and the cpu index does not reliably carry darwin wheels — so the dev
# machine keeps resolving from PyPI.
torch = [
    { version = "^2.5.0", source = "pytorch-cpu", markers = "sys_platform == 'linux'" },
    { version = "^2.5.0", source = "pypi", markers = "sys_platform != 'linux'" },
]
```

- [ ] **Step 2: Add the supplemental source.** A `[[tool.poetry.source]]` array table must close the `[tool.poetry.dependencies]` table, so it goes **between** the dependency list and the dev group. In the same file, replace the line `[tool.poetry.group.dev.dependencies]` with:

```toml
# `priority = "explicit"` means Poetry NEVER searches this index unless a
# dependency names it (the `source = "pytorch-cpu"` above). Anything else would
# let it shadow PyPI for unrelated packages.
[[tool.poetry.source]]
name = "pytorch-cpu"
url = "https://download.pytorch.org/whl/cpu"
priority = "explicit"

[tool.poetry.group.dev.dependencies]
```

- [ ] **Step 3: Validate the file parses and the source is legal.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry check
```

Expected output: `All set!`
(If it prints `The "pytorch-cpu" source is defined but not used`, Step 1 did not land — the `torch` entry must literally say `source = "pytorch-cpu"`.)

- [ ] **Step 4: Re-lock.** This needs network access to `download.pytorch.org` and takes 1–3 minutes. It writes `poetry.lock` only — it installs nothing.

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry lock
```

Expected output ends with:
```
Resolving dependencies... (XXs)

Writing lock file
```
(Poetry 2.x: there is no `--no-update` flag any more; plain `poetry lock` refreshes only what changed. Use `poetry lock --regenerate` only if it errors on the existing lock.)

- [ ] **Step 5: Prove no CUDA leaked into the lock.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && grep -c '^name = "nvidia-' poetry.lock
```

Expected output: `0`
Anything above 0 means the linux marker did not route to `pytorch-cpu`, and the Cloud Run image is about to gain ~2 GB. Fix Step 1 before continuing.

- [ ] **Step 6: Confirm torch and numpy are in the main group, not dev.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && grep -A4 '^name = "torch"' poetry.lock | grep groups && grep -A4 '^name = "numpy"' poetry.lock | grep groups
```

Expected output:
```
groups = ["main"]
groups = ["main"]
```
(`--only main` is what the Dockerfile runs, so a dev-group torch would build an image the video path cannot run in.)

- [ ] **Step 7: Install.** This is the multi-minute step; run it once, here, and not again.

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry install --no-root
```

Then verify:
```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run python -c "
import torch, numpy
print('torch', torch.__version__)
print('numpy', numpy.__version__)
print('cuda_available', torch.cuda.is_available())
"
```
Expected output (patch versions will differ):
```
torch 2.5.1
numpy 2.3.5
cuda_available False
```

---

### Task 2: ffmpeg in the production image

**Files:**
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/Dockerfile` (lines 18–21, the `build-essential` apt stanza)

**Interfaces:**
- Consumes: nothing.
- Produces: `ffmpeg` and `ffprobe` on `PATH` in the image, major version `>= 7` — the floor `app/video/ffmpeg.py`'s `MIN_MAJOR_VERSION = 7` asserts unconditionally in `assert_build()`.

- [ ] **Step 1: Confirm the base image really is trixie before editing anything.** `python:3.12-slim` on bookworm ships ffmpeg **5.1**, which fails the `>= 7` floor; on trixie it ships **7.1.5**, which clears it.

```bash
docker run --rm python:3.12-slim sh -c 'cat /etc/os-release | head -2; apt-get update -qq && apt-cache policy ffmpeg | head -3'
```

Expected output:
```
PRETTY_NAME="Debian GNU/Linux 13 (trixie)"
NAME="Debian GNU/Linux"
ffmpeg:
  Installed: (none)
  Candidate: 7:7.1.5-1+deb13u1
```
If `PRETTY_NAME` says bookworm or the candidate starts `7:5.`, change the Dockerfile's first line to `FROM python:3.12-slim-trixie` as part of Step 2 and re-run this check against that tag. Do not proceed on a 5.x candidate.

- [ ] **Step 2: Edit the apt stanza.** In `/Users/akshat/projects/MarkAi/markai-signage-api/Dockerfile`, replace:

```dockerfile
# build-essential + libpq-dev are needed to build psycopg2; curl for healthchecks.
RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*
```

with:

```dockerfile
# build-essential + libpq-dev are needed to build psycopg2; curl for healthchecks.
#
# ffmpeg is the video Creative Fit subprocess boundary (app/video/ffmpeg.py).
# Debian trixie's package is 7.1.5, which clears that module's MIN_MAJOR_VERSION
# floor of 7 — no static build needed. ffprobe ships in the SAME package, and
# app/video/probe.py cannot run without it. --no-install-recommends is kept: it
# still pulls ffmpeg's hard libav* dependencies, only the optional extras are cut.
RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential libpq-dev curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 3: Verify the built image has both binaries at the right version.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api \
  && docker build -t markai-signage-api:video . \
  && docker run --rm markai-signage-api:video sh -c 'ffmpeg -hide_banner -version | head -1; ffprobe -hide_banner -version | head -1'
```

Expected output:
```
ffmpeg version 7.1.5-1+deb13u1 Copyright (c) 2000-2025 the FFmpeg developers
ffprobe version 7.1.5-1+deb13u1 Copyright (c) 2007-2025 the FFmpeg developers
```

- [ ] **Step 4: Record the image-size cost so it is a known number, not a surprise.**

```bash
docker images markai-signage-api:video --format '{{.Size}}'
```
Expected: a figure in the 2.0–2.8 GB range (ffmpeg + its libav deps ≈ 300 MB; CPU torch ≈ 800 MB on disk). Note the number in the task report. If it is above ~4 GB, `grep -c '^name = "nvidia-' poetry.lock` from Task 1 Step 5 has regressed.

---

### Task 3: Copy `app/video/**` and cut its three external edges

**Files:**
- Create: `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/**` (25 `.py` files, 8,152 lines, verbatim)
- Create: `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/fonts.py`
- Create: `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/lama.py`
- Create: `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/weights.py`
- Modify: `app/video/blueprint.py` (line 34), `app/video/erase/plate.py` (line 51), `app/video/__init__.py` (docstring), `app/video/erase/__init__.py` (docstring)

**Interfaces:**
- Consumes: `from app.core.config import settings` (the ONE permitted external import).
- Produces:
  - `app.video.fonts.FONTS: dict[str, tuple[str, bool]]`
  - `app.video.lama.inpaint(image: Image.Image, mask: Image.Image) -> Image.Image`
  - `app.video.weights.ensure_weights(url: str, filename: str) -> Path`

- [ ] **Step 1: Copy the package, excluding bytecode.**

```bash
cd /Users/akshat/projects/MarkAi \
  && mkdir -p markai-signage-api/app/video \
  && rsync -a --exclude='__pycache__' markai-creative-fit/app/video/ markai-signage-api/app/video/ \
  && find markai-signage-api/app/video -name '*.py' | wc -l \
  && find markai-signage-api/app/video -name '*.py' -exec cat {} + | wc -l
```

Expected output:
```
      25
    8152
```

- [ ] **Step 2: Create `app/video/fonts.py`.** Same `FONTS` dict as `markai-creative-fit/app/core/fonts.py`; the docstring is rewritten because the modules it used to name (`app/layout/rules.py`) do not exist in this repo. Write `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/fonts.py`:

```python
"""The font vocabulary the video analysis prompt offers Gemini.

Lives inside `app/video/` rather than in `app/core/`, unlike the repo this was
ported from: signage-api's image path (`app/creative_fit/`) is FROZEN and has no
font table of its own to share with, so there is nothing to factor out. The
render-time twin of this dict is `app/video/layout/typography.py`'s own copy —
see that module's docstring for why the duplication is deliberate.
"""

from __future__ import annotations

#: Latin display families, all SIL Open Font License. Gemini picks from
#: exactly these names, so whatever comes back resolves to a file we ship.
FONTS: dict[str, tuple[str, bool]] = {
    # name                  file                     variable weight axis?
    "Playfair Display": ("PlayfairDisplay.ttf", True),
    "Merriweather": ("Merriweather.ttf", True),
    "Lora": ("Lora.ttf", True),
    "Montserrat": ("Montserrat.ttf", True),
    "Poppins": ("Poppins-Bold.ttf", False),
    "Oswald": ("Oswald.ttf", True),
    "Anton": ("Anton.ttf", False),
    "Bebas Neue": ("BebasNeue.ttf", False),
}
```

- [ ] **Step 3: Create `app/video/weights.py`.** This is `markai-creative-fit/app/core/models.py` with `settings.MODEL_DIR` renamed to `settings.VIDEO_MODEL_DIR` (Task 4 defines it). Write `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/weights.py`:

```python
"""Fetch and cache the video path's model weights.

`httpx` is not declared in this repo's pyproject but IS a main-group dependency
of the lock (google-genai pulls it), so `poetry install --only main` ships it —
verified in poetry.lock: `groups = ["main", "dev"]`.
"""

import logging
import shutil
from pathlib import Path

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def ensure_weights(url: str, filename: str) -> Path:
    """Download ``url`` into VIDEO_MODEL_DIR once and return the local path.

    Downloads to a .part file and renames on success, so an interrupted pull
    never leaves a truncated checkpoint that fails to load later.
    """
    dest = settings.VIDEO_MODEL_DIR / filename
    if dest.exists() and dest.stat().st_size > 0:
        return dest

    part = dest.with_suffix(dest.suffix + ".part")
    logger.info("Fetching model weights %s -> %s", url, dest)
    with httpx.stream("GET", url, follow_redirects=True, timeout=600.0) as resp:
        resp.raise_for_status()
        with part.open("wb") as fh:
            for chunk in resp.iter_bytes(1 << 20):
                fh.write(chunk)
    shutil.move(str(part), str(dest))
    logger.info("Model ready: %s (%.0f MB)", dest.name, dest.stat().st_size / 1e6)
    return dest
```

- [ ] **Step 4: Create `app/video/lama.py`.** This is `markai-creative-fit/app/plate/lama.py` verbatim except `from app.core.models import ensure_weights` → `from app.video.weights import ensure_weights`. Write `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/lama.py`:

```python
"""LaMa inpainting — vendored runner for the big-lama TorchScript checkpoint.

Why not `simple-lama-inpainting`: that package is a thin wrapper around exactly
this checkpoint, but it declares `numpy<2` and `pillow<10`. Those pins are stale
(the model runs fine past both) yet Poetry enforces them, dragging the whole
service backwards. Forty lines here buys current pins across the board.

**This module is the ONLY thing in the repo that imports torch, and importing it
costs ~1s and ~300 MB RSS.** Its one importer is `app/video/erase/plate.py`,
which every caller imports lazily inside a function. Do not add a module-level
import of either module anywhere reachable from `app/main.py`.
"""

import logging
import threading

import numpy as np
import torch
from PIL import Image

from app.core.config import settings
from app.video.weights import ensure_weights

logger = logging.getLogger(__name__)

_MODULO = 8
_model = None
_lock = threading.Lock()


def _device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load():
    """Load the checkpoint once, guarded — FastAPI workers hit this concurrently."""
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            path = ensure_weights(settings.LAMA_URL, "big-lama.pt")
            logger.info("Loading LaMa on %s", _device())
            model = torch.jit.load(str(path), map_location=_device())
            model.eval()
            _model = model
    return _model


def _to_chw(img: Image.Image) -> np.ndarray:
    """PIL -> float32 CHW in 0..1."""
    arr = np.array(img)
    if arr.ndim == 2:
        arr = arr[np.newaxis, ...]
    else:
        arr = np.transpose(arr, (2, 0, 1))
    return arr.astype(np.float32) / 255.0


def _pad(arr: np.ndarray) -> np.ndarray:
    """Pad H and W up to a multiple of 8 — the network's stride requirement."""
    _, height, width = arr.shape
    pad_h = (_MODULO - height % _MODULO) % _MODULO
    pad_w = (_MODULO - width % _MODULO) % _MODULO
    if not pad_h and not pad_w:
        return arr
    return np.pad(arr, ((0, 0), (0, pad_h), (0, pad_w)), mode="symmetric")


def inpaint(image: Image.Image, mask: Image.Image) -> Image.Image:
    """Fill every white region of ``mask`` in ``image`` with plausible background."""
    model = _load()
    width, height = image.size

    img_t = torch.from_numpy(_pad(_to_chw(image.convert("RGB")))).unsqueeze(0)
    mask_t = torch.from_numpy(_pad(_to_chw(mask.convert("L")))).unsqueeze(0)
    mask_t = (mask_t > 0) * 1.0

    device = _device()
    with torch.inference_mode():
        out = model(img_t.to(device), mask_t.to(device))
    res = out[0].permute(1, 2, 0).detach().cpu().numpy()
    res = np.clip(res * 255, 0, 255).astype(np.uint8)
    # Drop the modulo padding so the plate matches the source exactly.
    return Image.fromarray(res[:height, :width])
```

- [ ] **Step 5: Rewrite import #1 — the font table.** In `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/blueprint.py` line 34, replace:

```python
from app.core.fonts import FONTS
```
with:
```python
from app.video.fonts import FONTS
```

- [ ] **Step 6: Rewrite import #2 — LaMa.** In `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/erase/plate.py` line 51, replace:

```python
from app.plate import lama  # the one permitted image-path import — see module docs
```
with:
```python
from app.video import lama  # module-level on purpose; see this file's import note
```

**Do not make this lazy.** The contract claims it already is — it is not, and it should not be. Laziness is delivered one level up: `app/video/pipeline.py` imports `erase.plate` inside functions (lines 277–278), and `app/video/check.py` inside `erase_assertions()`. Task 7 pins exactly that boundary. Moving the import inside `_lama_patch` would deviate from the verbatim copy for no additional guarantee.

- [ ] **Step 7: Rewrite import #3 — the weights helper.** Already done at creation in Step 3 (`app/video/lama.py` imports `from app.video.weights import ensure_weights` instead of `from app.core.models import ensure_weights`). Confirm it landed:

```bash
grep -n "^from app\." /Users/akshat/projects/MarkAi/markai-signage-api/app/video/lama.py
```
Expected output:
```
21:from app.core.config import settings
22:from app.video.weights import ensure_weights
```

- [ ] **Step 8: Prove no other cross-package import survived.** The grep anchors on import STATEMENTS (line start, optional indent) so the docstrings that merely *mention* `app.plate` do not produce false hits.

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api \
  && grep -rnE "^[[:space:]]*(from|import)[[:space:]]+app\." app/video --include='*.py' \
     | grep -vE "app\.video|app\.core\.config import settings"
```

Expected output: **nothing at all** (grep exits 1). Run against the SOURCE repo the same grep returns exactly two lines (`app/video/blueprint.py:34` and `app/video/erase/plate.py:51`) — those two are what Steps 5 and 6 removed.

- [ ] **Step 9: Fix the two package docstrings that now name modules this repo does not have.** In `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/__init__.py`, replace lines 3–5:

```
Self-contained. Nothing here imports from app.blueprint / app.plate /
app.layout, and nothing there imports from here: the image path is untouched by
design, and video is a parallel path that shares only the config object.
```
with:
```
Self-contained. Nothing here imports from app/creative_fit/, and nothing there
imports from here: the image path is FROZEN by design, and video is a parallel
path that shares only the config object.
```

And in `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/erase/__init__.py`, replace lines 9–11:

```
Imports nothing from app.blueprint / app.plate / app.layout except the leaf
module app.plate.lama.inpaint, per the image path's freeze (see the root
CLAUDE.md and this repo's CLAUDE.md).
```
with:
```
Imports nothing from app/creative_fit/. LaMa is `app.video.lama` — a duplicate
of the image path's runner, not a shared import, per the freeze (see the root
CLAUDE.md and this repo's CLAUDE.md).
```

- [ ] **Step 10: Lint.** signage-api has no `[tool.ruff]` section, so ruff runs on defaults (line-length 88, `select = ["E4","E7","E9","F"]`). E501 and I001 are NOT in that default set, so the ported code's 100-column lines and its import ordering are fine as-is — verified by running default-config ruff over the source package before the port.

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run ruff check app/
```
Expected output: `All checks passed!`

---

### Task 4: Merge the `VIDEO_*` config block into `app/core/config.py`

**Files:**
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/app/core/config.py` (add `Path` import at line 3; insert the block after line 330 `CREATIVE_FIT_CLEANUP_INTERVAL_MINUTES: int = 60`; add two `mkdir` lines after line 447 `settings = Settings()`)
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/.env.example` (append after the last line, `CREATIVE_FIT_CLEANUP_INTERVAL_MINUTES=60`)

**Interfaces:**
- Consumes: nothing.
- Produces: every attribute `app/video/**` reads off `settings` —
  `FFMPEG_BIN`, `FFPROBE_BIN`, `FFMPEG_TIMEOUT_SECONDS`, `VIDEO_CRF`, `VIDEO_PRESET`, `VIDEO_GOP_SECONDS`, `VIDEO_MAX_LEVEL`, `VIDEO_MAX_FPS`, `VIDEO_MAX_UPLOAD_MB`, `VIDEO_MAX_DURATION_SECONDS`, `VIDEO_ANALYSIS_WIDTH`, `VIDEO_ANALYSIS_CALL_TIMEOUT_SECONDS`, `VIDEO_ANALYSIS_CONCURRENCY`, `VIDEO_ERASE_BUDGET_MP`, `STRETCH_TOLERANCE`, `ASPECT_TOLERANCE`, `MAX_OUTPUT_EDGE`, `VIDEO_WORK_DIR`, `VIDEO_MODEL_DIR`, `VIDEO_ASSETS_DIR`, `LAMA_URL`, plus the lane settings Plan B will consume.

- [ ] **Step 1: Add the `Path` import.** `config.py` has no `pathlib` import today. Replace line 3:

```python
from typing import List, Optional
```
with:
```python
from pathlib import Path
from typing import List, Optional
```

- [ ] **Step 2: Insert the block.** Immediately after line 330 (`CREATIVE_FIT_CLEANUP_INTERVAL_MINUTES: int = 60`) and before the blank line preceding `@property def ai_enabled`, insert:

```python

    # --- Video Creative Fit: refit a video ad to a screen's resolution (app/video/) ---
    # Lane sizing. A video job runs ~15 minutes end to end, so its stale window is
    # SIX TIMES the image lane's 5 minutes — reusing 5 here would let a healthy
    # in-flight render be stolen by a second worker every time.
    CREATIVE_FIT_VIDEO_WORKERS: int = 1
    CREATIVE_FIT_VIDEO_STALE_MINUTES: int = 30
    # The source never proxies through this service (Cloud Run caps bodies at
    # 32 MiB); this bounds the size bound into the signed GCS upload session.
    CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES: int = 500 * 1024 * 1024

    # Scratch + weights. BOTH must live under /tmp: Cloud Run's container
    # filesystem is read-only everywhere else, so the mkdir at the bottom of this
    # module would raise at import time and the whole service would fail to boot.
    VIDEO_WORK_DIR: Path = Path("/tmp/markai-video")
    VIDEO_MODEL_DIR: Path = Path("/tmp/markai-models")
    # Fonts ship IN the image (assets/fonts/, 10 MB) — resolved off this file's
    # own location so it works identically in the container and in local dev.
    VIDEO_ASSETS_DIR: Path = Path(__file__).resolve().parents[2] / "assets"

    # big-lama TorchScript checkpoint, 205 MB, fetched on first erase and cached
    # in VIDEO_MODEL_DIR. u2net/onnxruntime are NOT needed — those serve the image
    # path's cutout stage, which is not ported.
    LAMA_URL: str = (
        "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/"
        "v0.1.0/big-lama.pt"
    )

    # Explicit paths win; otherwise PATH. Set these in a container where a pinned
    # static build lives at a known location rather than on PATH.
    FFMPEG_BIN: str | None = None
    FFPROBE_BIN: str | None = None

    # Encode settings for the delivered file. These play on physical panels, so the
    # file IS the product: CRF 17 is at/below visually lossless, and the fixed 2s
    # GOP (keyint == 2 x fps, scenecut off) gives a clean restart at every loop
    # point rather than wherever x264 felt like an I-frame.
    VIDEO_CRF: int = 17
    VIDEO_PRESET: str = "slow"
    VIDEO_GOP_SECONDS: float = 2.0

    # The AndBox Prime X4 (S905X4) decodes H.264 up to 4K High@L5.1 30fps and NOT
    # 4K60 — a hardware ceiling, so a job needing L5.2 is refused rather than
    # shipped to a screen that cannot play it. VIDEO_MAX_FPS is the same ceiling
    # expressed in fps.
    VIDEO_MAX_LEVEL: str = "5.1"
    VIDEO_MAX_FPS: float = 30.0

    # Guards against a typo'd input, not quality ceilings.
    VIDEO_MAX_UPLOAD_MB: int = 500
    VIDEO_MAX_DURATION_SECONDS: int = 120

    # A single ffmpeg invocation running longer than the job's whole 15-minute
    # budget is hung (corrupt stream, malformed input), not slow — kill it and
    # raise FfmpegError rather than blocking a threadpool worker forever.
    FFMPEG_TIMEOUT_SECONDS: int = 900

    # Analysis runs on a proxy, never on full frames. 480px wide is MediaPipe
    # AutoFlip's shipped value: a cut, a face and a text box are all just as
    # findable there, and crop geometry is computed at native resolution
    # afterwards — this never limits output quality.
    VIDEO_ANALYSIS_WIDTH: int = 480
    # Per-call deadline for one Gemini frame read. Measured calls take 6-9s; the
    # point of the setting is that a call stalled inside the SDK's own retry
    # backoff must fail and be recorded as a warning rather than eat the job's
    # entire budget (reproduced: two calls stalled 4-12+ minutes).
    VIDEO_ANALYSIS_CALL_TIMEOUT_SECONDS: int = 30
    # How many of a shot's frame-reads run at once. Total request volume is
    # unchanged, so RPM quota is unaffected — this only overlaps the waiting.
    VIDEO_ANALYSIS_CONCURRENCY: int = 4
    # Megapixels of LaMa inpainting one job may spend. Measured 8.3 s/MP on CPU,
    # so 60 MP is ~8 minutes — over half the 15-minute budget, and the point at
    # which the router should be preferring recovery branches over the model.
    VIDEO_ERASE_BUDGET_MP: float = 60.0

    # --- Read by app/video/ under these exact names (do NOT rename) ------------
    # The three-tier shape check (app/video/render.py). <= STRETCH: stretch to fit,
    # nothing cropped. <= ASPECT: scale + centre-crop. Above: rebuild. Duplicated
    # from the image repo rather than shared, per the freeze.
    STRETCH_TOLERANCE: float = 1.08
    ASPECT_TOLERANCE: float = 1.25
    # Guard against a typo'd target producing a gigapixel render, not a quality
    # ceiling — 8K panels fit under it. Read by app/video/pipeline.py.
    MAX_OUTPUT_EDGE: int = 8192
```

- [ ] **Step 3: Preserve the source config's import-time `mkdir`.** The creative-fit module did this at the bottom and the ported code depends on the directories existing (`pipeline.creative_dir` only mkdirs its own subdir; `weights.ensure_weights` mkdirs nothing at all). Replace line 447:

```python
settings = Settings()
```
with:
```python
settings = Settings()
# Preserved from markai-creative-fit/app/core/config.py:149-150 — app/video/'s
# scratch and weights dirs must exist before anything writes into them, and
# ensure_weights() does not create its parent. Both default under /tmp, the only
# writable path on Cloud Run, so this is safe to run at import time.
settings.VIDEO_WORK_DIR.mkdir(parents=True, exist_ok=True)
settings.VIDEO_MODEL_DIR.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 4: Append the `.env.example` block.** After the last line of `/Users/akshat/projects/MarkAi/markai-signage-api/.env.example` (`CREATIVE_FIT_CLEANUP_INTERVAL_MINUTES=60`), append:

```bash

# --- Video Creative Fit: refit a video ad to a screen's resolution (app/video/) ---
# Video lane workers. Set to 0 on the web instance and >0 on a bigger video-only
# Cloud Run service; the image lane is CREATIVE_FIT_WORKERS above.
CREATIVE_FIT_VIDEO_WORKERS=1
# A video job runs ~15 min, so its stale window is 6x the image lane's.
CREATIVE_FIT_VIDEO_STALE_MINUTES=30
CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES=524288000
# Scratch + weights. MUST stay under /tmp — the rest of Cloud Run's filesystem is
# read-only and config.py mkdirs both at import time.
VIDEO_WORK_DIR=/tmp/markai-video
VIDEO_MODEL_DIR=/tmp/markai-models
# Leave blank to find ffmpeg/ffprobe on PATH (the Dockerfile installs them).
FFMPEG_BIN=
FFPROBE_BIN=
# Encode: CRF 17 is at/below visually lossless; 2s GOP gives a clean loop restart.
VIDEO_CRF=17
VIDEO_PRESET=slow
VIDEO_GOP_SECONDS=2.0
# AndBox S905X4 hardware ceiling: 4K High@L5.1 30fps, never 4K60.
VIDEO_MAX_LEVEL=5.1
VIDEO_MAX_FPS=30.0
VIDEO_MAX_UPLOAD_MB=500
VIDEO_MAX_DURATION_SECONDS=120
# A single ffmpeg call longer than the whole job budget is hung, not slow.
FFMPEG_TIMEOUT_SECONDS=900
# Analysis runs on a 480px proxy; output geometry is computed at native res.
VIDEO_ANALYSIS_WIDTH=480
VIDEO_ANALYSIS_CALL_TIMEOUT_SECONDS=30
VIDEO_ANALYSIS_CONCURRENCY=4
# LaMa megapixel budget per job. Measured 8.3 s/MP on CPU -> 60 MP is ~8 min.
VIDEO_ERASE_BUDGET_MP=60.0
```

- [ ] **Step 5: Verify every name the video package reads actually resolves.** This is the check that catches a typo in the block above, and it is exhaustive — the list is `grep -rho "settings\.[A-Za-z_]*" app/video` de-duplicated.

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run python -c "
from app.core.config import settings
names = ['FFMPEG_BIN','FFPROBE_BIN','FFMPEG_TIMEOUT_SECONDS','VIDEO_CRF','VIDEO_PRESET',
         'VIDEO_GOP_SECONDS','VIDEO_MAX_LEVEL','VIDEO_MAX_FPS','VIDEO_MAX_UPLOAD_MB',
         'VIDEO_MAX_DURATION_SECONDS','VIDEO_ANALYSIS_WIDTH','VIDEO_ANALYSIS_CALL_TIMEOUT_SECONDS',
         'VIDEO_ANALYSIS_CONCURRENCY','VIDEO_ERASE_BUDGET_MP','VIDEO_WORK_DIR','VIDEO_MODEL_DIR',
         'VIDEO_ASSETS_DIR','LAMA_URL','STRETCH_TOLERANCE','ASPECT_TOLERANCE','MAX_OUTPUT_EDGE',
         'CREATIVE_FIT_VIDEO_WORKERS','CREATIVE_FIT_VIDEO_STALE_MINUTES',
         'CREATIVE_FIT_VIDEO_MAX_UPLOAD_BYTES','AI_MODEL','GEMINI_API_KEY']
missing = [n for n in names if not hasattr(settings, n)]
assert not missing, f'missing settings: {missing}'
assert settings.ai_enabled is not None
assert settings.VIDEO_WORK_DIR.is_dir(), 'VIDEO_WORK_DIR was not created at import'
assert settings.VIDEO_MODEL_DIR.is_dir(), 'VIDEO_MODEL_DIR was not created at import'
print('all', len(names), 'settings present; both dirs exist')
"
```
Expected output: `all 26 settings present; both dirs exist`

- [ ] **Step 6: Prove the freeze held — no existing setting was changed.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && git diff --stat app/core/config.py && git diff -U0 app/core/config.py | grep '^-' | grep -v '^---'
```
Expected output: the `--stat` line shows insertions and **one** deletion pair each for the `from typing` line and the `settings = Settings()` line, and the `grep '^-'` prints exactly:
```
-from typing import List, Optional
-settings = Settings()
```
Any other removed line means an existing setting was touched — revert it.

- [ ] **Step 7: Lint.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run ruff check app/
```
Expected output: `All checks passed!`

---

### Task 5: Ship the fonts and repoint typography at `VIDEO_ASSETS_DIR`

**Files:**
- Create: `/Users/akshat/projects/MarkAi/markai-signage-api/assets/fonts/**` (16 TTFs, 10 MB)
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/layout/typography.py` (lines 169 and 173)

**Interfaces:**
- Consumes: `settings.VIDEO_ASSETS_DIR` (Task 4).
- Produces: `app.video.layout.typography.load_font(family, weight, size, text) -> ImageFont.FreeTypeFont` resolving real files for all 8 Latin families and all 8 Noto Indic faces.

- [ ] **Step 1: Copy the fonts.**

```bash
cd /Users/akshat/projects/MarkAi \
  && mkdir -p markai-signage-api/assets/fonts \
  && rsync -a markai-creative-fit/assets/fonts/ markai-signage-api/assets/fonts/ \
  && ls markai-signage-api/assets/fonts | wc -l \
  && du -sh markai-signage-api/assets
```
Expected output:
```
      16
 10M	markai-signage-api/assets
```

- [ ] **Step 2: Confirm the fonts actually land in the image.** `.dockerignore` lists only extension patterns (`*.pyc`, `*.pyo`, `*.md`), caches, `.env*`, `tests` and dev tooling — nothing matching `assets/` — so the existing `COPY . .` picks them up. Prove it end to end rather than by reading the ignore file:

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api \
  && docker build -t markai-signage-api:video . \
  && docker run --rm markai-signage-api:video sh -c 'ls /app/assets/fonts | wc -l'
```
Expected output: `16`
If it prints `0` or errors with "No such file or directory", a `.dockerignore` pattern is swallowing `assets/` and it needs an explicit `!assets` negation line.

- [ ] **Step 3: Repoint the script-override branch.** In `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/layout/typography.py` line 169, replace:

```python
        path, variable = settings.FONT_DIR / override, True
```
with:
```python
        path, variable = settings.VIDEO_ASSETS_DIR / "fonts" / override, True
```

- [ ] **Step 4: Repoint the Latin-family branch.** In the same file, line 173, replace:

```python
        path = settings.FONT_DIR / filename
```
with:
```python
        path = settings.VIDEO_ASSETS_DIR / "fonts" / filename
```

- [ ] **Step 5: Prove every declared font file actually resolves and loads.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run python -c "
from app.core.config import settings
from app.video.layout import typography

missing = [f for f, _ in typography.FONTS.values()
           if not (settings.VIDEO_ASSETS_DIR / 'fonts' / f).is_file()]
missing += [f for _, _, f in typography.SCRIPT_FONTS
            if not (settings.VIDEO_ASSETS_DIR / 'fonts' / f).is_file()]
assert not missing, f'missing font files: {missing}'

latin = typography.load_font('Montserrat', 700, 48, 'Cafe MG Road')
kannada = typography.load_font('Montserrat', 700, 48, 'ಬೆಂಗಳೂರು')
assert 'Montserrat' in str(latin.path), latin.path
assert 'Kannada' in str(kannada.path), kannada.path
print('16 font files resolve; Latin ->', latin.path.split('/')[-1],
      '| Kannada ->', kannada.path.split('/')[-1])
"
```
Expected output:
```
16 font files resolve; Latin -> Montserrat.ttf | Kannada -> NotoSansKannada.ttf
```

- [ ] **Step 6: Prove no `FONT_DIR` reference survives.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && grep -rn "FONT_DIR" app/ ; echo "exit=$?"
```
Expected output: `exit=1` and no matching lines.

- [ ] **Step 7: Lint.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run ruff check app/
```
Expected output: `All checks passed!`

---

### Task 6: Repoint the remaining settings names the port renamed

**Files:**
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/pipeline.py` (line 53)
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/blueprint.py` (lines 130 and 162)

**Interfaces:**
- Consumes: `settings.VIDEO_WORK_DIR`, `settings.ai_enabled`, `settings.AI_MODEL` (Task 4).
- Produces: `app.video.pipeline.creative_dir(creative_id: str) -> Path` rooted at `VIDEO_WORK_DIR`; `app.video.blueprint._client()` that gates on signage-api's own `ai_enabled` and passes google-genai a bare model id.

- [ ] **Step 1: Repoint the work dir.** In `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/pipeline.py` line 53, replace:

```python
    path = settings.WORK_DIR / creative_id
```
with:
```python
    path = settings.VIDEO_WORK_DIR / creative_id
```

- [ ] **Step 2: Repoint the AI-configured gate.** signage-api names this property `ai_enabled`; the source repo named it `ai_configured`. Both are `bool(GEMINI_API_KEY)`. In `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/blueprint.py` line 130, replace:

```python
    if not settings.ai_configured:
```
with:
```python
    if not settings.ai_enabled:
```

- [ ] **Step 3: Strip the provider prefix off the model id.** This is a real ported-code bug, not a cosmetic rename: signage-api's `AI_MODEL` is **`google:gemini-2.5-flash`** (a pydantic-ai model id), while `blueprint.py` hands it to the raw `google-genai` SDK, which expects `gemini-2.5-flash` and 404s on the prefixed form. In `/Users/akshat/projects/MarkAi/markai-signage-api/app/video/blueprint.py` line 162, replace:

```python
        model=settings.AI_MODEL,
```
with:
```python
        # settings.AI_MODEL is a pydantic-ai id ("google:gemini-2.5-flash"); the
        # raw google-genai SDK wants the bare name. split() is a no-op on an
        # already-bare id, so this works under either convention.
        model=settings.AI_MODEL.split(":", 1)[-1],
```

- [ ] **Step 4: Prove no stale settings name survives anywhere in `app/video/`.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api \
  && grep -rnE "settings\.(WORK_DIR|MODEL_DIR|FONT_DIR|ai_configured|U2NET_URL|MAX_ANALYSIS_EDGE)" app/ ; echo "exit=$?"
```
Expected output: `exit=1` and no matching lines.

- [ ] **Step 5: Prove the whole package imports and the model id resolves bare.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run python -c "
from app.core.config import settings
from app.video import blueprint, encode, ffmpeg, motion, pipeline, probe, render, schemas, shots, tracking
from app.video.erase import flicker, register, router, scrim
from app.video.layout import compose, duration, geometry, reframe, render_slow, typography
print('creative_dir ->', pipeline.creative_dir('abc123'))
print('bare model id ->', settings.AI_MODEL.split(':', 1)[-1])
print('all 20 light modules import clean')
"
```
Expected output:
```
creative_dir -> /tmp/markai-video/abc123
bare model id -> gemini-2.5-flash
all 20 light modules import clean
```
(`erase.plate` is deliberately absent from that list — it is the torch-bearing module, and Task 7 owns it.)

- [ ] **Step 6: Lint.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run ruff check app/
```
Expected output: `All checks passed!`

---

### Task 7: The 16-check harness — `scripts/video_check.py`

**Files:**
- Create: `/Users/akshat/projects/MarkAi/markai-signage-api/scripts/video_check.py`
- (`app/video/check.py` is already in place from Task 3 Step 1 — 676 lines, copied verbatim, no edits needed)

**Interfaces:**
- Consumes: `app.video.check.run_all() -> list[CheckResult]`, `app.video.ffmpeg.assert_build(require_text: bool = False) -> None`.
- Produces: exit code 0 and a final line `16/16 checks passed`; exit code 1 with the failing rows named otherwise.

- [ ] **Step 1: Write the entrypoint.** Create `/Users/akshat/projects/MarkAi/markai-signage-api/scripts/video_check.py`:

```python
#!/usr/bin/env python
"""The ported video harness — this repo's `python cli.py check`.

SIXTEEN checks, in four groups:
    3  colour    golden_frame()        decode-range, golden-pixels, golden-tags
    6  encode    encode_assertions()   level, profile, pix-fmt, even-dims,
                                       no-audio, faststart
    3  analysis  analysis_assertions() shots, static-region, background-moves
    4  erase     erase_assertions()    flicker, recovers, registration, loop-seam

Needs ffmpeg/ffprobe >= 7 on PATH and `torch` importable (erase_assertions
imports app/video/erase/plate.py, which imports app/video/lama.py at module
scope). Needs NO Gemini key and downloads NO model weights: the erase fixture is
built to route to the `median` branch, which recovers real pixels from other
frames and never calls LaMa, so big-lama.pt is never fetched.

There is no pytest in this repo's video path. This script IS the test suite, and
it must pass before any change to app/video/ is considered done.
"""

from __future__ import annotations

import sys
from pathlib import Path

# `poetry run python scripts/video_check.py` puts scripts/ on sys.path, not the
# repo root, so `app` would not import without this.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.video import check, ffmpeg  # noqa: E402


def main() -> int:
    # require_text stays False: nothing in this harness renders drawtext, and a
    # Homebrew/Debian ffmpeg without --enable-libharfbuzz would otherwise fail
    # every run over a build flag no check here exercises. The phase that turns
    # on drawtext must call assert_build(require_text=True) and take that hard
    # fail — that is what the flag is for.
    ffmpeg.assert_build()

    results = check.run_all()
    width = max(len(r.name) for r in results)
    for result in results:
        mark = "PASS" if result.passed else "FAIL"
        print(f"  {mark}  {result.name:{width}s}  {result.detail}")

    passed = sum(1 for r in results if r.passed)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Confirm the local toolchain can run it at all.** The harness shells out to ffmpeg dozens of times; a missing binary fails every row for one reason.

```bash
ffmpeg -hide_banner -version | head -1 && ffprobe -hide_banner -version | head -1
```
Expected output: two lines whose version major is **7 or higher** (this dev machine reports `ffmpeg version 8.1.2`). If either is missing: `brew install ffmpeg`.

- [ ] **Step 3: Run the harness.** It takes roughly 1–3 minutes — it encodes and decodes a dozen short clips, including a real `plate.build()` pass.

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run python scripts/video_check.py
```
Expected output — 16 rows, every one `PASS`, then the tally. The detail strings carry measured numbers that vary a little by ffmpeg build; the **names**, the **order** and the **count** do not:
```
  PASS  decode-range               75% white decoded to 191.0, expected ~191
  PASS  golden-pixels              patch-median max delta 1.0 (pass <= 2, warn <= 8)
  PASS  golden-tags                all four colour tags present
  PASS  encode-level               level 40 (expected 40 for 1920x1080@30)
  PASS  encode-profile             profile 'High' (expected 'High')
  PASS  encode-pix-fmt             pix_fmt 'yuv420p'
  PASS  encode-even-dims           1920x1080
  PASS  encode-no-audio            1 stream(s)
  PASS  encode-faststart           moov@... mdat@...
  PASS  analysis-shots             3 shot(s), cuts at [1.0, 2.0] (expected 3 shots, cuts ~[1.0, 2.0])
  PASS  analysis-static-region     drawn box measured static (ratio ...)
  PASS  analysis-background-moves  surround measured moving (ring mafd 0.263..., expected in [0, 1])
  PASS  erase-flicker              real plate.mov: ratio ... branch=median
  PASS  erase-recovers             real plate.mov PSNR 23.8 dB vs ground truth ...
  PASS  erase-registration         pan: measured dx -2.000 px/frame (expected -2 +/- 0.5) ...
  PASS  erase-loop-seam            smooth loop: ratio ... (pass); visible-jump loop: ratio ... (fail)

16/16 checks passed
```

- [ ] **Step 4: Confirm it needed no key and downloaded no weights.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api \
  && GEMINI_API_KEY= poetry run python scripts/video_check.py | tail -1 \
  && ls -la /tmp/markai-models/
```
Expected output:
```
16/16 checks passed
total 0
drwxr-xr-x ... .
drwxrwxrwt ... ..
```
An empty `/tmp/markai-models/` is the proof: if `big-lama.pt` (205 MB) appears, the erase fixture routed to `clean_plate` instead of `median` and `erase-flicker` would have reported the wrong branch.

- [ ] **Step 5: Lint the new script.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run ruff check app/ scripts/
```
Expected output: `All checks passed!`

---

### Task 8: Prove torch stays lazy

**Files:**
- No files created or modified. This task is pure verification.

**Interfaces:**
- Consumes: `app.main` (unmodified), `app.video.*`.
- Produces: a recorded, repeatable assertion that `torch` is absent from `sys.modules` after importing the FastAPI app.

> **This is the single most important regression guard in this plan.** The user accepted torch entering the API image on the condition that it stays lazy: a CMS instance that never runs a video job must not pay torch's ~1s import or ~300 MB RSS. Run these two checks at the end of every later task that touches `app/video/` or `app/main.py`.

- [ ] **Step 1: The API process must not import torch — or `app.video` at all.** Plan A adds no route and no worker, so `app.main` has no path to `app/video/`; this pins that and will catch Plan B wiring the video lane in eagerly.

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run python -c "
import sys
import app.main  # noqa: F401

torch_mods = sorted(m for m in sys.modules if m == 'torch' or m.startswith('torch.'))
assert not torch_mods, f'torch entered the API process: {torch_mods[:5]}'

video_mods = sorted(m for m in sys.modules if m == 'app.video' or m.startswith('app.video.'))
assert not video_mods, f'app.video entered the API process: {video_mods}'

print('OK: import app.main pulls in neither torch nor app.video')
"
```
Expected output: `OK: import app.main pulls in neither torch nor app.video`

- [ ] **Step 2: Pin exactly where torch DOES enter.** The whole light half of the video package — probe, render, encode, ffmpeg, pipeline, blueprint, shots, motion, layout — must stay torch-free; torch arrives only with `erase.plate`, whose every caller imports it inside a function (`pipeline.py:277-278`, `check.py:395`).

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run python -c "
import sys
from app.video import blueprint, encode, ffmpeg, motion, pipeline, probe, render, shots  # noqa: F401
from app.video.layout import compose, reframe, render_slow, typography  # noqa: F401

early = sorted(m for m in sys.modules if m == 'torch' or m.startswith('torch.'))
assert not early, f'torch entered too early, via: {early[:5]}'

from app.video.erase import plate  # noqa: F401
assert 'torch' in sys.modules, 'erase.plate no longer reaches torch — lama import broken?'

print('OK: torch enters ONLY with app.video.erase.plate')
"
```
Expected output: `OK: torch enters ONLY with app.video.erase.plate`

- [ ] **Step 3: Prove no module-level import of the torch-bearing modules exists anywhere outside `app/video/erase/`.** A future `from app.video.erase import plate` at the top of a service module is exactly how this regresses.

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && grep -rnE \
  "^(from|import)[[:space:]]+(torch|app\.video\.lama)|^from[[:space:]]+app\.video[[:space:]]+import[[:space:]]+lama|^from[[:space:]]+app\.video\.erase[[:space:]]+import[[:space:]].*plate" \
  app/ scripts/
```
Expected output: **exactly these two lines** (walk order may differ):
```
app/video/erase/plate.py:51:from app.video import lama  # module-level on purpose; see this file's import note
app/video/lama.py:18:import torch
```
Those two are the whole torch edge: `lama.py` is the repo's one legitimate module-level `import torch`, and `erase/plate.py` is its one importer. Any **third** line is the regression. (The anchor has no leading-whitespace allowance on purpose: indented — i.e. in-function — imports of these modules are exactly what we want, and `pipeline.py:277` / `check.py`'s `erase_assertions` are those.)

- [ ] **Step 4: Measure the cost being avoided, so the guard has a number behind it.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && poetry run python -c "
import time
t0 = time.perf_counter(); import app.main; t1 = time.perf_counter()
import torch; t2 = time.perf_counter()
print(f'app.main import: {t1-t0:.2f}s')
print(f'torch import on top: {t2-t1:.2f}s')
"
```
Expected output: `app.main` in roughly 1–3s, torch adding roughly 1–2s on top. Record both numbers in the task report — they are the justification for keeping the import lazy.

---

### Task 9: Document the video path in `markai-signage-api/CLAUDE.md`

**Files:**
- Modify: `/Users/akshat/projects/MarkAi/markai-signage-api/CLAUDE.md` — **append only**, after the current last line 529 (`recovers from the IntegrityError when two of its upload workers race.`)

**Interfaces:**
- Consumes: nothing.
- Produces: a `## Video Creative Fit` section that a future session reads before touching `app/video/`.

> `CLAUDE.md` currently has **no** Creative Fit section at all (12 `##` headings, none about the image path). Appending is therefore guaranteed not to alter any existing image-path line. **Do not edit any of lines 1–529.**

- [ ] **Step 1: Append the section.** Add to the end of `/Users/akshat/projects/MarkAi/markai-signage-api/CLAUDE.md`:

```markdown

## Video Creative Fit (`app/video/`) — ported engine, no routes yet

`app/video/` refits a finished **video** ad to a screen's real resolution. It was
ported wholesale (25 modules, ~8,150 lines) from `markai-creative-fit/app/video/`
and is **self-contained**: the only thing it imports from outside itself is
`app.core.config.settings`. `app/core/fonts.py`, `app/plate/lama.py` and
`app/core/models.ensure_weights` came with it as `app/video/fonts.py`,
`app/video/lama.py` and `app/video/weights.py` — duplicates, not shared imports.

**`app/creative_fit/` (the IMAGE path) is FROZEN.** Video never imports from it and
never edits it. Where video needs something image already has, it is duplicated.
A previous attempt to share code here was reverted.

```
probe.py     ffprobe -> VideoProbe. Probe, never assume: half of real ad masters
             declare no colour tags, and guessing wrong is the "looks flat" bug.
ffmpeg.py    the subprocess boundary. assert_build() checks the version floor
             (>= 7) unconditionally; the HarfBuzz build-flag check only fires
             when called with require_text=True.
encode.py    H.264 level arithmetic. 2560x960 needs level 5.0, NOT the 4.2 you
             would reach for by habit.
render.py    the fast path: stretch/crop in one ffmpeg pass, no Python per frame.
shots.py     shot boundaries + per-frame MAFD from ONE ffmpeg `scdet` pass.
tracking.py  flickering per-frame detections -> one stable region per shot.
blueprint.py sampled frames per shot -> Gemini reads MEANING -> VideoBlueprint.
motion.py    has the box moved, have its pixels changed, does the SURROUND move.
erase/       which erase branch per region per shot, and spending it into plate.mov
layout/      reframe / compose / typography — the landscape -> portrait rebuild
pipeline.py  probe once, analyse once, render many + content-hash caching
check.py     the test suite. There is no pytest here.
```

### Verifying `app/video/`
```bash
poetry run python scripts/video_check.py      # 16 checks: 3 colour, 6 encode, 3 analysis, 4 erase
```
Must be **16/16** before any change to `app/video/` is done. It needs ffmpeg >= 7
and `torch` importable; it needs **no Gemini key** and downloads **no weights** (the
erase fixture routes to the `median` branch, which recovers real pixels rather than
calling LaMa).

### Rules that are load-bearing here
1. **torch is lazy and must stay lazy.** `app/video/lama.py` is the repo's only
   module-level `import torch`; its only importer is `app/video/erase/plate.py`,
   and every caller of THAT imports it inside a function (`pipeline.py:277-278`,
   `check.py`'s `erase_assertions`). `import app.main` must never pull `torch` (or
   `app.video`) into `sys.modules` — assert it after any change:
   `poetry run python -c "import sys, app.main; assert 'torch' not in sys.modules"`.
   The whole reason the CPU wheel is tolerable in this image is that a CMS instance
   which never runs a video job never pays for it.
2. **The torch wheel is CPU-only, pinned via an explicit Poetry source.**
   `[[tool.poetry.source]] name = "pytorch-cpu"` + a platform-split `torch = [...]`
   in `pyproject.toml`. PyPI's linux torch declares the whole `nvidia-cu*` stack
   (~2 GB) for a service with no GPU. `grep -c '^name = "nvidia-' poetry.lock` must
   stay `0`.
3. **LaMa costs 8.3 s/MP on CPU** (measured). That is why `VIDEO_ERASE_BUDGET_MP`
   (60 MP ≈ 8 minutes) exists and why the erase router prefers recovery branches —
   real pixels from other frames — over the model wherever the shot allows it.
4. **`VIDEO_WORK_DIR` and `VIDEO_MODEL_DIR` must stay under `/tmp`.** Cloud Run's
   filesystem is read-only everywhere else and `app/core/config.py` mkdirs both at
   **import time**, so pointing either elsewhere makes the service fail to boot.
5. **`assets/fonts/` (16 TTFs, 10 MB) ships in the image**, resolved via
   `settings.VIDEO_ASSETS_DIR / "fonts"`. Eight Latin families plus eight Noto Indic
   faces — a Kannada line in Montserrat is a row of empty boxes.
6. **Colour tags are written with the `setparams` filter, never `-color_*` output
   flags**, and `out_color_matrix=bt709` on `scale` is required alongside them.
   Without the matrix, swscale encodes 601 while the tag says 709 and cyan drifts.
   `check.py` asserts pixels AND tags independently — a clean round-trip is not
   proof, because an encode with no colour handling at all round-trips at delta=1
   and ships an untagged file a BT.709 panel renders wrong.
7. **Never emit 3840x2160@60 H.264.** The AndBox S905X4 tops out at 4K High@L5.1
   30fps; `encode.h264_level` refuses rather than shipping an unplayable file.
8. **`ffmpeg` comes from Debian trixie's package (7.1.5)**, installed in the
   Dockerfile's apt line. Bookworm ships 5.1, which fails `MIN_MAJOR_VERSION = 7` —
   if the base image ever moves back, pin `FROM python:3.12-slim-trixie`.

**Not built yet (Plans B and C):** there is no `creative_fit_jobs.media_kind`, no
video worker lane, no `/api/cms/creative-fit/video/*` route and no CMS toggle. Today
`app/video/` is reachable only from `scripts/video_check.py` and a direct Python call.
```

- [ ] **Step 2: Prove nothing above line 529 changed.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api && git diff -U0 CLAUDE.md | grep '^-' | grep -v '^---' ; echo "exit=$?"
```
Expected output: `exit=1` and no lines — an append-only diff removes nothing.

- [ ] **Step 3: Final full verification of the plan's deliverable.**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api \
  && poetry run ruff check app/ scripts/ \
  && poetry run python -c "import sys, app.main; assert 'torch' not in sys.modules; print('lazy OK')" \
  && poetry run python scripts/video_check.py | tail -1
```
Expected output:
```
All checks passed!
lazy OK
16/16 checks passed
```

- [ ] **Step 4: Do NOT commit.** The user works uncommitted. Report the three lines above, the image size from Task 2 Step 4, and the two import timings from Task 8 Step 4. Stop there.
