"""H.264 level arithmetic and the encode argument list.

The level is not cosmetic. Declare one the decoder cannot meet and an Amlogic
box either refuses the stream or silently drops to a software decoder that
cannot keep up — either way the panel shows a stutter or a black screen, and
neither failure reaches us.

The arithmetic, so it can be checked by hand:

    macroblocks/frame = ceil(w/16) * ceil(h/16)
    macroblocks/sec   = macroblocks/frame * fps

    1920x1080  = 120 x 68  =  8,160 mb  @30 =   244,800 mb/s -> level 4.0
    2560x960   = 160 x 60  =  9,600 mb  @30 =   288,000 mb/s -> level 5.0  (NOT 4.2)
    3840x2160  = 240 x 135 = 32,400 mb  @30 =   972,000 mb/s -> level 5.1  (at the ceiling)
    3840x2160  = 240 x 135 = 32,400 mb  @60 = 1,944,000 mb/s -> level 5.2  REFUSED

2560x960 is the trap: it exceeds level 4.2's 8,704 macroblock limit, so the
level you would reach for by habit is wrong.
"""

from __future__ import annotations

import math

from app.core.config import settings


class LevelTooHigh(ValueError):
    """The target needs a level the player cannot decode."""


#: (level, MaxFS macroblocks/frame, MaxMBPS macroblocks/sec). Ordered, so the
#: first row that fits is the lowest level that will play.
H264_LEVELS: tuple[tuple[str, int, int], ...] = (
    ("3.0", 1620, 40500),
    ("3.1", 3600, 108000),
    ("3.2", 5120, 216000),
    ("4.0", 8192, 245760),
    ("4.1", 8192, 245760),
    ("4.2", 8704, 522240),
    ("5.0", 22080, 589824),
    ("5.1", 36864, 983040),
    ("5.2", 36864, 2073600),
)


def _level_rank(level: str) -> int:
    for index, (name, _, _) in enumerate(H264_LEVELS):
        if name == level:
            return index
    raise ValueError(f"Unknown H.264 level {level!r}")


def h264_level(width: int, height: int, fps: float) -> str:
    """Lowest level that can carry this resolution and frame rate."""
    macroblocks = math.ceil(width / 16) * math.ceil(height / 16)
    per_second = macroblocks * fps
    ceiling = _level_rank(settings.VIDEO_MAX_LEVEL)

    for index, (name, max_fs, max_mbps) in enumerate(H264_LEVELS):
        if macroblocks <= max_fs and per_second <= max_mbps:
            if index > ceiling:
                raise LevelTooHigh(
                    f"{width}x{height}@{fps:g} needs H.264 level {name}, but the "
                    f"player tops out at {settings.VIDEO_MAX_LEVEL}. "
                    "Reduce the frame rate to 30, or deliver HEVC."
                )
            return name
    raise LevelTooHigh(f"{width}x{height}@{fps:g} exceeds every defined H.264 level.")


def encode_args(width: int, height: int, fps: float, level: str | None = None) -> list[str]:
    """The x264 argument list for a delivered file.

    Conservative reference structure on purpose: weak SoC decoders have a small
    DPB and b-pyramid is the first thing that trips them. The GOP is fixed and
    scenecut is off so every loop restart lands on a keyframe rather than
    wherever x264 decided a scene changed.
    """
    if width % 2 or height % 2:
        raise ValueError(
            f"{width}x{height} has an odd dimension; yuv420p has no integer "
            "chroma plane for it. Round to even before encoding."
        )
    resolved = level or h264_level(width, height, fps)
    keyint = max(1, round(fps * settings.VIDEO_GOP_SECONDS))
    return [
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-level:v",
        resolved,
        "-preset",
        settings.VIDEO_PRESET,
        "-crf",
        str(settings.VIDEO_CRF),
        "-x264-params",
        f"keyint={keyint}:min-keyint={keyint}:scenecut=0:bframes=2:ref=3:b-pyramid=none",
        "-movflags",
        "+faststart",
        "-an",
    ]
