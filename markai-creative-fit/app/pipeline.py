"""Orchestration — deconstruct once, render many.

Everything is keyed by a content hash of the uploaded creative, so re-uploading
the same file (or asking for a resolution we have already produced) costs
nothing. That split is the whole economic argument for this service: the model
work happens once per creative; a new screen shape is a sub-second render.
"""

import hashlib
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from app.blueprint import service as blueprint_service
from app.blueprint.schemas import Blueprint
from app.core.config import settings
from app.layout import service as layout_service
from app.layout.service import FitResult
from app.plate import service as plate_service
from app.plate.service import Parts

logger = logging.getLogger(__name__)

SOURCE = "source.png"
BLUEPRINT = "blueprint.json"
PLATE = "plate.png"
LOGO = "logo.png"
BADGE_GLOB = "badge_*.png"


@dataclass
class Variant:
    width: int
    height: int
    mode: str
    aspect_shift: float
    path: Path
    #: "photo-led" | "layout-led", empty when the shape was close enough to
    #: leave the brand's own composition alone.
    strategy: str = ""
    #: Copy that would not fit at the minimum readable size. Reported rather
    #: than silently overlapped.
    dropped: list[str] = field(default_factory=list)


def creative_dir(creative_id: str) -> Path:
    path = settings.WORK_DIR / creative_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def creative_id_for(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:20]


def _downscale_for_analysis(image: Image.Image) -> Image.Image | None:
    """A copy for the MODELS to look at, or None if the creative is already small.

    This never limits output quality — the plate is composited back onto the
    full-resolution original (see plate.service.build). It exists because LaMa's
    cost scales with pixel count and it degrades above ~2K.
    """
    longest = max(image.size)
    if longest <= settings.MAX_ANALYSIS_EDGE:
        return None
    scale = settings.MAX_ANALYSIS_EDGE / longest
    size = (round(image.width * scale), round(image.height * scale))
    logger.info("models will run on a %dx%d copy of %dx%d", *size, *image.size)
    return image.resize(size, Image.LANCZOS)


# ---------------------------------------------------------------------------
# Stage 1 + 2 — run once per creative
# ---------------------------------------------------------------------------
def deconstruct(data: bytes, force: bool = False) -> tuple[str, Blueprint]:
    """Analyse the creative and build its reusable parts. Cached by content."""
    creative_id = creative_id_for(data)
    folder = creative_dir(creative_id)

    if not force and (folder / BLUEPRINT).exists() and (folder / PLATE).exists():
        logger.info("cache hit for creative %s", creative_id)
        return creative_id, load_blueprint(creative_id)

    full = Image.open(_write_source(folder, data)).convert("RGB")
    analysis = _downscale_for_analysis(full)

    blueprint = blueprint_service.analyse(analysis or full)
    (folder / BLUEPRINT).write_text(blueprint.model_dump_json(indent=2))

    # Plate and logo come back at the creative's native resolution.
    parts = plate_service.build(full, blueprint, analysis=analysis)
    parts.plate.save(folder / PLATE)  # PNG — the plate is an intermediate, keep it lossless
    if parts.logo is not None:
        parts.logo.save(folder / LOGO)
    for old in folder.glob(BADGE_GLOB):
        old.unlink()
    for index, badge in enumerate(parts.badges):
        badge.save(folder / f"badge_{index}.png")
    logger.info("plate %dx%d", parts.plate.width, parts.plate.height)

    logger.info("creative %s deconstructed", creative_id)
    return creative_id, blueprint


def _write_source(folder: Path, data: bytes) -> Path:
    path = folder / SOURCE
    if not path.exists():
        from io import BytesIO

        Image.open(BytesIO(data)).convert("RGB").save(path)
    return path


def load_blueprint(creative_id: str) -> Blueprint:
    return Blueprint.model_validate_json((creative_dir(creative_id) / BLUEPRINT).read_text())


def load_parts(creative_id: str) -> Parts:
    folder = creative_dir(creative_id)
    logo_path = folder / LOGO
    return Parts(
        plate=Image.open(folder / PLATE).convert("RGB"),
        logo=Image.open(logo_path).convert("RGBA") if logo_path.exists() else None,
        badges=[Image.open(p).convert("RGBA") for p in sorted(folder.glob(BADGE_GLOB))],
    )


def load_source(creative_id: str) -> Image.Image:
    return Image.open(creative_dir(creative_id) / SOURCE).convert("RGB")


def is_deconstructed(creative_id: str) -> bool:
    folder = settings.WORK_DIR / creative_id
    return (folder / BLUEPRINT).exists() and (folder / PLATE).exists()


# ---------------------------------------------------------------------------
# Stage 3 — run once per target resolution
# ---------------------------------------------------------------------------
def _variant_name(width: int, height: int) -> str:
    ext = "jpg" if settings.OUTPUT_FORMAT.upper() == "JPEG" else "png"
    return f"var_{width}x{height}.{ext}"


def render_variant(creative_id: str, width: int, height: int, force: bool = False) -> Variant:
    folder = creative_dir(creative_id)
    out = folder / _variant_name(width, height)
    meta_path = folder / f"{out.stem}.json"

    if not force and out.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        return Variant(
            width, height, meta["mode"], meta["aspect_shift"], out,
            meta.get("strategy", ""), meta.get("dropped", []),
        )

    result: FitResult = layout_service.render(
        load_source(creative_id), load_parts(creative_id), load_blueprint(creative_id),
        width, height,
    )
    _save(result.image, out)
    meta_path.write_text(
        json.dumps(
            {
                "mode": result.mode,
                "aspect_shift": round(result.aspect_shift, 4),
                "strategy": result.strategy,
                "dropped": result.dropped,
            }
        )
    )
    if result.dropped:
        logger.warning(
            "%dx%d: dropped to fit — %s", width, height, "; ".join(result.dropped)
        )
    return Variant(
        width, height, result.mode, result.aspect_shift, out,
        result.strategy, result.dropped,
    )


def render_letterbox(creative_id: str, width: int, height: int) -> Variant:
    """The rejection fallback — original on a blurred backdrop of itself."""
    folder = creative_dir(creative_id)
    out = folder / f"letterbox_{width}x{height}.jpg"
    _save(layout_service.letterbox(load_source(creative_id), width, height), out)
    return Variant(width, height, "letterbox", 0.0, out)


def _save(image: Image.Image, path: Path) -> None:
    """Write a variant at panel quality.

    These play on physical screens, so the file is the product. JPEG keeps 4:4:4
    chroma: the default 4:2:0 halves colour resolution and visibly smears the
    edges of coloured type, which is most of what an ad is.
    """
    if settings.OUTPUT_FORMAT.upper() == "JPEG":
        image.convert("RGB").save(
            path,
            "JPEG",
            quality=settings.OUTPUT_QUALITY,
            subsampling=settings.JPEG_SUBSAMPLING,
            optimize=True,
            progressive=True,
        )
    else:
        image.save(path, optimize=True)


# ---------------------------------------------------------------------------
def fit(
    data: bytes, targets: list[tuple[int, int]], force: bool = False
) -> tuple[str, Blueprint, list[Variant]]:
    """Full run: deconstruct (cached) then render each requested resolution."""
    creative_id, blueprint = deconstruct(data, force=force)
    variants = [render_variant(creative_id, w, h, force=force) for w, h in targets]
    return creative_id, blueprint, variants


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
        # A guard against a typo'd target, not a quality ceiling — 8K panels fit.
        raise ValueError(
            f"{value} exceeds the {settings.MAX_OUTPUT_EDGE}px limit on the long edge"
        )
    return parsed


def find_variant(creative_id: str, name: str) -> Path | None:
    """Resolve an artifact name inside a creative's folder, refusing traversal."""
    folder = settings.WORK_DIR / creative_id
    candidate = (folder / name).resolve()
    if not str(candidate).startswith(str(folder.resolve())) or not candidate.is_file():
        return None
    return candidate
