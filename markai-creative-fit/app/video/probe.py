"""ffprobe -> VideoProbe.

Probe, never assume. A creative re-encoded elsewhere carries whatever tags that
tool felt like writing, and roughly half of real-world ad masters declare no
colour tags at all. Guessing wrong is the "video looks a bit flat" bug.
"""

from __future__ import annotations

import json
import logging
from fractions import Fraction
from pathlib import Path

from app.video import ffmpeg
from app.video.schemas import VideoProbe

logger = logging.getLogger(__name__)

UNSPECIFIED = {"", "unknown", "unspecified", None}

#: Below this height a source without tags is far more likely to be SD-era
#: BT.601 than BT.709. Above it, 709 is the safe assumption.
HD_HEIGHT = 720


def _fraction(value: str | None) -> float:
    if not value or value in {"0/0", "N/A"}:
        return 0.0
    try:
        return float(Fraction(value))
    except (ValueError, ZeroDivisionError):
        return 0.0


def _has_audio(path: Path) -> bool:
    """Does the container carry an actual audio stream?

    The main probe below runs `-select_streams v:0`, so it can't see this —
    and `format.nb_streams` is not a substitute. A second stream is not
    necessarily audio: a burned-in `mov_text` subtitle track or a GoPro-style
    `tmcd` timecode track (both common on advertiser masters) count toward
    `nb_streams` exactly like a real audio track would, so a bare count check
    reports `has_audio=True` on a silent file. Ask ffprobe specifically for
    audio streams instead — an empty result here means no audio, not an error.
    """
    raw = ffmpeg.run_probe([
        "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "json", str(path),
    ])
    streams = json.loads(raw).get("streams", [])
    return any(s.get("codec_type") == "audio" for s in streams)


def probe(path: Path) -> VideoProbe:
    raw = ffmpeg.run_probe([
        "-select_streams", "v:0",
        "-show_entries",
        "stream=width,height,codec_name,pix_fmt,r_frame_rate,avg_frame_rate,"
        "color_space,color_transfer,color_primaries,color_range,duration",
        "-show_entries", "stream_side_data=rotation",
        "-show_entries", "format=duration,size,nb_streams",
        "-of", "json", str(path),
    ])
    parsed = json.loads(raw)
    if not parsed.get("streams"):
        raise ffmpeg.FfmpegError(f"No video stream in {path.name}.")
    stream = parsed["streams"][0]
    fmt = parsed.get("format", {})

    r_rate = _fraction(stream.get("r_frame_rate"))
    avg_rate = _fraction(stream.get("avg_frame_rate"))
    fps = avg_rate or r_rate
    if not fps:
        raise ffmpeg.FfmpegError(f"Could not determine a frame rate for {path.name}.")

    # r_frame_rate is the smallest rate that ticks every frame exactly; when it
    # differs meaningfully from the average, the source is variable.
    is_vfr = bool(r_rate and avg_rate and abs(r_rate - avg_rate) / max(r_rate, avg_rate) > 0.01)

    duration = float(stream.get("duration") or fmt.get("duration") or 0.0)
    if duration <= 0:
        raise ffmpeg.FfmpegError(f"Could not determine a duration for {path.name}.")

    height = int(stream["height"])
    pix_fmt = stream.get("pix_fmt") or "yuv420p"

    space = stream.get("color_space")
    transfer = stream.get("color_transfer")
    primaries = stream.get("color_primaries")
    crange = stream.get("color_range")
    inferred = any(v in UNSPECIFIED for v in (space, transfer, primaries, crange))
    if inferred:
        default = "bt709" if height >= HD_HEIGHT else "smpte170m"
        space = space if space not in UNSPECIFIED else default
        transfer = transfer if transfer not in UNSPECIFIED else default
        primaries = primaries if primaries not in UNSPECIFIED else default
        # A `yuvj*` pix_fmt literally means full range; everything else is tv.
        crange = crange if crange not in UNSPECIFIED else (
            "pc" if pix_fmt.startswith("yuvj") else "tv"
        )
        logger.info(
            "%s had one or more colour tags unspecified — assuming %s/%s (height %d)",
            path.name, space, crange, height,
        )

    rotation = 0
    for side in stream.get("side_data_list", []):
        if "rotation" in side:
            rotation = int(round(float(side["rotation"]))) % 360

    # ffmpeg's -autorotate (default on; see ffmpeg.py's module docstring)
    # applies the display-matrix rotation during filtering, so every frame
    # this service actually decodes -- extract_frames' `scale` filter,
    # motion.py's region crops, render.py's fast-path scale/crop, encode.py's
    # level lookup -- is ALREADY in the post-rotation orientation. ffprobe's
    # `stream.width/height` above are the CODED (pre-rotation) dimensions,
    # though: a 640x360 source tagged rotation=90 decodes as 360x640 (measured
    # via `scale=480:-2` -> a 480x854 frame), so Gemini's boxes come back
    # portrait-normalised while an un-swapped probe would keep reporting
    # landscape. Swap once, HERE -- the earliest point width/height enter the
    # system -- so every downstream consumer sees the real decoded shape
    # instead of each one having to remember to swap for itself. (This is also
    # why motion.classify raised on a rotated master: its crop math got fed
    # the coded 640-wide box math against a 360-wide decoded frame.)
    coded_width = int(stream["width"])
    out_width, out_height = (
        (height, coded_width) if rotation in (90, 270) else (coded_width, height)
    )

    return VideoProbe(
        width=out_width,
        height=out_height,
        fps=fps,
        duration_seconds=duration,
        codec=stream.get("codec_name") or "unknown",
        pix_fmt=pix_fmt,
        has_audio=_has_audio(path),
        size_bytes=int(fmt["size"]) if fmt.get("size") else None,
        color_space=space,
        color_transfer=transfer,
        color_primaries=primaries,
        color_range=crange,
        color_inferred=inferred,
        rotation=rotation,
        is_vfr=is_vfr,
    )
