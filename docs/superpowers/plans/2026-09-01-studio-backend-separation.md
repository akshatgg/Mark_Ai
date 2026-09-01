# Studio Backend Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift Mark AI Studio's server side out of `markai-signage-api` into a
standalone FastAPI service, `markai-studio-api`, with its own Postgres, its own
job table, its own worker pool, running in 1 CPU / 1 GiB.

**Architecture:** A second backend built to the same conventions as
`markai-signage-api` (Poetry, `app.core.*`, per-domain
`router/schemas/service/models`). The Creative Fit analyst and the video engine
are copied verbatim; the CMS chat co-pilot is not. Media never sits in memory —
ffmpeg reads its source from a signed GCS URL and the result streams straight
back to GCS. The public path `/api/ext/creative-fit/*` is preserved so the
Studio frontend changes by one environment variable.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (async, asyncpg), Alembic,
Postgres, Pillow, ffmpeg, `pydantic-ai-slim[google]` (Gemini), google-cloud-storage.

**Spec:** `docs/superpowers/specs/2026-09-01-studio-backend-separation-design.md`

## Global Constraints

- **Never run pytest in this repo.** House rule. Verification is `python -c "import ..."`,
  `ruff check`, `alembic upgrade head`, and manual `curl` against a running server.
  The user runs any test suite themselves.
- **`ruff` is the gate, not `black`.** Do not reformat ported files.
- **Ported engine files are copied verbatim.** Only `import` lines change
  (`app.creative_fit.X` → `app.engine.X`). Do not "improve" them — a Studio
  rebuild must be indistinguishable from a CMS one.
- **Never downscale output.** Rendered creatives stay native resolution and
  `-crf 17`. Encoder *preset* may change; resolution and CRF may not.
- **Input caps:** image `10 * 1024 * 1024`, video `100 * 1024 * 1024`.
- **Container target:** 1 CPU / 1 GiB. On Cloud Run `/tmp` is a tmpfs and counts
  against that. Never hold a whole media file in a `bytes`.
- **Local ports:** API `8097`, Postgres `5435`, fake-gcs `4482`.
- **Secrets stay backend-only.** Never `NEXT_PUBLIC_*`.
- **Commit after every task.** Do not push. Never add Claude co-author trailers.
- Repo lives at `/Users/akshat/projects/MarkAi/markai-studio-api`.
- Source of truth for everything copied: `/Users/akshat/projects/MarkAi/markai-signage-api`.

---

## File Structure

```
markai-studio-api/
├─ app/
│  ├─ main.py               FastAPI app + lifespan (worker pool start/stop)
│  ├─ db_base.py            declarative Base
│  ├─ models.py             model registry for alembic autogenerate
│  ├─ core/
│  │   ├─ config.py         Settings — Studio's own, not signage-api's 600 lines
│  │   ├─ database.py       async engine + get_db          [copied verbatim]
│  │   ├─ gcs_service.py    GCS helpers + streaming additions
│  │   ├─ logging_config.py                                [copied verbatim]
│  │   ├─ security.py       upload tokens only             [trimmed copy]
│  │   └─ timezone.py       IST day boundaries             [copied verbatim]
│  ├─ engine/               the Creative Fit engine        [copied verbatim]
│  │   ├─ agent.py  analysis.py  gemini_image.py  prompts.py  resizer.py
│  │   └─ media.py          NEW — streaming download/upload helpers
│  ├─ video/                ffmpeg boundary                [copied verbatim + cancel]
│  │   └─ ffmpeg.py  encode.py  probe.py  render.py  schemas.py
│  ├─ jobs/
│  │   ├─ models.py         StudioFitJob
│  │   ├─ schemas.py        job request/response shapes
│  │   ├─ service.py        job lifecycle + execution
│  │   └─ worker.py         the pool, the claim, the semaphores
│  └─ studio/
│      ├─ models.py         StudioUser
│      ├─ schemas.py        public API shapes
│      ├─ service.py        upsert, budgets, capacity
│      ├─ deps.py           shared-secret auth + current_studio_user
│      └─ router.py         /api/ext/creative-fit/*
├─ alembic/versions/0001_initial.py
├─ dev_start.sh  dev_stop.sh  docker-compose.dev.yml
├─ Dockerfile  cloudbuild.yaml  pyproject.toml  .env.example
└─ CLAUDE.md
```

---

## Task 1: Scaffold the service so it boots

**Files:**
- Create: `markai-studio-api/pyproject.toml`
- Create: `markai-studio-api/app/__init__.py`, `app/core/__init__.py`
- Create: `markai-studio-api/app/core/config.py`
- Create: `markai-studio-api/app/core/database.py` (copy)
- Create: `markai-studio-api/app/core/logging_config.py` (copy)
- Create: `markai-studio-api/app/core/timezone.py` (copy)
- Create: `markai-studio-api/app/db_base.py` (copy)
- Create: `markai-studio-api/app/main.py`
- Create: `markai-studio-api/docker-compose.dev.yml`, `dev_start.sh`, `dev_stop.sh`
- Create: `markai-studio-api/.env.example`, `.gitignore`, `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `app.core.config.settings` (a `Settings` instance),
  `app.core.database.get_db`, `AsyncSessionLocal`, `engine`;
  `app.db_base.Base`; a FastAPI `app` in `app.main` answering `GET /health`
  with `{"status": "ok", "service": "markai-studio-api"}`.

- [ ] **Step 1: Create the repo and copy the files that move unchanged**

```bash
cd /Users/akshat/projects/MarkAi
mkdir -p markai-studio-api/app/core
cd markai-studio-api && git init
SRC=../markai-signage-api
cp $SRC/app/core/database.py       app/core/database.py
cp $SRC/app/core/logging_config.py app/core/logging_config.py
cp $SRC/app/core/timezone.py       app/core/timezone.py
cp $SRC/app/db_base.py             app/db_base.py
touch app/__init__.py app/core/__init__.py
```

- [ ] **Step 2: Write `pyproject.toml`**

Only what Studio uses. Dropped from signage-api's list: `cloudinary`,
`openpyxl`, `reportlab`, `maxminddb`, `aiosmtplib`, `email-validator`, `redis`,
`pyjwt` (no CMS login here — the upload token uses `itsdangerous`-free HMAC via
`hashlib`, see Task 4).

```toml
[tool.poetry]
name = "markai-studio-api"
version = "0.1.0"
description = "Mark AI Studio — public creative resizer backend"
authors = ["Mark AI <dev@markai.example>"]
package-mode = false

[tool.poetry.dependencies]
python = "^3.12"
fastapi = "^0.115.0"
uvicorn = {extras = ["standard"], version = "^0.32.0"}
sqlalchemy = "^2.0.36"
asyncpg = "^0.30.0"
greenlet = "^3.1.0"
alembic = "^1.14.0"
psycopg2-binary = "^2.9.10"
pydantic = "^2.10.0"
pydantic-settings = "^2.7.0"
python-dotenv = "^1.0.1"
python-multipart = "^0.0.32"
google-cloud-storage = "^3.12.0"
pydantic-ai-slim = {extras = ["google"], version = "^2.1.0"}
pillow = "^11.0.0"

[tool.poetry.group.dev.dependencies]
ruff = "^0.8.0"
mypy = "^1.13.0"

[tool.mypy]
explicit_package_bases = true
mypy_path = "."
ignore_missing_imports = true

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

- [ ] **Step 3: Write `app/core/config.py`**

Studio's own settings — do NOT copy signage-api's 600-line `Settings`. Values
for `GEMINI_*`, `VIDEO_*` and the fit tunables are copied across so the engine
behaves identically; everything CMS (screens, bookings, gmail, whatsapp, apk)
is absent.

```python
"""Settings for markai-studio-api.

Deliberately not a copy of signage-api's Settings. That class carries screens,
bookings, Gmail, WhatsApp and APK configuration, none of which exists here, and
a setting that is present but unused is a question every future reader has to
answer. What IS copied verbatim are the engine tunables — the Gemini model
names, the CRF, the fit thresholds — because a Studio rebuild has to be
indistinguishable from a CMS one.
"""

import json
import logging
from typing import List, Optional

from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    ENVIRONMENT: Optional[str] = "local"

    # Budgets reset at IST midnight, like everything else on this platform.
    APP_TIMEZONE: str = "Asia/Kolkata"

    DATABASE_URL: Optional[str] = None

    PROJECT_NAME: str = "MarkAI-Studio-API"
    VERSION: str = "0.1.0"
    API_PREFIX: str = "/api"
    CORS_ORIGINS: str = ""

    # --- Auth: the Studio BFF's shared secret -------------------------------
    # Replaces the api_keys table lookup, which lived in the CMS database. The
    # credential proves the caller is the Studio server, never a browser.
    STUDIO_EXT_API_KEY_ID: str = ""
    STUDIO_EXT_API_SECRET: str = ""

    # Comma-separated addresses that get an uncapped daily budget. Replaces the
    # cms_users lookup. NOTE: revocation is manual — removing a superadmin in
    # the CMS must include removing them here.
    STUDIO_UNLIMITED_EMAILS: str = ""

    # --- Storage ------------------------------------------------------------
    GCP_PROJECT_ID: Optional[str] = None
    GCP_BUCKET_NAME: str = "markai-storage"
    STORAGE_EMULATOR_HOST: Optional[str] = None
    UPLOAD_TOKEN_SECRET: str = "markai-dev-upload-token-secret"

    # --- Gemini (copied from signage-api so behaviour is identical) ---------
    GEMINI_API_KEY: Optional[str] = None
    CREATIVE_FIT_ANALYST_MODEL: Optional[str] = None
    CREATIVE_FIT_IMAGE_MODEL: Optional[str] = None

    # --- Input caps ---------------------------------------------------------
    STUDIO_MAX_IMAGE_BYTES: int = 10 * 1024 * 1024
    STUDIO_MAX_VIDEO_BYTES: int = 100 * 1024 * 1024
    CREATIVE_FIT_MAX_SIZE: str = "4K"
    VIDEO_PLACEMENT_MAX_SOURCE_SECONDS: int = 60

    # --- Worker pool --------------------------------------------------------
    # One ffmpeg at a time on one CPU is the correct number, not a limitation.
    STUDIO_VIDEO_CONCURRENCY: int = 1
    # 67 MP decoded is ~268 MB, and Pillow holds source and resized copy at
    # once, so two is the ceiling that fits 1 GiB.
    STUDIO_IMAGE_CONCURRENCY: int = 2
    CREATIVE_FIT_WORKERS: int = 3
    CREATIVE_FIT_POLL_SECONDS: float = 1.0
    CREATIVE_FIT_STALE_MINUTES: int = 5
    CREATIVE_FIT_VIDEO_STALE_MINUTES: int = 20
    CREATIVE_FIT_MAX_ATTEMPTS: int = 3
    CREATIVE_FIT_RETENTION_HOURS: int = 48
    CREATIVE_FIT_CLEANUP_INTERVAL_MINUTES: int = 60
    CREATIVE_FIT_HISTORY_LIMIT: int = 30

    # --- Daily budgets ------------------------------------------------------
    STUDIO_DAILY_REBUILD_LIMIT: int = 5
    STUDIO_DAILY_VIDEO_LIMIT: int = 5
    STUDIO_MAX_CONCURRENT_JOBS: int = 2

    # --- Video encode -------------------------------------------------------
    # CRF and resolution are fixed by the never-downscale rule. Preset is the
    # only lever, and it trades encoder time for file size at the same CRF.
    VIDEO_CRF: int = 17
    STUDIO_VIDEO_PRESET: str = "medium"
    VIDEO_GOP_SECONDS: float = 2.0
    STUDIO_VIDEO_MAX_LEVEL: str = "5.2"
    STUDIO_VIDEO_MAX_FPS: float = 60.0
    FFMPEG_TIMEOUT_SECONDS: int = 1800
    FFMPEG_BIN: str = "ffmpeg"
    FFPROBE_BIN: str = "ffprobe"

    @property
    def is_local(self) -> bool:
        return (self.ENVIRONMENT or "local").lower() in ("local", "dev", "development")

    @property
    def ai_enabled(self) -> bool:
        return bool(self.GEMINI_API_KEY)

    @property
    def unlimited_emails(self) -> set[str]:
        """Lowercased allowlist. Empty setting means nobody is uncapped."""
        raw = (self.STUDIO_UNLIMITED_EMAILS or "").strip()
        if not raw:
            return set()
        return {p.strip().lower() for p in raw.split(",") if p.strip()}

    @property
    def cors_origins(self) -> List[str]:
        raw = (self.CORS_ORIGINS or "").strip()
        if not raw:
            return []
        if raw.startswith("["):
            try:
                return [str(o) for o in json.loads(raw)]
            except json.JSONDecodeError:
                logger.warning("CORS_ORIGINS looked like JSON but did not parse.")
                return []
        return [o.strip() for o in raw.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
```

- [ ] **Step 4: Write `app/main.py`**

The worker pool import is deferred to Task 5; for now the lifespan is a stub so
the service boots and `/health` answers.

```python
"""Mark AI Studio's backend.

A second service alongside markai-signage-api, not a fork of it. It serves one
product: the public resizer at studio.mark-ai.tech. It has its own database,
its own job queue and its own worker pool, so a public video encode can no
longer take the operator CMS down with it.
"""

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logging_config import configure_logging

load_dotenv()
configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s ...", settings.PROJECT_NAME)
    yield
    logger.info("Shutting down %s ...", settings.PROJECT_NAME)


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    openapi_url="/openapi.json" if settings.is_local else None,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong. Please try again later."},
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "markai-studio-api"}
```

- [ ] **Step 5: Write `docker-compose.dev.yml`**

Ports 5435 and 4482 — 5433/4480 belong to signage-api and 5434/4481 to
backend-new.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: markai-studio-pg
    ports:
      - "5435:5432"
    environment:
      POSTGRES_USER: markai
      POSTGRES_PASSWORD: markai
      POSTGRES_DB: markai_studio
    volumes:
      - studio_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U markai -d markai_studio"]
      interval: 5s
      timeout: 5s
      retries: 10

  # Host port 4482 (4480 and 4481 are taken); set
  # STORAGE_EMULATOR_HOST=http://localhost:4482 in .env to use it.
  fake-gcs:
    image: fsouza/fake-gcs-server:latest
    container_name: markai-studio-gcs
    command: ["-scheme", "http", "-port", "4443", "-public-host", "localhost:4482", "-backend", "filesystem", "-filesystem-root", "/storage"]
    ports:
      - "4482:4443"
    volumes:
      - studio_gcs:/storage

volumes:
  studio_pg:
  studio_gcs:
```

- [ ] **Step 6: Write `dev_start.sh`**

```bash
#!/usr/bin/env bash
# Bring up Postgres (:5435) + fake-gcs (:4482), migrate, run uvicorn on :8097.
set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${YELLOW}[1/4] Starting Postgres and fake-gcs ...${NC}"
docker compose -f docker-compose.dev.yml up -d

echo -e "${YELLOW}[2/4] Waiting for Postgres ...${NC}"
until docker exec markai-studio-pg pg_isready -U markai -d markai_studio >/dev/null 2>&1; do
  sleep 1
done

RUN="poetry run"
echo -e "${YELLOW}[3/4] Running migrations ...${NC}"
$RUN alembic upgrade head

if PID=$(lsof -ti:8097 2>/dev/null); then
  echo -e "${YELLOW}Port 8097 in use — killing $PID${NC}"
  kill -9 "$PID" || true
fi

echo -e "${YELLOW}[4/4] Starting uvicorn on http://localhost:8097 ...${NC}"
echo -e "${GREEN}  API:  http://localhost:8097${NC}"
echo -e "${GREEN}  Docs: http://localhost:8097/docs${NC}"
echo -e "${GREEN}  DB:   postgresql://markai:markai@localhost:5435/markai_studio${NC}"
exec $RUN uvicorn app.main:app --reload --host 0.0.0.0 --port 8097
```

Then `chmod +x dev_start.sh dev_stop.sh`.

- [ ] **Step 7: Write `.env.example`**

```
ENVIRONMENT=local
DATABASE_URL=postgresql://markai:markai@localhost:5435/markai_studio
CORS_ORIGINS=http://localhost:5140

# The Studio BFF's credential. Any pair works locally; both halves must match
# markai-studio-web's STUDIO_EXT_API_KEY_ID / STUDIO_EXT_API_SECRET.
STUDIO_EXT_API_KEY_ID=studio-local
STUDIO_EXT_API_SECRET=studio-local-secret
STUDIO_UNLIMITED_EMAILS=

GCP_BUCKET_NAME=markai-storage
STORAGE_EMULATOR_HOST=http://localhost:4482
UPLOAD_TOKEN_SECRET=markai-dev-upload-token-secret

GEMINI_API_KEY=
```

- [ ] **Step 8: Verify it boots**

```bash
cd /Users/akshat/projects/MarkAi/markai-studio-api
poetry install
poetry run python -c "import app.main; print('ok')"
poetry run ruff check app
```
Expected: `ok`, and ruff reporting no errors.

Then, with `.env` copied from `.env.example`:
```bash
poetry run uvicorn app.main:app --port 8097 &
sleep 3 && curl -s localhost:8097/health
```
Expected: `{"status":"ok","service":"markai-studio-api"}`

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold markai-studio-api

A second FastAPI service for Mark AI Studio, built to signage-api's
conventions but carrying only what Studio uses. Boots and answers
/health; no engine, no database tables yet.

Settings are written fresh rather than copied: signage-api's Settings
carries screens, bookings, Gmail, WhatsApp and APK configuration that
does not exist here, and an unused setting is a question every future
reader has to answer. The engine tunables ARE copied verbatim so a
Studio rebuild stays indistinguishable from a CMS one.

Local ports 8097/5435/4482, following 8095/5433/4480 (signage-api) and
8096/5434/4481 (backend-new)."
```

---

## Task 2: Port the Creative Fit engine and the video boundary

**Files:**
- Create: `app/engine/__init__.py`, `agent.py`, `analysis.py`, `gemini_image.py`, `prompts.py`, `resizer.py`
- Create: `app/video/__init__.py`, `encode.py`, `ffmpeg.py`, `probe.py`, `render.py`, `schemas.py`

**Interfaces:**
- Consumes: `app.core.config.settings`.
- Produces:
  - `app.engine.analysis.FitAnalysis`, `analyse(...) -> FitAnalysis`
  - `app.engine.agent.read_creative(...) -> CreativeReading | None`, `CreativeReading`
  - `app.engine.gemini_image.rebuild_image(...)`
  - `app.engine.prompts.CREATIVE_FIT_ANALYST_PROMPT`, `build_rebuild_prompt`, `build_refine_prompt`
  - `app.engine.resizer.RESAMPLE`, `ResizeError`, `_has_alpha`, `_open`, `encode`
  - `app.video.probe.probe(path) -> VideoProbe`, `app.video.render.render_stretch(...) -> VideoVariant`

- [ ] **Step 1: Copy the files**

These have no CMS imports — `analysis.py`, `resizer.py` and `prompts.py` have
no `app.` imports at all; the rest import only `app.core.config`.

```bash
cd /Users/akshat/projects/MarkAi/markai-studio-api
SRC=../markai-signage-api
mkdir -p app/engine app/video
for f in agent analysis gemini_image prompts resizer; do
  cp $SRC/app/creative_fit/$f.py app/engine/$f.py
done
cp $SRC/app/video/*.py app/video/
touch app/engine/__init__.py
```

- [ ] **Step 2: Rewrite the import paths only**

```bash
cd /Users/akshat/projects/MarkAi/markai-studio-api
grep -rl "app\.creative_fit" app/engine | xargs sed -i '' 's/app\.creative_fit/app.engine/g'
grep -rn "app\.creative_fit" app/ || echo "no stale creative_fit imports"
```
Expected: `no stale creative_fit imports`.

Do not change anything else in these files. Verify with a diff that only import
lines moved:
```bash
diff <(sed 's/app\.creative_fit/app.engine/g' $SRC/app/creative_fit/agent.py) app/engine/agent.py \
  && echo "agent.py is a faithful copy"
```

- [ ] **Step 3: Write `app/engine/__init__.py`**

```python
"""The Creative Fit engine, copied verbatim from markai-signage-api.

`analysis` measures a fit and returns a verdict; `agent` has Gemini read the
artwork; `gemini_image` regenerates it; `resizer` does the Pillow work;
`prompts` holds the text of all three.

These files are a DELIBERATE duplicate of app/creative_fit/ in
markai-signage-api, not a shared package. A shared library would re-couple the
two services at the version level, which is the thing separating them was for.
They are pure functions with no database and no CMS imports, which is the least
dangerous kind of duplication — and the two copies are already meant to
diverge (Studio encodes to a higher H.264 ceiling than the AndBox can play).

If you change a prompt or a threshold here, ask whether the CMS needs the same
change. Usually it does.
"""
```

- [ ] **Step 4: Point the video encoder at Studio's preset**

`app/video/encode.py` reads `settings.VIDEO_PRESET`, which does not exist in
Studio's Settings. Change that one reference:

```bash
sed -i '' 's/settings\.VIDEO_PRESET/settings.STUDIO_VIDEO_PRESET/' app/video/encode.py
grep -n "STUDIO_VIDEO_PRESET" app/video/encode.py
```

Add `-threads 1` to the encoder arguments in `app/video/encode.py`, beside the
existing `-preset`. One CPU; extra threads cost memory and buy nothing:

```python
        "-threads",
        "1",
        "-preset",
        settings.STUDIO_VIDEO_PRESET,
```

- [ ] **Step 5: Verify every setting the ported code reads actually exists**

```bash
cd /Users/akshat/projects/MarkAi/markai-studio-api
poetry run python - <<'PY'
import re, pathlib
from app.core.config import settings
missing = set()
for p in list(pathlib.Path("app/engine").rglob("*.py")) + list(pathlib.Path("app/video").rglob("*.py")):
    for name in re.findall(r"settings\.([A-Z_][A-Z0-9_]*)", p.read_text()):
        if not hasattr(settings, name):
            missing.add(name)
print("MISSING:", sorted(missing) or "none")
PY
```
Expected: `MISSING: none`. If anything is listed, add it to `Settings` with the
value copied from signage-api's `config.py` — never with a guessed default.

- [ ] **Step 6: Verify imports and lint**

```bash
poetry run python -c "import app.engine.agent, app.engine.resizer, app.video.render; print('ok')"
poetry run ruff check app
```
Expected: `ok`, ruff clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: port the Creative Fit engine and video boundary verbatim

agent, analysis, gemini_image, prompts and resizer copied from
markai-signage-api's app/creative_fit/ with only their import paths
rewritten, plus all of app/video/. Same prompts, same model, same
thresholds, same CRF — a Studio rebuild has to be indistinguishable
from a CMS one.

Two deliberate deviations, both about running on one CPU: the encoder
reads STUDIO_VIDEO_PRESET (medium, not slow) and passes -threads 1.
Preset trades encoder time for file size at the same CRF, so output
resolution and quality are untouched.

A guard script asserts every settings.X the ported code reads exists,
so a missing tunable fails here rather than at the first Gemini call."
```

---

## Task 3: Streaming media helpers — the work that makes 1 GiB possible

**Files:**
- Create: `app/engine/media.py`
- Create: `app/core/gcs_service.py` (copied, plus streaming functions)
- Create: `app/core/security.py` (upload tokens only)

**Interfaces:**
- Consumes: `app.core.config.settings`.
- Produces:
  - `app.core.gcs_service.signed_url_for(blob_name, *, minutes=60) -> str`
  - `app.core.gcs_service.download_to_path(blob_name, dest: Path) -> None`
  - `app.core.gcs_service.upload_from_path(path: Path, blob_name, content_type) -> str`
  - `app.core.gcs_service.blob_size(blob_name) -> int | None`
  - `app.core.gcs_service.extract_blob_name_from_url(url) -> str | None`
  - `app.engine.media.source_signed_url(source_url) -> str` — what ffmpeg is fed
  - `app.engine.media.download_image_bytes(source_url, *, max_bytes) -> bytes`
  - `app.core.security.create_upload_token(...)`, `decode_upload_token(...)`

- [ ] **Step 1: Copy `gcs_service.py` and `security.py`, then trim**

```bash
cd /Users/akshat/projects/MarkAi/markai-studio-api
SRC=../markai-signage-api
cp $SRC/app/core/gcs_service.py app/core/gcs_service.py
cp $SRC/app/core/security.py    app/core/security.py
```

From `security.py` delete every function except `create_upload_token` and
`decode_upload_token` and whatever they call. There is no CMS login here, so
password hashing and JWT session helpers have no reason to exist. Confirm:

```bash
grep -n "^def \|^async def " app/core/security.py
```
Expected: only the upload-token functions.

- [ ] **Step 2: Add the streaming functions to `gcs_service.py`**

The existing `download_bytes_from_gcs` / `upload_to_gcs` stay for the image
path, which can afford 10 MB. These are for video, which cannot.

```python
def download_to_path(blob_name: str, dest: Path) -> None:
    """Stream a blob to a file. Never materialises it as bytes.

    On Cloud Run /tmp is a tmpfs, so `dest` is still memory — this is not free.
    It exists for callers that genuinely need a local file; the video path
    prefers `signed_url_for` and lets ffmpeg read over HTTPS instead, so the
    source never lands here at all.
    """
    blob = _bucket().blob(blob_name)
    with dest.open("wb") as fh:
        blob.download_to_file(fh)


def upload_from_path(path: Path, blob_name: str, content_type: str) -> str:
    """Stream a file to GCS. The counterpart to download_to_path.

    `upload_to_gcs` takes bytes, which for a video means holding the whole
    result in memory on the way out — the second of the four copies that made
    a 100 MB job cost half a gigabyte.
    """
    blob = _bucket().blob(blob_name)
    with path.open("rb") as fh:
        blob.upload_from_file(fh, content_type=content_type)
    return public_url_for(blob_name)


def blob_size(blob_name: str) -> Optional[int]:
    """The blob's real size, for enforcing a cap against a declared one."""
    blob = _bucket().get_blob(blob_name)
    return None if blob is None else blob.size
```

Adapt `_bucket()` / `public_url_for` to whatever the copied file already calls
them; do not introduce a second client.

- [ ] **Step 3: Write `app/engine/media.py`**

```python
"""How media gets in and out, and why it never sits in memory.

The rule this module exists to enforce: on Cloud Run `/tmp` is a tmpfs, so a
temp file is RAM. A 100 MB video held as bytes, written to /tmp, read back and
uploaded is FOUR copies of the same file — which is exactly how the shared CMS
container went past 1024 MiB and got killed twice on 2026-08-31.

So:
  * video sources are never downloaded here at all — ffmpeg is handed a signed
    URL and reads them over HTTPS range requests;
  * video results are written once, streamed out, and unlinked;
  * images may use bytes, because they are capped at 10 MB.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.core import gcs_service
from app.core.config import settings

logger = logging.getLogger(__name__)


async def source_signed_url(source_url: str) -> str:
    """A short-lived URL ffmpeg can read the source from directly.

    This is the single most important line in the 1 GiB budget: the source
    never becomes a `bytes` and never becomes a temp file.
    """
    blob_name = gcs_service.extract_blob_name_from_url(source_url)
    if not blob_name:
        # Already a plain URL we do not own — ffmpeg can read it as-is.
        return source_url
    return await run_in_threadpool(gcs_service.signed_url_for, blob_name)


async def assert_within_cap(source_url: str, *, max_bytes: int) -> None:
    """Refuse an oversize source using the blob's REAL size.

    The declared size in the upload session is a claim by the client. This is
    the third of the three enforcement points and the only one that cannot be
    lied to.
    """
    blob_name = gcs_service.extract_blob_name_from_url(source_url)
    if not blob_name:
        return
    size = await run_in_threadpool(gcs_service.blob_size, blob_name)
    if size is not None and size > max_bytes:
        limit_mb = max_bytes // (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"That file is larger than the {limit_mb}MB limit.",
        )


async def download_image_bytes(source_url: str, *, max_bytes: int) -> bytes:
    """Fetch an image as bytes. Images only — capped at 10 MB, so this is safe.

    Do not reach for this on the video path. That is what this module exists
    to prevent.
    """
    await assert_within_cap(source_url, max_bytes=max_bytes)
    blob_name = gcs_service.extract_blob_name_from_url(source_url)
    if blob_name:
        data = await run_in_threadpool(gcs_service.download_bytes_from_gcs, blob_name)
        if data:
            if len(data) > max_bytes:
                limit_mb = max_bytes // (1024 * 1024)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"That creative is larger than the {limit_mb}MB limit.",
                )
            return data
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="The creative file could not be read from storage.",
    )


async def upload_result(path: Path, blob_name: str, content_type: str) -> str:
    """Stream a finished render to GCS and delete the local copy immediately."""
    try:
        return await run_in_threadpool(
            gcs_service.upload_from_path, path, blob_name, content_type
        )
    finally:
        path.unlink(missing_ok=True)
```

- [ ] **Step 4: Verify**

```bash
poetry run python -c "import app.engine.media, app.core.security; print('ok')"
poetry run ruff check app
grep -rn "read_bytes\|write_bytes" app/engine app/video || echo "no whole-file bytes round-trips"
```
Expected: `ok`, ruff clean, and the grep reporting nothing in the video path.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: streaming media helpers so 100 MB fits in 1 GiB

On Cloud Run /tmp is a tmpfs, so a temp file is RAM. The inherited path
held a video FOUR times over — download bytes, tmpfs source, output
bytes, upload bytes — which is how the shared container passed 1024 MiB
and was killed twice on 2026-08-31.

source_signed_url() is the line that fixes it: ffmpeg is handed a signed
URL and reads the source over HTTPS range requests, so it never becomes
a bytes and never becomes a file. Results stream out via
upload_from_path and are unlinked immediately.

Images keep the bytes path deliberately — they are capped at 10 MB.
security.py is trimmed to the upload-token pair; there is no CMS login
here to need the rest."
```

---

## Task 4: The database — two tables, one migration

**Files:**
- Create: `app/studio/__init__.py`, `app/studio/models.py`
- Create: `app/jobs/__init__.py`, `app/jobs/models.py`
- Create: `app/models.py`
- Create: `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`, `alembic/versions/0001_initial.py`

**Interfaces:**
- Consumes: `app.db_base.Base`.
- Produces: `app.studio.models.StudioUser`, `app.jobs.models.StudioFitJob`, and
  the status/mode/media constants `STATUS_QUEUED`, `STATUS_RUNNING`,
  `STATUS_DONE`, `STATUS_FAILED`, `STATUS_CANCELLED`, `MODE_AUTO`, `MODE_RESIZE`,
  `MODE_REBUILD`, `MEDIA_IMAGE`, `MEDIA_VIDEO`.

- [ ] **Step 1: Copy `StudioUser` unchanged**

```bash
cd /Users/akshat/projects/MarkAi/markai-studio-api
mkdir -p app/studio app/jobs
touch app/studio/__init__.py app/jobs/__init__.py
cp ../markai-signage-api/app/studio/models.py app/studio/models.py
```

The file needs no edits — it imports only `app.db_base.Base`. Its docstring
already explains why `unlimited` is a class attribute rather than a column, and
that reasoning survives the move intact.

- [ ] **Step 2: Write `app/jobs/models.py`**

```python
"""A Studio fit job. One owner, no discriminator.

This is `creative_fit_jobs` from markai-signage-api with everything the CMS put
there removed. The important absence is `owner_kind`: that column and its CHECK
constraint existed only to keep two products from leaking into each other while
they shared a table. With one product per database there is nothing to
discriminate, and every "did you remember the owner_kind filter?" hazard in the
old service.py goes with it.

Also gone: `cms_user_id` (no CMS users here), `api_key_id` (attribution to a
table that no longer exists — there is exactly one caller and it is the BFF),
and `source_media_id` / `result_media_id` / `deliver` / `target_screen_id`,
which are Content-library and screen concepts.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db_base import Base

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

MODE_AUTO = "auto"
MODE_RESIZE = "resize"
MODE_REBUILD = "rebuild"

MEDIA_IMAGE = "image"
MEDIA_VIDEO = "video"


def _uuid() -> str:
    return str(uuid.uuid4())


class StudioFitJob(Base):
    __tablename__ = "studio_fit_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    studio_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("studio_users.id", ondelete="CASCADE"), nullable=False
    )

    # Routes the worker: image -> Pillow, video -> ffmpeg.
    media_kind: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default=MEDIA_IMAGE
    )

    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_width: Mapped[int] = mapped_column(Integer, nullable=False)
    source_height: Mapped[int] = mapped_column(Integer, nullable=False)

    target_width: Mapped[int] = mapped_column(Integer, nullable=False)
    target_height: Mapped[int] = mapped_column(Integer, nullable=False)

    # resize | rebuild. A video is a resize whose fit_mode is stretch — that is
    # what it is, and it needs no third mode value to say so.
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    fit_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    anchor: Mapped[str | None] = mapped_column(String(16), nullable=True)
    pad_fill: Mapped[str | None] = mapped_column(String(16), nullable=True)
    pad_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    user_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    parent_job_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("studio_fit_jobs.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=STATUS_QUEUED, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    rebuild_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    result_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    result_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # The claim statement's WHERE clause, in index form.
        Index("ix_studio_fit_jobs_status_created", "status", "created_at"),
        # Budgets are a SUM over this user's rows since IST midnight, and the
        # history strip reads the same two columns.
        Index("ix_studio_fit_jobs_user_created", "studio_user_id", "created_at"),
    )
```

- [ ] **Step 3: Write `app/models.py`**

```python
"""Import every model so Alembic's autogenerate sees a complete metadata."""

from app.db_base import Base  # noqa: F401
from app.jobs.models import StudioFitJob  # noqa: F401
from app.studio.models import StudioUser  # noqa: F401
```

- [ ] **Step 4: Initialise Alembic and point it at our metadata**

```bash
poetry run alembic init alembic
```

Then edit `alembic/env.py`: replace its `target_metadata = None` and URL
handling with

```python
from app.core.database import get_sync_database_url
from app.db_base import Base
import app.models  # noqa: F401  — registers every table on Base.metadata

config.set_main_option("sqlalchemy.url", get_sync_database_url())
target_metadata = Base.metadata
```

- [ ] **Step 5: Write `alembic/versions/0001_initial.py`**

Hand-written rather than autogenerated, so the comments survive.

```python
"""Studio's own two tables.

Both are lifted from markai-signage-api, where they lived in the CMS database
because Studio had no backend of its own. `studio_users` is unchanged from
migration 0060 there. `studio_fit_jobs` is `creative_fit_jobs` minus everything
the CMS put on it — most importantly `owner_kind` and its CHECK constraint,
which existed solely to stop two products leaking into each other while they
shared one table.

Revision ID: 0001_initial
Revises:
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "studio_users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        # Google's stable subject id. Unique because it IS the identity — the
        # sign-in upsert keys on it. Not the email: a Google account can change
        # its email while the subject id survives.
        sa.Column("google_sub", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column(
            "is_blocked", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("daily_rebuild_override", sa.Integer(), nullable=True),
        sa.Column("daily_video_override", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_studio_users_google_sub", "studio_users", ["google_sub"], unique=True
    )

    op.create_table(
        "studio_fit_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "studio_user_id",
            sa.String(length=36),
            sa.ForeignKey("studio_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "media_kind", sa.String(length=8), nullable=False, server_default="image"
        ),
        sa.Column("source_url", sa.String(length=2048), nullable=False),
        sa.Column("source_name", sa.String(length=255), nullable=True),
        sa.Column("source_width", sa.Integer(), nullable=False),
        sa.Column("source_height", sa.Integer(), nullable=False),
        sa.Column("target_width", sa.Integer(), nullable=False),
        sa.Column("target_height", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("fit_mode", sa.String(length=16), nullable=True),
        sa.Column("anchor", sa.String(length=16), nullable=True),
        sa.Column("pad_fill", sa.String(length=16), nullable=True),
        sa.Column("pad_color", sa.String(length=16), nullable=True),
        sa.Column("user_note", sa.Text(), nullable=True),
        sa.Column(
            "parent_job_id",
            sa.String(length=36),
            sa.ForeignKey("studio_fit_jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="queued"
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("analysis", sa.JSON(), nullable=True),
        sa.Column("rebuild_prompt", sa.Text(), nullable=True),
        sa.Column("result_url", sa.String(length=2048), nullable=True),
        sa.Column("result_width", sa.Integer(), nullable=True),
        sa.Column("result_height", sa.Integer(), nullable=True),
        sa.Column("result_bytes", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_studio_fit_jobs_status", "studio_fit_jobs", ["status"])
    # The claim statement's WHERE clause, in index form.
    op.create_index(
        "ix_studio_fit_jobs_status_created", "studio_fit_jobs", ["status", "created_at"]
    )
    # Budgets SUM this user's rows since IST midnight; history reads the same two.
    op.create_index(
        "ix_studio_fit_jobs_user_created",
        "studio_fit_jobs",
        ["studio_user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("studio_fit_jobs")
    op.drop_index("ix_studio_users_google_sub", table_name="studio_users")
    op.drop_table("studio_users")
```

- [ ] **Step 6: Migrate an empty database and check for drift**

```bash
docker compose -f docker-compose.dev.yml up -d
poetry run alembic upgrade head
poetry run alembic check
```
Expected: `upgrade head` succeeds; `alembic check` reports **no** new upgrade
operations. If it reports differences, the hand-written migration and the models
disagree — fix the migration, not the model.

```bash
docker exec markai-studio-pg psql -U markai -d markai_studio -c '\d studio_fit_jobs'
```
Expected: no `owner_kind`, no `cms_user_id`, no `api_key_id` column.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: studio_users and studio_fit_jobs, migration 0001

studio_users moves across unchanged from signage-api's 0060.
studio_fit_jobs is creative_fit_jobs with everything the CMS put on it
removed — owner_kind and its CHECK constraint above all, which existed
only to keep two products from leaking into each other while they shared
a table. One product per database means nothing to discriminate, and
every 'did you remember the owner_kind filter?' hazard goes with it.

Also dropped: cms_user_id, api_key_id, and the Content-library and
screen columns.

Migration is hand-written rather than autogenerated so the reasoning
survives in the file; alembic check asserts it matches the models."
```

---

## Task 5: Job service and worker pool, with a cancel that actually cancels

**Files:**
- Create: `app/jobs/schemas.py`, `app/jobs/service.py`, `app/jobs/worker.py`
- Modify: `app/video/ffmpeg.py` (generalise the watchdog)
- Modify: `app/main.py` (start/stop the pool)

**Interfaces:**
- Consumes: `app.jobs.models.StudioFitJob`, `app.engine.*`, `app.video.*`,
  `app.engine.media`.
- Produces:
  - `app.jobs.service.create_job(db, user, req) -> StudioFitJob`
  - `app.jobs.service.get_job(db, user, job_id) -> StudioFitJob`
  - `app.jobs.service.list_jobs(db, user, limit, offset) -> tuple[list, int]`
  - `app.jobs.service.cancel_job(db, user, job_id) -> StudioFitJob`
  - `app.jobs.service.refine_job(db, user, job_id, req) -> StudioFitJob`
  - `app.jobs.service.execute_job(db, job) -> None`
  - `app.jobs.service.is_cancelled(job_id) -> bool` (sync, for the watchdog)
  - `app.jobs.worker.start_workers()`, `await stop_workers()`
  - `app.jobs.schemas.JobResponse`, `CreateJobRequest`, `RefineRequest`

- [ ] **Step 1: Port the job lifecycle into `app/jobs/service.py`**

Start from `markai-signage-api/app/creative_fit/service.py` and take only the
job half. Drop `resolve_source` (MediaAsset), `resolve_target` (Screen),
`list_screen_targets`, `_register_media`, `queue_chat_fit`, and every
`owner_kind` filter — reads scope on `studio_user_id` alone.

Two behavioural changes, both required by Task 3:

```python
async def _execute_video_job(db: AsyncSession, job: StudioFitJob) -> None:
    """Stretch a video. The only video operation there is.

    The source is NOT downloaded. ffmpeg is given a signed URL and reads it
    over HTTPS; the result is written once and streamed out. Holding a 100 MB
    source as bytes is what killed the shared container, and this path is why
    1 GiB is enough here.
    """
    await _check_cancelled(db, job)
    await media.assert_within_cap(
        job.source_url, max_bytes=settings.STUDIO_MAX_VIDEO_BYTES
    )
    src_url = await media.source_signed_url(job.source_url)

    async with _video_slot:
        out_path, variant = await run_in_threadpool(
            _stretch_to_file, src_url, job.target_width, job.target_height, job.id
        )

    await _check_cancelled(db, job)
    blob_name = f"{RESULT_PREFIX}/studio-{job.studio_user_id}/{job.id}.mp4"
    result_bytes = out_path.stat().st_size
    result_url = await media.upload_result(out_path, blob_name, "video/mp4")
    ...
```

and

```python
def _stretch_to_file(
    src_url: str, width: int, height: int, job_id: str
) -> tuple[Path, "VideoVariant"]:
    """Run the encode and return the OUTPUT PATH — never its bytes.

    The temp directory is not cleaned up here: the caller streams the file to
    GCS and unlinks it (media.upload_result), because reading it back into
    memory to hand it over is the copy this whole design exists to remove.
    """
    tmp = Path(tempfile.mkdtemp(prefix="studio-fit-"))
    measured = video_probe.probe_url(src_url)
    if measured.duration_seconds > settings.VIDEO_PLACEMENT_MAX_SOURCE_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"That video is {measured.duration_seconds:.0f} seconds long. "
                f"The limit is {settings.VIDEO_PLACEMENT_MAX_SOURCE_SECONDS} — "
                "trim it to the spot you want on screen and try again."
            ),
        )
    out = tmp / "result.mp4"
    variant = video_render.render_stretch(
        src_url, out, measured, width, height,
        max_fps=settings.STUDIO_VIDEO_MAX_FPS,
        max_level=settings.STUDIO_VIDEO_MAX_LEVEL,
        should_stop=lambda: is_cancelled(job_id),
    )
    return out, variant
```

`video_probe.probe` and `video_render.render_stretch` take a `Path` today; widen
both to accept `str | Path` so a signed URL works, and add `probe_url` as a thin
alias. ffprobe reads HTTPS the same way ffmpeg does.

- [ ] **Step 2: Add the synchronous cancel probe**

```python
def is_cancelled(job_id: str) -> bool:
    """Has this job been stopped? Synchronous — called from a watchdog THREAD.

    Its own short-lived psycopg2 connection, not the worker's async session:
    the caller is a plain thread with no event loop, and a read on the worker's
    session would hold a transaction open across the whole encode.
    """
    from sqlalchemy import create_engine, text

    from app.core.database import get_sync_database_url

    eng = create_engine(get_sync_database_url(), pool_pre_ping=True)
    try:
        with eng.connect() as conn:
            row = conn.execute(
                text("SELECT status FROM studio_fit_jobs WHERE id = :id"),
                {"id": job_id},
            ).scalar_one_or_none()
        return row == STATUS_CANCELLED
    finally:
        eng.dispose()
```

- [ ] **Step 3: Generalise the ffmpeg watchdog so cancel can kill the encode**

In `app/video/ffmpeg.py`, `_watch_timeout` already kills a `Popen` when a
condition fires. Give it a second reason:

```python
def _watch(
    process: subprocess.Popen,
    wait: float,
    finished: threading.Event,
    timed_out: threading.Event,
    stopped: threading.Event,
    should_stop: Callable[[], bool] | None = None,
    poll_seconds: float = 2.0,
) -> None:
    """Kill `process` when it hangs OR when the job it belongs to is cancelled.

    One watchdog with two reasons to fire, rather than two threads doing the
    same job alongside each other. The cancel poll matters more than it looks:
    the video semaphore is 1, so an encode nobody wants any more holds the only
    slot — and on a one-CPU container, the only CPU — until it finishes.
    """
    deadline = time.monotonic() + wait
    while not finished.wait(min(poll_seconds, max(0.0, deadline - time.monotonic()))):
        if time.monotonic() >= deadline:
            timed_out.set()
            process.kill()
            return
        if should_stop is not None and should_stop():
            stopped.set()
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            return
```

Thread `should_stop` through `run()` and `render_stretch()`, and raise
`JobCancelled` when `stopped` is set.

- [ ] **Step 4: Write `app/jobs/worker.py`**

Port signage-api's `worker.py`, with three changes: the table name, no
`owner_kind` in the ordering, and the semaphores.

```python
# Two semaphores, because the two media kinds fail differently at 1 GiB.
# Video: one ffmpeg at a time on one CPU is the correct number, not a limit.
# Image: 67 MP decodes to ~268 MB and Pillow holds source and resized copy at
# once, so two is what fits.
_video_slot = asyncio.Semaphore(settings.STUDIO_VIDEO_CONCURRENCY)
_image_slot = asyncio.Semaphore(settings.STUDIO_IMAGE_CONCURRENCY)

_CLAIM_SQL = text(
    """
    UPDATE studio_fit_jobs
       SET status = :running, claimed_at = now(), attempts = attempts + 1
     WHERE id = (
           SELECT id FROM studio_fit_jobs
            WHERE status = :queued AND attempts < :max_attempts
            ORDER BY created_at
              FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id;
    """
)
```

Both slots are acquired and released in a `finally`, so a cancelled job hands
its slot back as the worker unwinds rather than at the end of an encode that no
longer matters.

Keep `reclaim_stale` — with `CREATIVE_FIT_STALE_MINUTES = 5` for images and
`CREATIVE_FIT_VIDEO_STALE_MINUTES = 20` for video — and fix the bug the CMS
still has: when `attempts >= CREATIVE_FIT_MAX_ATTEMPTS` the sweep must mark the
job `failed`, not leave it `running` forever.

```python
# A job out of attempts is FAILED, not left running. In the CMS this row sits
# in `running` for ever and the spinner never resolves, because each OOM burns
# an attempt without writing a terminal status. Terminate it here.
await session.execute(
    update(StudioFitJob)
    .where(
        StudioFitJob.status == STATUS_RUNNING,
        StudioFitJob.claimed_at < stale_before(),
        StudioFitJob.attempts >= settings.CREATIVE_FIT_MAX_ATTEMPTS,
    )
    .values(
        status=STATUS_FAILED,
        finished_at=func.now(),
        error="This fit did not finish after several attempts.",
    )
)
```

- [ ] **Step 5: Start the pool in `app/main.py`**

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s ...", settings.PROJECT_NAME)

    # Refuse to start on a config that makes the daily budget unenforceable.
    # The budget is a SUM over job rows since IST midnight, so a retention
    # sweep shorter than a day deletes rows the budget still has to count —
    # and the only symptom is the bill. Fatal rather than a warning: a warning
    # in a Cloud Run log is not seen.
    from app.studio.service import assert_retention_outlasts_budget_window

    assert_retention_outlasts_budget_window()

    try:
        from app.jobs.worker import start_workers

        start_workers()
    except Exception:  # pragma: no cover - never block startup on the pool
        logger.exception("Studio worker pool failed to start; continuing.")

    try:
        yield
    finally:
        try:
            from app.jobs.worker import stop_workers

            await stop_workers()
        except Exception:  # pragma: no cover
            logger.exception("Studio worker pool shutdown error.")
        logger.info("Shutting down %s ...", settings.PROJECT_NAME)
```

- [ ] **Step 6: Verify**

```bash
poetry run python -c "import app.main, app.jobs.worker, app.jobs.service; print('ok')"
poetry run ruff check app
grep -n "owner_kind" app/ -r || echo "no owner_kind anywhere"
```
Expected: `ok`, ruff clean, `no owner_kind anywhere`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Studio's own job service and worker pool

Ports the job lifecycle from signage-api's creative_fit/service.py,
dropping the CMS half wholesale — resolve_source (MediaAsset),
resolve_target (Screen), list_screen_targets, _register_media,
queue_chat_fit — and every owner_kind filter, since reads now scope on
studio_user_id alone.

The video path no longer downloads its source or reads its result back:
ffmpeg takes a signed URL in and the output streams to GCS.

Cancel now actually cancels a running encode. subprocess.run owns the
blocking call, so the fix is the watchdog that already exists in
ffmpeg.py for hung children — generalised to fire on a cancel predicate
as well. One watchdog with two reasons to fire beats two threads doing
the same job. This matters more at 1 CPU than it did at 2: the video
semaphore is 1, so an unwanted encode holds the only slot.

Also fixes a bug the CMS still has: a job out of attempts is marked
failed by the stale sweep instead of sitting in 'running' for ever."
```

---

## Task 6: The public API at parity

**Files:**
- Create: `app/studio/deps.py`, `app/studio/schemas.py`, `app/studio/service.py`, `app/studio/router.py`
- Modify: `app/main.py` (include the router)

**Interfaces:**
- Consumes: everything above.
- Produces: `/api/ext/creative-fit/{status,upload,upload-session,upload-commit,analyze,jobs}`
  with request and response shapes byte-identical to the current Studio API, so
  `markai-studio-web` needs no component changes.

- [ ] **Step 1: Write `app/studio/deps.py` — shared-secret auth**

```python
"""Who is allowed in, and who they say they are.

Two credentials ride every call and they answer different questions:

    X-Api-Key-Id / X-Api-Secret   proves the CALLER is the Studio server
    X-Studio-User                 names WHICH end user is behind the request

The key used to be a row in `api_keys` with a `can_use_creative_fit` flag. That
table stayed in the CMS database, so it is now a shared secret held in this
service's own configuration and compared in constant time. The security
property is unchanged and simpler to state: this credential proves the caller
is the Studio BFF and never a browser.
"""

import secrets

from fastapi import Depends, Header, HTTPException, status


async def require_studio_caller(
    x_api_key_id: str = Header(default="", alias="X-Api-Key-Id"),
    x_api_secret: str = Header(default="", alias="X-Api-Secret"),
) -> None:
    expected_id = settings.STUDIO_EXT_API_KEY_ID
    expected_secret = settings.STUDIO_EXT_API_SECRET
    if not expected_id or not expected_secret:
        # A deployment that never set the pair should say so, not 401 in a way
        # that reads like the user's fault.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Studio is not configured on this server.",
        )
    # compare_digest on BOTH halves, and both always evaluated, so neither the
    # id nor the secret leaks a length or a prefix through timing.
    ok_id = secrets.compare_digest(x_api_key_id, expected_id)
    ok_secret = secrets.compare_digest(x_api_secret, expected_secret)
    if not (ok_id and ok_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials."
        )
```

- [ ] **Step 2: Port `app/studio/service.py`**

Copy from signage-api and change exactly one function — `_is_cms_superadmin`
becomes an allowlist check, because there is no `cms_users` table here:

```python
def _is_unlimited(email: Optional[str]) -> bool:
    """Is this address granted an uncapped daily budget?

    In signage-api this was an indexed lookup against `cms_users`, affordable
    on every request because Studio shared the CMS database. It no longer does.

    The cost of the replacement, stated plainly so nobody discovers it later:
    revocation is no longer automatic. Deactivating an operator in the CMS used
    to take their uncapped Studio budget with it. Now removing a superadmin
    must ALSO mean removing them from STUDIO_UNLIMITED_EMAILS, or they keep
    spending our Gemini budget until someone notices.
    """
    address = (email or "").strip().lower()
    return bool(address) and address in settings.unlimited_emails
```

The caller in `upsert_user` keeps its `email_verified` guard unchanged — without
it, anyone able to assert an address they do not own hands themselves an
unlimited budget:

```python
    user.unlimited = bool(email_verified) and _is_unlimited(email)
```

All of `budgets`, `reserve`, `_spent_today`, `_limits`, `_state`,
`assert_capacity`, `jobs_in_flight` and
`assert_retention_outlasts_budget_window` port unchanged apart from
`CreativeFitJob` → `StudioFitJob` and dropping the `owner_kind` filter.

- [ ] **Step 3: Port `app/studio/router.py`**

From `markai-signage-api/app/studio/ext_router.py`, with:
- `Depends(require_creative_fit_key)` → `Depends(require_studio_caller)`
- `CreativeFitJob` → `StudioFitJob`, no `owner_kind` / `api_key_id`
- `fit_service` → `app.jobs.service`
- the caps split by media kind:

```python
    max_bytes = (
        settings.STUDIO_MAX_VIDEO_BYTES
        if payload.media_kind == MEDIA_VIDEO
        else settings.STUDIO_MAX_IMAGE_BYTES
    )
```

Add the disconnect check to `/analyze`, which is synchronous and has no job id
to cancel:

```python
@router.post("/analyze", response_model=StudioAnalyzeResponse)
async def studio_analyze(
    payload: StudioAnalyzeRequest,
    request: Request,
    user: StudioUser = Depends(current_studio_user),
) -> StudioAnalyzeResponse:
    """Measure an image against a size. Creates no job and spends no budget.

    Stopping this one is the client aborting the request — there is no row to
    cancel. Honour that before the Gemini call, so someone who changes their
    mind mid-upload does not pay for a verdict nobody will read.
    """
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="Client closed the request.")
    ...
```

Mount it in `app/main.py`:

```python
from app.studio.router import router as studio_router

app.include_router(studio_router, prefix="/api/ext/creative-fit", tags=["studio"])
```

- [ ] **Step 4: Verify the surface matches the old one exactly**

```bash
poetry run uvicorn app.main:app --port 8097 &
sleep 3
curl -s localhost:8097/openapi.json | python3 -c "
import json,sys
paths = sorted(json.load(sys.stdin)['paths'])
for p in paths: print(p)
"
```
Expected, exactly these under the prefix: `/status`, `/upload`,
`/upload-session`, `/upload-commit`, `/analyze`, `/jobs`, `/jobs/{job_id}`,
`/jobs/{job_id}/cancel`, `/jobs/{job_id}/refine`.

Then check auth actually bites:
```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8097/api/ext/creative-fit/status
curl -s -H 'X-Api-Key-Id: studio-local' -H 'X-Api-Secret: wrong' \
     -o /dev/null -w '%{http_code}\n' localhost:8097/api/ext/creative-fit/status
```
Expected: `401` then `401`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Studio's public API at parity on its own service

Same paths, same request and response shapes as the /api/ext/creative-fit
routes in signage-api, so markai-studio-web needs no component changes —
only the URL it points at.

Two credentials that used to be database lookups are now configuration.
The api_keys row with can_use_creative_fit becomes a shared secret
compared with compare_digest; the cms_users query behind the superadmin
budget exemption becomes STUDIO_UNLIMITED_EMAILS. The second one costs
automatic revocation and the docstring says so: removing a superadmin
from the CMS must now also mean removing them from that setting.

POST /analyze is synchronous and has no job id to cancel, so stopping it
is the client aborting the request — honoured before the Gemini call."
```

---

## Task 7: Point the frontend at the new service

**Files:**
- Modify: `markai-studio-web/src/app/api/studio/[...path]/route.ts`
- Modify: `markai-studio-web/cloudbuild.yaml`
- Modify: `markai-studio-web/.env.example` (create if absent)

**Interfaces:**
- Consumes: the API surface from Task 6.
- Produces: nothing new. This is a rename.

- [ ] **Step 1: Rename the backend variable**

In `route.ts`:
```typescript
const BACKEND = process.env.STUDIO_API_URL ?? "http://localhost:8097";
```

- [ ] **Step 2: Fix the 502 message, which currently names the wrong repo**

It exists to stop a reader looking in the wrong place, so a stale name is worse
than no message:

```typescript
      {
        detail:
          "Can't reach the Mark AI Studio backend. Check that markai-studio-api " +
          `is running and that STUDIO_API_URL (${BACKEND}) points at it.`,
      },
```

- [ ] **Step 3: Update `cloudbuild.yaml`**

```yaml
  _STUDIO_API_URL: "https://studio-api.mark-ai.tech"
```
and in the deploy step's `--set-env-vars`, replace
`SIGNAGE_API_URL=${_SIGNAGE_API_URL}` with `STUDIO_API_URL=${_STUDIO_API_URL}`.

- [ ] **Step 4: Verify nothing else references the old variable**

```bash
cd /Users/akshat/projects/MarkAi/markai-studio-web
grep -rn "SIGNAGE_API_URL" src cloudbuild.yaml .env* 2>/dev/null || echo "clean"
npm run build
```
Expected: `clean`, and a successful build.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: point Studio at its own backend

SIGNAGE_API_URL becomes STUDIO_API_URL. The BFF composes its target as
\${BACKEND}/api/ext/creative-fit/\${path}, and the new service keeps that
path, so this is the whole frontend change — no component, hook or
screen moves.

The 502 message named markai-signage-api, which exists precisely to stop
someone debugging the wrong repo; it now names markai-studio-api."
```

---

## Task 8: End-to-end verification

**Files:** none — this task runs the system.

- [ ] **Step 1: Bring both sides up**

```bash
cd /Users/akshat/projects/MarkAi/markai-studio-api && ./dev_start.sh &
cd /Users/akshat/projects/MarkAi/markai-studio-web && npm run dev &
```
Studio on `:5140`, its API on `:8097`.

- [ ] **Step 2: Walk the image path in the browser**

Sign in with Google, upload an image, analyze, resize, rebuild, refine. Each
must behave exactly as it does against `cms-back` today.

- [ ] **Step 3: Walk the video path and watch memory**

Upload a ~100 MB video and stretch it. In another terminal:

```bash
while true; do ps -o rss=,comm= -p $(pgrep -f "uvicorn app.main:app" | head -1) \
  | awk '{printf "%.0f MB  %s\n", $1/1024, $2}'; sleep 2; done
```
Expected: peak RSS stays well under 1024 MB. If it does not, the source is being
downloaded somewhere — find the `bytes` and remove it.

- [ ] **Step 4: The stop pass — the one most likely to regress silently**

```bash
# Cancel a queued job: no worker ever sees it.
# Cancel a running image job: stops at the next checkpoint.
# Cancel a running VIDEO job, then immediately:
pgrep -fl ffmpeg
```
Expected after cancelling a video: **no ffmpeg process**. An API response
saying `cancelled` is not evidence — the whole bug being fixed here is that the
row said cancelled while ffmpeg kept running.

Then confirm the next queued job starts immediately rather than waiting for the
abandoned encode.

- [ ] **Step 5: The caps pass**

```bash
# An 11 MB image and a 101 MB video must both be refused with 413.
# A 10 MB PNG that decodes to 20000x20000 must be refused, not OOM the server.
```
Expected: `413` for the oversize files; the decompression bomb refused by
`Image.MAX_IMAGE_PIXELS` with a clean error and the server still up.

- [ ] **Step 6: The budget pass**

Exhaust `STUDIO_DAILY_REBUILD_LIMIT`, then confirm `mode=auto` degrades to a
resize rather than returning 429 — someone out of AI budget should still get a
resize, which costs us nothing. Add an address to `STUDIO_UNLIMITED_EMAILS` and
confirm it is uncapped; confirm an unverified email is not.

- [ ] **Step 7: Commit any fixes, then report**

Report to the user: peak RSS observed for a 100 MB video, whether ffmpeg died
on cancel, and the caps and budget results. Do not proceed to Task 9 without
sign-off — everything after this point touches production.

---

## Task 9: Deploy (requires user sign-off)

**Files:**
- Create: `markai-studio-api/Dockerfile`, `cloudbuild.yaml`

- [ ] **Step 1: Write the Dockerfile** — signage-api's, minus what Studio lacks.

```dockerfile
FROM python:3.12-slim

LABEL service.name="markai-studio-api"

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_CACHE_DIR=/tmp/.cache \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential libpq-dev curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml poetry.lock* ./
RUN pip install --no-cache-dir poetry \
    && poetry install --no-root --only main

COPY . .

EXPOSE 8080

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
```

- [ ] **Step 2: Create the Cloud SQL database and the secrets**

```bash
gcloud sql databases create markai_studio \
  --instance=markai-pg-usc1 --project=markai-499512
```
Then create `STUDIO_DATABASE_URL`, `STUDIO_EXT_API_SECRET_BACKEND` and
`STUDIO_UNLIMITED_EMAILS` in Secret Manager. `STUDIO_EXT_API_SECRET_BACKEND`
must hold the same value as `markai-studio-web`'s `STUDIO_EXT_API_SECRET`.

- [ ] **Step 3: Write `cloudbuild.yaml`**

Sizing per the spec — 1 CPU / 1 Gi, gen2 required for the ffmpeg-over-HTTPS
input:

```yaml
      - --execution-environment=gen2
      - --cpu=1
      - --memory=1Gi
      - --min-instances=0
      - --max-instances=3
      - --no-cpu-throttling
      - --no-invoker-iam-check
      - --service-account=studio-api-runtime@$PROJECT_ID.iam.gserviceaccount.com
```

- [ ] **Step 4: Deploy, map `studio-api.mark-ai.tech`, verify `/health`.**

- [ ] **Step 5: Commit.**

---

## Task 10: Migrate the live data (requires user sign-off)

- [ ] **Step 1: Put Studio into a maintenance window.** Do not migrate rows in
  `status='running'` — a missed job is a spinner that never resolves.

- [ ] **Step 2: Copy `studio_users` first, preserving `id`**, so the job rows'
  `studio_user_id` values stay valid.

- [ ] **Step 3: Copy the Studio job rows**, mapping the columns that were
  dropped (`owner_kind`, `cms_user_id`, `api_key_id`, the Content columns) to
  nothing.

- [ ] **Step 4: Verify counts match** before touching anything else.

```sql
-- old:  SELECT count(*) FROM creative_fit_jobs WHERE owner_kind='studio';
-- new:  SELECT count(*) FROM studio_fit_jobs;
```

GCS objects do not move: both services use `markai-storage` and Studio's blobs
already sit under a `studio-<user_id>/` prefix, so `source_url` and `result_url`
stay valid. Grant `studio-api-runtime@` read/write on that prefix.

- [ ] **Step 5: Cut production over** (deploy the frontend change from Task 7)
  and watch for a full day of traffic before Task 11.

---

## Task 11: Remove Studio from the CMS (requires user sign-off)

**Files:**
- Delete: `markai-signage-api/app/studio/`
- Modify: `markai-signage-api/app/main.py`, `app/models.py`,
  `app/creative_fit/service.py`, `app/creative_fit/worker.py`,
  `app/creative_fit/models.py`
- Create: `markai-signage-api/alembic/versions/0062_drop_studio.py`

- [ ] **Step 1: Delete `app/studio/` and its three references**

```bash
cd /Users/akshat/projects/MarkAi/markai-signage-api
rm -rf app/studio
```
Then remove from `app/main.py` the `studio_ext_router` import and include, and
the `assert_retention_outlasts_budget_window()` startup assertion; and from
`app/models.py` the `StudioUser` import.

- [ ] **Step 2: Strip `owner_kind` from the engine**

Remove `OWNER_CMS` / `OWNER_STUDIO` and every filter using them from
`creative_fit/service.py` and `creative_fit/models.py`, and simplify the worker's
claim ordering from `ORDER BY (owner_kind = 'studio'), created_at` to
`ORDER BY created_at`.

`media_kind` **stays** — CMS video fit is a shipped feature and has nothing to do
with Studio.

- [ ] **Step 3: Write migration `0062`**

```python
"""Studio has its own service now, so take its columns back out.

0060 and 0061 added studio_users and made creative_fit_jobs polymorphic so two
products could share one queue. Studio now runs on markai-studio-api with its
own database, so the discriminator has nothing left to discriminate.

Runs only AFTER the Studio rows have been copied to the new database and the
counts verified — the DELETE below is not recoverable.

Revision ID: 0062_drop_studio
Revises: 0061_creative_fit_ownership
"""


def upgrade() -> None:
    # Already copied to markai-studio-api and verified by count.
    op.execute("DELETE FROM creative_fit_jobs WHERE owner_kind = 'studio'")
    op.drop_constraint("ck_creative_fit_jobs_one_owner", "creative_fit_jobs")
    op.drop_column("creative_fit_jobs", "owner_kind")
    op.drop_column("creative_fit_jobs", "studio_user_id")
    op.drop_column("creative_fit_jobs", "api_key_id")
    op.alter_column("creative_fit_jobs", "cms_user_id", nullable=False)
    op.drop_index("ix_studio_users_google_sub", table_name="studio_users")
    op.drop_table("studio_users")
```

- [ ] **Step 4: Verify the CMS still works**

```bash
poetry run python -c "import app.main; print('ok')"
poetry run ruff check app
grep -rn "owner_kind\|app\.studio" app/ || echo "clean"
```
Then exercise CMS Creative Fit for an image and a video, and the AI co-pilot's
`queue_chat_fit` path — it calls into `creative_fit` and must be undisturbed.

- [ ] **Step 5: Commit.**

---

## Self-Review

**Spec coverage.** Service scaffold → Task 1. Engine ported verbatim → Task 2.
Streaming rewrite and the 1 GiB budget → Task 3 (helpers) and Task 5 (the video
path that uses them). Caps at three enforcement points → Task 3
(`assert_within_cap`, the real-size check), Task 6 (per-media-kind limit), and
the BFF, which already rejects on size. Image pixel guard → ported with
`resizer.py` in Task 2, asserted in Task 8 Step 5. Two tables → Task 4. Own
worker pool, own semaphores, stale-sweep fix → Task 5. Cancel a running encode →
Task 5 Steps 2–3, verified in Task 8 Step 4. Cancel the sync analyze → Task 6
Step 3. Shared-secret auth → Task 6 Step 1. `STUDIO_UNLIMITED_EMAILS` and its
revocation cost → Task 6 Step 2. Frontend one-variable cutover → Task 7.
Deployment sizing and gen2 → Task 9. Data migration → Task 10. CMS cleanup and
`0062` → Task 11.

**Placeholders.** None. Every code step carries its code; every verification
step carries its command and expected output.

**Type consistency.** `StudioFitJob` throughout (never `CreativeFitJob`).
`is_cancelled(job_id: str) -> bool` is defined in Task 5 Step 2 and consumed by
name in Task 5 Steps 1 and 3. `should_stop: Callable[[], bool]` is the parameter
name in `_watch`, `run()` and `render_stretch()` alike. `media.source_signed_url`,
`media.assert_within_cap`, `media.upload_result` and `media.download_image_bytes`
are defined in Task 3 and used under exactly those names in Tasks 5 and 6.
`require_studio_caller` replaces `require_creative_fit_key` everywhere.
