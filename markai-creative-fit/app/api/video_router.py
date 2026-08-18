"""Video creative-fit endpoints.

Sibling to `app/api/router.py` (the image path, frozen -- not one byte of it
changes here). Same conventions: handlers are plain `def`, not `async def`,
because the work underneath (ffmpeg subprocess calls, hashing, Gemini calls)
is CPU/IO-bound and synchronous, so FastAPI runs these in its own default
threadpool -- exactly like the image router already does.

That default threadpool is fine for the SYNC routes here (ingest, blueprint,
job status, file fetch): they either do a quick probe or just touch the
filesystem. The two routes that can run for minutes -- fit and analyse -- do
NOT run inline at all; they hand off to `app.api.jobs.registry`, which owns
its own single dedicated worker thread. That is the isolation that protects
the image path: a ten-minute video job can never starve the pool the image
router's requests depend on.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.api import jobs
from app.api.video_schemas import (
    AnalyseJobResult,
    AnalyseRequest,
    CancelResponse,
    FitJobResult,
    FitRequest,
    IngestResponse,
    JobAccepted,
    JobStatusResponse,
    RefusalOut,
    VariantOut,
    VideoBlueprintResponse,
)
from app.core.config import settings
from app.video import pipeline as video_pipeline
from app.video.render import aspect_shift
from app.video.schemas import VideoBlueprint, VideoProbe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video", tags=["video-creative-fit"])

ALLOWED_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}

#: The plan's Task 6 gate, re-derived here rather than imported: the fast path
#: (this router's only working render tier today) never reaches this number,
#: since it always raises `NeedsRebuild` first. It exists purely so a refusal
#: can tell a caller which slow-tier render WOULD eventually handle its shape,
#: without pretending that tier is built. See `_planned_mode` below.
REFRAME_MAX_UPSCALE = 1.5


# ---------------------------------------------------------------------------
# small local helpers -- deliberately not imported from app/pipeline.py or
# app/api/router.py (the image path). Duplicated, not shared, on purpose.
# ---------------------------------------------------------------------------
def _folder(creative_id: str) -> Path:
    return settings.WORK_DIR / creative_id


def _source_path(creative_id: str) -> Path:
    return _folder(creative_id) / video_pipeline.SOURCE


def _blueprint_path(creative_id: str) -> Path:
    return _folder(creative_id) / video_pipeline.BLUEPRINT


def _find_artifact(creative_id: str, name: str) -> Path | None:
    """Resolve an artifact name inside a creative's folder, refusing traversal."""
    folder = _folder(creative_id)
    candidate = (folder / name).resolve()
    if not str(candidate).startswith(str(folder.resolve())) or not candidate.is_file():
        return None
    return candidate


def _read_upload(file: UploadFile) -> bytes:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            415,
            f"Unsupported file {file.filename!r}. This route handles video only "
            f"({', '.join(sorted(ALLOWED_SUFFIXES))}).",
        )
    data = file.file.read()
    if not data:
        raise HTTPException(400, "Empty upload.")
    if len(data) > settings.VIDEO_MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Video exceeds {settings.VIDEO_MAX_UPLOAD_MB} MB.")
    return data


def _parse_targets(values: list[str]) -> list[tuple[int, int]]:
    if not values:
        raise HTTPException(400, "At least one target resolution is required.")
    try:
        return [video_pipeline.parse_target(v) for v in values]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _file_url(creative_id: str, name: str) -> str:
    return f"/api/video/{creative_id}/file/{name}"


def _effective_upscale(src_w: int, src_h: int, dst_w: int, dst_h: int) -> float:
    """How much a moving reframe WINDOW would have to be upscaled to fill the
    target, per Task 6: the window is capped at the source's full height or
    full width (whichever the target's aspect constrains), so the scale-up is
    fixed by geometry alone -- no gate, no per-shot data needed to compute it.
    """
    src_aspect = src_w / src_h
    dst_aspect = dst_w / dst_h
    if dst_aspect >= src_aspect:
        return dst_w / src_w
    return dst_h / src_h


def _planned_mode(src_w: int, src_h: int, dst_w: int, dst_h: int) -> str:
    """Which slow-tier render this shape gap WOULD route to, once one exists.

    Not a claim that either tier is built -- `render.render_fast` is all that
    runs today, and it already raised `NeedsRebuild` before this is ever
    called. This exists so a refusal can still hand the frontend a plannable
    field: past `REFRAME_MAX_UPSCALE`, a moving crop window can never reach
    the target size (Task 6's finding -- e.g. a 1920x1080 master can never
    reframe onto 1080x2400, only compose), so compose is the only route.
    """
    upscale = _effective_upscale(src_w, src_h, dst_w, dst_h)
    return "compose" if upscale > REFRAME_MAX_UPSCALE else "reframe"


def _refusal(probe_data: VideoProbe, width: int, height: int) -> RefusalOut:
    mode = _planned_mode(probe_data.width, probe_data.height, width, height)
    shift = aspect_shift(probe_data.width, probe_data.height, width, height)
    return RefusalOut(
        width=width,
        height=height,
        planned_mode=mode,
        reason=(
            f"{width}x{height} is a {shift:.2f}x shape change from the "
            f"{probe_data.width}x{probe_data.height} source -- too large for a "
            f"straight resize or crop. This shape needs a {mode} rebuild, which "
            "isn't rendered yet."
        ),
    )


def _variant_out(creative_id: str, variant) -> VariantOut:
    return VariantOut(
        width=variant.width,
        height=variant.height,
        mode=variant.mode,
        aspect_shift=round(variant.aspect_shift, 3),
        url=_file_url(creative_id, Path(variant.path).name),
        duration_seconds=variant.duration_seconds,
        warnings=variant.warnings,
    )


# ---------------------------------------------------------------------------
# job work functions -- run on jobs.registry's single worker thread, never on
# FastAPI's own pool.
# ---------------------------------------------------------------------------
def _fit_work(creative_id: str, data: bytes, targets: list[tuple[int, int]], force: bool):
    """Build the job's work function.

    Per Task 9's design: read `source.mp4` back once (the caller already did
    that -- `data` is those bytes) and call `pipeline.fit_video` for each
    target IN TURN rather than once for the whole batch. That is what buys
    per-target progress and a cancellation point "between targets" without
    touching `fit_video` itself -- each call re-derives the same
    `creative_id` from the same bytes, so the probe cache and every earlier
    variant's cache both hit; nothing here re-implements that caching.
    """

    def work(job: jobs.Job, progress: jobs.Progress) -> dict:
        total = len(targets)
        variants: list[VariantOut] = []
        refusals: list[RefusalOut] = []
        probe_data: VideoProbe | None = None
        started = time.monotonic()

        for done, target in enumerate(targets, start=1):
            if progress.cancelled():
                raise jobs.Cancelled(f"cancelled after {done - 1}/{total} target(s)")

            _cid, probe_data, rendered, failed = video_pipeline.fit_video(
                data, [target], force=force
            )
            variants.extend(_variant_out(creative_id, v) for v in rendered)
            refusals.extend(_refusal(probe_data, w, h) for (w, h), _reason in failed)

            elapsed = time.monotonic() - started
            remaining = total - done
            eta = (elapsed / done) * remaining if done else None
            progress.update(100.0 * done / total, eta)

        assert probe_data is not None  # targets is non-empty (FitRequest enforces it)
        return FitJobResult(
            creative_id=creative_id, probe=probe_data, variants=variants, refusals=refusals,
        ).model_dump(mode="json")

    return work


def _analyse_work(creative_id: str, data: bytes, force: bool):
    """Build the job's work function.

    Unlike fit, `pipeline.analyse` is one call with no progress hook and no
    way to interrupt it mid-flight -- so cancellation here only ever takes
    effect BEFORE that call starts, not during it. That is a real limitation,
    not an oversight: the shot-by-shot Gemini reads inside `blueprint.analyse`
    are not this task's to instrument.
    """

    def work(job: jobs.Job, progress: jobs.Progress) -> dict:
        progress.update(5.0, None)
        cid, source, probe_data = video_pipeline.ingest(data, force=False)
        if progress.cancelled():
            raise jobs.Cancelled("cancelled before analysis started")
        progress.update(15.0, None)
        blueprint = video_pipeline.analyse(cid, source, probe_data, force=force)
        progress.update(100.0, 0.0)
        return AnalyseJobResult(creative_id=creative_id, blueprint=blueprint).model_dump(
            mode="json"
        )

    return work


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------
@router.post("/ingest", response_model=IngestResponse)
def ingest_video(
    file: UploadFile = File(..., description="The source video."),
    force: bool = Form(False, description="Ignore the cached probe and redo it."),
) -> IngestResponse:
    """Park the upload and probe it. No model call, no rendering."""
    data = _read_upload(file)
    try:
        creative_id, _source, probe_data = video_pipeline.ingest(data, force=force)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return IngestResponse(creative_id=creative_id, probe=probe_data)


@router.post("/{creative_id}/fit", status_code=202, response_model=JobAccepted)
def fit_video_route(creative_id: str, payload: FitRequest = Body(...)) -> JobAccepted:
    """Schedule a fit job against an already-ingested creative.

    No re-upload: the source is read back off disk (see `_fit_work`).
    """
    source = _source_path(creative_id)
    if not source.is_file():
        raise HTTPException(404, f"Creative {creative_id} has not been ingested.")
    targets = _parse_targets(payload.targets)
    data = source.read_bytes()
    job = jobs.registry.submit(
        "fit", creative_id, _fit_work(creative_id, data, targets, payload.force)
    )
    return JobAccepted(job_id=job.id, status=job.status, poll_url=f"/api/video/jobs/{job.id}")


@router.post("/{creative_id}/analyse", status_code=202, response_model=JobAccepted)
def analyse_video_route(
    creative_id: str, payload: AnalyseRequest = Body(default=AnalyseRequest())
) -> JobAccepted:
    """Schedule an analysis job. 503 when no model is configured -- mirrors
    exactly how `app/api/router.py::fit_creative` gates the image path."""
    if not settings.ai_configured:
        raise HTTPException(503, "Video analysis is not configured (GEMINI_API_KEY missing).")
    source = _source_path(creative_id)
    if not source.is_file():
        raise HTTPException(404, f"Creative {creative_id} has not been ingested.")
    data = source.read_bytes()
    job = jobs.registry.submit(
        "analyse", creative_id, _analyse_work(creative_id, data, payload.force)
    )
    return JobAccepted(job_id=job.id, status=job.status, poll_url=f"/api/video/jobs/{job.id}")


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    job = jobs.registry.get(job_id)
    if job is None:
        raise HTTPException(
            404, "No such job (finished jobs are kept for 1 hour, then forgotten)."
        )
    with job.lock:
        return JobStatusResponse(
            job_id=job.id,
            kind=job.kind,
            status=job.status,
            percent=round(job.percent),
            eta_seconds=job.eta_seconds,
            created_at=job.created_at,
            updated_at=job.updated_at,
            error=job.error,
            result=job.result,
        )


@router.post("/jobs/{job_id}/cancel", status_code=202, response_model=CancelResponse)
def cancel_job(job_id: str) -> CancelResponse:
    job = jobs.registry.cancel(job_id)
    if job is None:
        raise HTTPException(404, "No such job.")
    return CancelResponse(job_id=job.id, status=job.status)


@router.get("/{creative_id}/blueprint", response_model=VideoBlueprintResponse)
def get_blueprint(creative_id: str) -> VideoBlueprintResponse:
    path = _blueprint_path(creative_id)
    if not path.is_file():
        raise HTTPException(404, f"Creative {creative_id} has not been analysed.")
    blueprint = VideoBlueprint.model_validate_json(path.read_text())
    return VideoBlueprintResponse(creative_id=creative_id, blueprint=blueprint)


@router.get("/{creative_id}/file/{name}")
def get_file(creative_id: str, name: str) -> FileResponse:
    path = _find_artifact(creative_id, name)
    if path is None:
        raise HTTPException(404, "No such artifact.")
    return FileResponse(path)
