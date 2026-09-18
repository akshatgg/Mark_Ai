"""Logo cutout — u2net salient-object segmentation over onnxruntime.

This is what `rembg` does internally. Calling the model directly avoids that
package's dependency tail (scikit-image, numba, pymatting) and its numpy ceiling,
which conflicts with the LaMa side of this same service.

The logo is CUT from the original creative and made transparent — never
regenerated. Those are the advertiser's real trademark pixels.
"""

import logging
import threading

import numpy as np
import onnxruntime as ort
from PIL import Image

from app.core.config import settings
from app.core.models import ensure_weights

logger = logging.getLogger(__name__)

_SIZE = (320, 320)
_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)

_session = None
_lock = threading.Lock()


def _load() -> ort.InferenceSession:
    global _session
    if _session is not None:
        return _session
    with _lock:
        if _session is None:
            path = ensure_weights(settings.U2NET_URL, "u2net.onnx")
            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            logger.info("Loading u2net")
            _session = ort.InferenceSession(
                str(path), sess_options=opts, providers=["CPUExecutionProvider"]
            )
    return _session


def _preprocess(img: Image.Image) -> np.ndarray:
    small = img.convert("RGB").resize(_SIZE, Image.LANCZOS)
    arr = np.array(small).astype(np.float32)
    # u2net was trained with a divide-by-max normalisation, not divide-by-255.
    peak = float(arr.max()) or 1.0
    arr = arr / peak
    for c in range(3):
        arr[:, :, c] = (arr[:, :, c] - _MEAN[c]) / _STD[c]
    return np.expand_dims(arr.transpose(2, 0, 1), 0).astype(np.float32)


def alpha_mask(img: Image.Image) -> Image.Image:
    """Return an L-mode mask the size of ``img``: 255 = keep, 0 = drop."""
    session = _load()
    out = session.run(None, {session.get_inputs()[0].name: _preprocess(img)})[0]
    pred = out[:, 0, :, :]
    lo, hi = float(pred.min()), float(pred.max())
    pred = (pred - lo) / (hi - lo) if hi > lo else np.zeros_like(pred)
    mask = Image.fromarray((np.squeeze(pred) * 255).astype(np.uint8), mode="L")
    return mask.resize(img.size, Image.LANCZOS)


def cut_out(img: Image.Image) -> Image.Image:
    """RGBA copy of ``img`` with the background made transparent."""
    rgba = img.convert("RGBA")
    rgba.putalpha(alpha_mask(img))
    return rgba
