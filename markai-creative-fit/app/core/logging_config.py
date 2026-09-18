import logging
import sys


def configure_logging(level: int = logging.INFO) -> None:
    """Single stdout handler, Cloud Run friendly."""
    root = logging.getLogger()
    if root.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level)
    # Torch and onnxruntime are chatty at import.
    for noisy in ("torch", "onnxruntime", "PIL"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
