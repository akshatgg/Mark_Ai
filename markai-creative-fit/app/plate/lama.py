"""LaMa inpainting — vendored runner for the big-lama TorchScript checkpoint.

Why not `simple-lama-inpainting`: that package is a thin wrapper around exactly
this checkpoint, but it declares `numpy<2` and `pillow<10`. Those pins are stale
(the model runs fine past both) yet Poetry enforces them, dragging the whole
service backwards and colliding with onnxruntime. Forty lines here buys current
pins across the board.
"""

import logging
import threading

import numpy as np
import torch
from PIL import Image

from app.core.config import settings
from app.core.models import ensure_weights

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
