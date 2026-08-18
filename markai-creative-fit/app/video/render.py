"""The fast path — one ffmpeg invocation, no Python in the frame loop.

This is the biggest cost lever in the whole design. Most bookings are a small
shape change (1920x1080 onto a 1920x1080 panel, or a mild crop), and for those
there is nothing to analyse and nothing to rebuild: decoding 600 frames into
numpy to put them back unchanged would be pure waste.

The three-tier rule is copied from the image path (app/layout/rules.py) because
it was measured there, and the measurement holds for video:

    shift <= STRETCH_TOLERANCE  stretch to the exact target. Nothing cropped,
                                nothing lost, distortion under a few percent.
    <= ASPECT_TOLERANCE         scale + centre-crop. Past ~8% a stretch starts
                                to visibly oval a round logo.
    above that                  needs a real rebuild -> not this module.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.core.config import settings
from app.video import encode, ffmpeg
from app.video.layout import compose, duration, reframe, render_slow
from app.video.schemas import FitMode, VideoBlueprint, VideoProbe, VideoVariant

logger = logging.getLogger(__name__)


class NeedsRebuild(RuntimeError):
    """The shape gap is past the fast path. Phase B+ handles these."""


def aspect_shift(src_w: int, src_h: int, dst_w: int, dst_h: int) -> float:
    """How far apart two shapes are. Symmetric, and 1.0 when they match."""
    src = src_w / src_h
    dst = dst_w / dst_h
    return max(src, dst) / min(src, dst)


def fit_mode(src_w: int, src_h: int, dst_w: int, dst_h: int) -> str:
    shift = aspect_shift(src_w, src_h, dst_w, dst_h)
    if shift <= settings.STRETCH_TOLERANCE:
        return FitMode.STRETCH
    if shift <= settings.ASPECT_TOLERANCE:
        return FitMode.CROP
    return FitMode.REFRAME


def render_fast(
    source: Path, out: Path, probe_data: VideoProbe, width: int, height: int
) -> VideoVariant:
    """Render a stretch or crop target in a single ffmpeg pass."""
    if width % 2 or height % 2:
        raise ValueError(f"Target {width}x{height} must have even dimensions.")

    mode = fit_mode(probe_data.width, probe_data.height, width, height)
    if mode not in (FitMode.STRETCH, FitMode.CROP):
        raise NeedsRebuild(
            f"{probe_data.width}x{probe_data.height} -> {width}x{height} is a "
            f"{aspect_shift(probe_data.width, probe_data.height, width, height):.2f}x "
            "shift; the fast path only covers stretch and crop."
        )

    fps = min(probe_data.fps, settings.VIDEO_MAX_FPS)
    level = encode.h264_level(width, height, fps)

    if mode == FitMode.STRETCH:
        geometry = f"scale={width}:{height}"
    else:
        # increase + crop == cover: fill the frame, trim the overflow.
        geometry = (
            f"scale=w={width}:h={height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}"
        )

    # Colour is converted AND tagged in one chain. The conversion is the scale
    # filter's in_/out_ options; the tags are setparams. Doing only the tags
    # produces a 601-encoded file labelled 709 — see check.py.
    source_range = probe_data.color_range if probe_data.color_range in ("tv", "pc") else "tv"
    video_filter = (
        f"{geometry},"
        f"scale=in_color_matrix={probe_data.color_space}:in_range={source_range}:"
        f"out_color_matrix=bt709:out_range=tv,"
        f"format=yuv420p,"
        f"setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
    )

    ffmpeg.run([
        "-y", "-i", str(source),
        "-vf", video_filter,
        "-fps_mode", "cfr", "-r", f"{fps:g}",
        *encode.encode_args(width, height, fps, level=level),
        str(out),
    ])

    warnings: list[str] = []
    if probe_data.color_inferred:
        warnings.append(
            "Source declared no colour tags; assumed "
            f"{probe_data.color_space}/{probe_data.color_range}."
        )
    if probe_data.is_vfr:
        warnings.append(f"Source was variable frame rate; flattened to {fps:g}fps.")
    if fps < probe_data.fps:
        warnings.append(f"Source was {probe_data.fps:g}fps; capped to {fps:g}fps.")
    if probe_data.has_audio:
        warnings.append("Audio stripped (panels are silent).")

    logger.info(
        "%s %dx%d -> %dx%d level %s", mode, probe_data.width, probe_data.height,
        width, height, level,
    )
    return VideoVariant(
        width=width, height=height, mode=mode,
        aspect_shift=aspect_shift(probe_data.width, probe_data.height, width, height),
        path=str(out),
        duration_seconds=probe_data.duration_seconds,
        bytes=out.stat().st_size if out.exists() else None,
        level=level,
        warnings=warnings,
    )


def render(
    source: Path,
    out: Path,
    probe_data: VideoProbe,
    blueprint: VideoBlueprint | None,
    duration_plan: duration.DurationPlan | None,
    width: int,
    height: int,
    plate_path: Path | None = None,
    plate_ready_shots: set[int] | None = None,
    state_dir: Path | None = None,
) -> VideoVariant:
    """The whole-service entry point: dispatch on `fit_mode` plus (for the
    two shapes it can't cover) `reframe.plan()`'s own gate.

        shift <= STRETCH_TOLERANCE   stretch          -- render_fast, unchanged
        <= ASPECT_TOLERANCE          crop              -- render_fast, unchanged
        else, gate passes            reframe           -- layout.render_slow
        else                         compose           -- layout.render_slow

    The two slow tiers need a `VideoBlueprint` (shape alone can't tell a
    reframe from a compose target -- that depends on what text/logo boxes
    actually sit where) and a `DurationPlan` (trimming runs before either, so
    the shot list and copy timeline both plan is against are already final).
    Neither is optional once `fit_mode` says the fast path can't cover the
    shift: a caller with `blueprint is None` here (analysis unavailable, or
    infeasible slot-fitting) gets the SAME `NeedsRebuild` refusal the fast
    path already used, worded around the real reason instead of a raw
    AttributeError on `None`.
    """
    mode = fit_mode(probe_data.width, probe_data.height, width, height)
    if mode in (FitMode.STRETCH, FitMode.CROP):
        return render_fast(source, out, probe_data, width, height)

    if blueprint is None or duration_plan is None:
        raise NeedsRebuild(
            f"{probe_data.width}x{probe_data.height} -> {width}x{height} is a "
            f"{aspect_shift(probe_data.width, probe_data.height, width, height):.2f}x "
            "shift; reframe/compose need an analysed blueprint, which is not "
            "available for this render."
        )

    reframe_plan = reframe.plan(blueprint, width, height)
    if reframe_plan.feasible:
        return render_slow.render_reframe(
            source, out, probe_data, blueprint, reframe_plan, duration_plan, width, height
        )

    compose_plan = compose.plan(blueprint, width, height)
    compose_plan = compose.apply_plate_availability(compose_plan, plate_ready_shots)
    if state_dir is None:
        state_dir = out.parent
    return render_slow.render_compose(
        source, out, probe_data, blueprint, compose_plan, duration_plan, width, height,
        plate_path, state_dir,
    )
