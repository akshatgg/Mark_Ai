
from pydantic import BaseModel, Field

from app.blueprint.schemas import Blueprint


class VariantResponse(BaseModel):
    width: int
    height: int
    #: "stretch"  — shape gap tiny; resized to fit exactly, nothing cropped.
    #: "crop"     — shape gap small; scaled and centre-cropped.
    #: "relayout" — shape gap large; rebuilt from the blueprint.
    mode: str
    aspect_shift: float
    url: str
    #: On a rebuild: "photo-led" (the ad is a photograph, its background was
    #: repaired and reused) or "layout-led" (the ad is a designed card, rebuilt
    #: on a fresh card of the same colour). Empty otherwise.
    strategy: str = ""
    #: Copy that would not fit at the minimum readable size and was left out.
    #: Never silently overlapped — if this is non-empty, review before it ships.
    dropped: list[str] = Field(default_factory=list)


class TextSummary(BaseModel):
    role: str
    text: str | None = None
    font_family: str | None = None
    font_confidence: float | None = None
    color_hex: str | None = None


class FitResponse(BaseModel):
    creative_id: str
    source_width: int
    source_height: int
    elements: list[TextSummary]
    #: Any element whose font match came back weak. The CMS should surface these
    #: on the review screen — they are the most likely reason to reject.
    low_confidence: list[str] = Field(default_factory=list)
    variants: list[VariantResponse]


class BlueprintResponse(BaseModel):
    creative_id: str
    blueprint: Blueprint


class RenderRequest(BaseModel):
    targets: list[str] = Field(
        description="Target resolutions as WIDTHxHEIGHT, e.g. ['1080x2400'].",
        min_length=1,
    )
    force: bool = False
