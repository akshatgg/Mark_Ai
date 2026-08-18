"""Creative-fit endpoints.

Handlers are deliberately plain `def`, not `async def`: LaMa and u2net are
CPU-bound and synchronous, so FastAPI runs these in its threadpool and one slow
creative cannot stall the event loop.
"""

import logging

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app import pipeline
from app.api.schemas import (
    BlueprintResponse,
    FitResponse,
    RenderRequest,
    TextSummary,
    VariantResponse,
)
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/fit", tags=["creative-fit"])

#: Below this, the font match is a guess. Surfaced so the reviewer looks harder.
FONT_CONFIDENCE_FLOOR = 0.6

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _read_upload(file: UploadFile) -> bytes:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            415,
            f"Unsupported type {file.content_type!r}. This service handles still "
            f"images only ({', '.join(sorted(ALLOWED_TYPES))}).",
        )
    data = file.file.read()
    if not data:
        raise HTTPException(400, "Empty upload.")
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Creative exceeds {settings.MAX_UPLOAD_MB} MB.")
    return data


def _targets(values: list[str]) -> list[tuple[int, int]]:
    if not values:
        raise HTTPException(400, "At least one target resolution is required.")
    try:
        return [pipeline.parse_target(v) for v in values]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _variant_url(creative_id: str, name: str) -> str:
    return f"/api/fit/{creative_id}/file/{name}"


def _build_response(creative_id: str, blueprint, variants) -> FitResponse:
    source = pipeline.load_source(creative_id)
    elements = [
        TextSummary(
            role=e.role.value,
            text=e.text,
            font_family=e.font_family,
            font_confidence=e.font_confidence,
            color_hex=e.color_hex,
        )
        for e in blueprint.elements
    ]
    low = [
        e.text or e.role.value
        for e in blueprint.elements
        if e.font_confidence is not None and e.font_confidence < FONT_CONFIDENCE_FLOOR
    ]
    return FitResponse(
        creative_id=creative_id,
        source_width=source.width,
        source_height=source.height,
        elements=elements,
        low_confidence=low,
        variants=[
            VariantResponse(
                width=v.width,
                height=v.height,
                mode=v.mode,
                aspect_shift=round(v.aspect_shift, 3),
                url=_variant_url(creative_id, v.path.name),
                strategy=v.strategy,
                dropped=v.dropped,
            )
            for v in variants
        ],
    )


@router.post("", response_model=FitResponse)
def fit_creative(
    file: UploadFile = File(..., description="The finished creative (still image)."),
    targets: list[str] = Form(..., description="Repeatable, e.g. targets=1080x2400"),
    force: bool = Form(False, description="Ignore cached analysis and redo it."),
) -> FitResponse:
    """Deconstruct a creative and rebuild it for each target resolution."""
    if not settings.ai_configured:
        raise HTTPException(503, "Creative fit is not configured (GEMINI_API_KEY missing).")

    data = _read_upload(file)
    parsed = _targets(targets)
    creative_id, blueprint, variants = pipeline.fit(data, parsed, force=force)
    return _build_response(creative_id, blueprint, variants)


@router.post("/{creative_id}/render", response_model=FitResponse)
def render_more(creative_id: str, payload: RenderRequest = Body(...)) -> FitResponse:
    """Render further resolutions from an already-analysed creative.

    This is the cheap path — no model calls, just a render per target.
    """
    if not pipeline.is_deconstructed(creative_id):
        raise HTTPException(404, f"Creative {creative_id} has not been analysed.")
    parsed = _targets(payload.targets)
    variants = [
        pipeline.render_variant(creative_id, w, h, force=payload.force) for w, h in parsed
    ]
    return _build_response(creative_id, pipeline.load_blueprint(creative_id), variants)


@router.post("/{creative_id}/letterbox", response_model=VariantResponse)
def letterbox(
    creative_id: str,
    target: str = Query(..., description="WIDTHxHEIGHT, e.g. 1080x2400"),
) -> VariantResponse:
    """Rejection fallback: the untouched creative on a blurred backdrop."""
    if not pipeline.is_deconstructed(creative_id):
        raise HTTPException(404, f"Creative {creative_id} has not been analysed.")
    width, height = _targets([target])[0]
    variant = pipeline.render_letterbox(creative_id, width, height)
    return VariantResponse(
        width=variant.width,
        height=variant.height,
        mode=variant.mode,
        aspect_shift=0.0,
        url=_variant_url(creative_id, variant.path.name),
    )


@router.get("/{creative_id}/blueprint", response_model=BlueprintResponse)
def get_blueprint(creative_id: str) -> BlueprintResponse:
    if not pipeline.is_deconstructed(creative_id):
        raise HTTPException(404, f"Creative {creative_id} has not been analysed.")
    return BlueprintResponse(
        creative_id=creative_id, blueprint=pipeline.load_blueprint(creative_id)
    )


@router.get("/{creative_id}/file/{name}")
def get_file(creative_id: str, name: str) -> FileResponse:
    path = pipeline.find_variant(creative_id, name)
    if path is None:
        raise HTTPException(404, "No such artifact.")
    return FileResponse(path)
