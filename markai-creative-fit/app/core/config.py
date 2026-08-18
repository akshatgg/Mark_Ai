import logging
from pathlib import Path

from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    PROJECT_NAME: str = "Mark AI Creative Fit"
    ENVIRONMENT: str | None = "local"

    # --- Gemini -----------------------------------------------------------
    # The vision model reads the creative and returns the blueprint. Same key
    # the signage API already uses; point at Vertex AI to draw on GCP credits
    # (the AI Studio endpoint bills separately).
    GEMINI_API_KEY: str | None = None
    AI_MODEL: str = "gemini-2.5-flash"

    # --- Work / model storage --------------------------------------------
    # Artifacts (plate, cutout, variants) land here. On Cloud Run this is the
    # container's writable /tmp; swap for GCS when variants must outlive a
    # request. Model weights are cached separately so they survive a wipe.
    WORK_DIR: Path = ROOT / ".work"
    MODEL_DIR: Path = ROOT / ".models"
    FONT_DIR: Path = ROOT / "assets" / "fonts"

    LAMA_URL: str = (
        "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/"
        "v0.1.0/big-lama.pt"
    )
    U2NET_URL: str = (
        "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"
    )

    # --- Fit rules --------------------------------------------------------
    # Three tiers, by how far the target shape is from the creative's shape.
    #
    #   shift <= STRETCH_TOLERANCE   stretch to fit exactly. Nothing is cropped
    #                                and nothing is lost; a few percent of shape
    #                                distortion is imperceptible. Preferred over
    #                                cropping, which throws pixels away.
    #   <= ASPECT_TOLERANCE          scale + centre-crop. Past ~8% a stretch
    #                                starts to visibly oval a round logo, so we
    #                                take the small crop instead.
    #   above that                   full deconstruct-and-rebuild.
    #
    # Rebuilding inside these bands measurably produced a WORSE ad than leaving
    # the brand's own composition alone (1600x900 -> 1920x1080).
    STRETCH_TOLERANCE: float = 1.08
    ASPECT_TOLERANCE: float = 1.25

    # Cap on the uploaded creative.
    MAX_UPLOAD_MB: int = 40

    # What the MODELS see, not what the output is made from. LaMa's cost scales
    # with pixel count and it degrades well above ~2K, so it runs on a downscaled
    # copy. The inpainted result is then composited back onto the full-resolution
    # original: only the erased regions come from the upscale, and those are
    # smooth background by definition. Every other pixel — the product shot, the
    # texture — stays at the creative's native resolution.
    MAX_ANALYSIS_EDGE: int = 2600

    # These play on physical panels, so the output is the product. JPEG at 95
    # with 4:4:4 chroma (subsampling=0) — the default 4:2:0 halves colour
    # resolution and visibly smears the edges of coloured type, which is most of
    # what an ad is. Set OUTPUT_FORMAT=PNG for lossless at the cost of file size.
    OUTPUT_FORMAT: str = "JPEG"
    OUTPUT_QUALITY: int = 95
    JPEG_SUBSAMPLING: int = 0

    # Never render above this on the long edge — a guard against a typo'd target
    # producing a gigapixel file, not a quality ceiling. 8K panels fit under it.
    MAX_OUTPUT_EDGE: int = 8192

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

    # Same hardware ceiling as VIDEO_MAX_LEVEL, expressed in fps: the S905X4
    # decodes 4K30, not 4K60. A fixed ceiling keeps every panel inside its
    # level budget regardless of what the source was shot at.
    VIDEO_MAX_FPS: float = 30.0

    # Guard against a typo'd input, not a quality ceiling.
    VIDEO_MAX_UPLOAD_MB: int = 500
    VIDEO_MAX_DURATION_SECONDS: int = 120

    # The stated budget for a video job is 15 minutes end to end. A single
    # ffmpeg invocation that runs longer than that is hung (corrupt stream,
    # malformed input), not slow — the process is killed and FfmpegError is
    # raised instead of blocking a FastAPI threadpool worker forever.
    FFMPEG_TIMEOUT_SECONDS: int = 900

    # Analysis runs on a proxy, never on full frames. 480px wide and ~5fps are
    # MediaPipe AutoFlip's shipped values: a cut, a face and a text box are all
    # just as findable at 480px, and the analysis then costs a fraction of what
    # it would at 1080p or 4K. Crop geometry is computed at native resolution
    # afterwards, so this never limits output quality.
    VIDEO_ANALYSIS_WIDTH: int = 480

    # Per-call deadline for a single Gemini frame read. Measured calls take
    # 6-9s, so 30s is generous headroom over the normal case — the point of
    # this setting is not to speed up the happy path, it's that a call which
    # has stalled inside the SDK's own retry/backoff under rate limiting must
    # fail and be recorded as a warning (see app/video/blueprint.py's
    # per-frame `except Exception`) rather than silently consuming the whole
    # job's 15-minute budget. Reproduced during development: two calls
    # stalled for 4-12+ minutes and had to be killed by hand.
    VIDEO_ANALYSIS_CALL_TIMEOUT_SECONDS: int = 30

    # How many of a shot's `tracking.SAMPLES_PER_SHOT` frame-reads run at
    # once. Total request volume is unchanged (still one call per sampled
    # frame), so RPM-based quota is unaffected — this only overlaps the
    # waiting instead of serialising it, and only pays off once each call has
    # its own deadline (VIDEO_ANALYSIS_CALL_TIMEOUT_SECONDS above); bounded
    # concurrency without that would just mean several simultaneous hangs
    # instead of one.
    VIDEO_ANALYSIS_CONCURRENCY: int = 4

    @property
    def ai_configured(self) -> bool:
        return bool(self.GEMINI_API_KEY)

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
settings.WORK_DIR.mkdir(parents=True, exist_ok=True)
settings.MODEL_DIR.mkdir(parents=True, exist_ok=True)
