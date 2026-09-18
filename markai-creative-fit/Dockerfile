# Production image for Mark AI Creative Fit (Cloud Run).
# CPU-only: LaMa inpaints a 2600px creative in ~10s on CPU, and the service
# handles a handful of creatives per campaign, not a stream. No GPU needed.
FROM python:3.12-slim

LABEL service.name="markai-creative-fit"
LABEL service.description="Mark AI Creative Fit — rebuild a finished ad for any screen resolution"

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_CACHE_DIR=/tmp/.cache \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    WORK_DIR=/tmp/work \
    MODEL_DIR=/models

# libgomp1 is required by onnxruntime; curl for healthchecks.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml poetry.lock* ./
RUN pip install --no-cache-dir poetry \
    && poetry install --no-root --only main

COPY . .

# Bake the weights into the image so a cold Cloud Run instance does not spend
# its first request pulling ~380MB. Comment out to fetch lazily instead.
RUN python -c "\
from app.core.config import settings; from app.core.models import ensure_weights; \
ensure_weights(settings.LAMA_URL, 'big-lama.pt'); \
ensure_weights(settings.U2NET_URL, 'u2net.onnx')"

EXPOSE 8080

CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1
