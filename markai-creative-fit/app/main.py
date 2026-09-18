import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router as fit_router
from app.api.video_router import router as video_router
from app.core.config import settings
from app.core.logging_config import configure_logging

load_dotenv()
configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s (%s)", settings.PROJECT_NAME, settings.ENVIRONMENT)
    if not settings.ai_configured:
        logger.warning("GEMINI_API_KEY is not set — /api/fit will return 503.")
    missing = [
        name for name in ("PlayfairDisplay.ttf", "Montserrat.ttf")
        if not (settings.FONT_DIR / name).exists()
    ]
    if missing:
        logger.warning("Fonts missing from %s: %s", settings.FONT_DIR, ", ".join(missing))
    yield
    logger.info("Shutting down %s", settings.PROJECT_NAME)


app = FastAPI(
    title=settings.PROJECT_NAME,
    description=(
        "Deconstructs a finished ad creative — reads its text, matches the fonts, "
        "erases the type, cuts out the logo — then rebuilds it for any screen "
        "resolution. Still images only."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(fit_router)
app.include_router(video_router)


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {
        "status": "ok",
        "service": "markai-creative-fit",
        "ai_configured": settings.ai_configured,
    }
