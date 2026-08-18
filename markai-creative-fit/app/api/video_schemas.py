"""Request/response shapes for the video HTTP surface.

Sibling to `app/api/schemas.py` (the image path's shapes, frozen) -- same
pydantic style, but this file is video-only. It reuses the pipeline's own
artifact models (`VideoProbe`, `VideoBlueprint`) directly rather than
re-declaring their fields, the way `app/api/schemas.py` reuses `Blueprint`
from `app.blueprint.schemas`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.video.schemas import VideoBlueprint, VideoProbe


class IngestResponse(BaseModel):
    creative_id: str
    probe: VideoProbe


class FitRequest(BaseModel):
    targets: list[str] = Field(
        min_length=1,
        description="Target resolutions as WIDTHxHEIGHT, e.g. ['1080x2400'].",
    )
    force: bool = False


class AnalyseRequest(BaseModel):
    force: bool = False


class JobAccepted(BaseModel):
    job_id: str
    #: The job's status at the instant it was scheduled -- "queued" or
    #: already "running", depending on how fast the single worker picked it
    #: up. Poll `poll_url` for anything past this snapshot.
    status: str
    poll_url: str


class CancelResponse(BaseModel):
    job_id: str
    status: str


class VariantOut(BaseModel):
    """One rendered target, with a fetchable URL instead of a server-local
    path -- the same substitution the image path's `VariantResponse` makes,
    for the same reason."""

    width: int
    height: int
    mode: str
    aspect_shift: float
    url: str
    duration_seconds: float | None = None
    warnings: list[str] = Field(default_factory=list)


class RefusalOut(BaseModel):
    """A target the fast path could not render, re-authored for an API
    consumer.

    `planned_mode` names which slow-tier render would eventually cover this
    shape gap ("reframe" or "compose") so a frontend can branch on a FIELD.
    `reason` is prose for a human -- it is deliberately NOT
    `render.NeedsRebuild`'s own message, which is an implementation detail
    ("the fast path only covers stretch and crop") that must never leak
    through this API as something to string-match against.
    """

    width: int
    height: int
    planned_mode: str
    reason: str


class FitJobResult(BaseModel):
    creative_id: str
    probe: VideoProbe
    variants: list[VariantOut]
    refusals: list[RefusalOut] = Field(default_factory=list)


class AnalyseJobResult(BaseModel):
    creative_id: str
    blueprint: VideoBlueprint


class JobStatusResponse(BaseModel):
    """Polled repeatedly until `status` is terminal ("done" / "error" /
    "cancelled"). `result` is populated only once `status == "done"` --
    it is a plain dict (a `FitJobResult` or `AnalyseJobResult`, dumped to
    JSON-safe types by the worker) rather than a typed union, since a job's
    `kind` already tells the caller which shape to expect. `error` is
    populated only once `status == "error"`.
    """

    job_id: str
    kind: str
    status: str
    percent: int
    eta_seconds: float | None = None
    created_at: float
    updated_at: float
    error: str | None = None
    result: dict[str, Any] | None = None


class VideoBlueprintResponse(BaseModel):
    creative_id: str
    blueprint: VideoBlueprint
