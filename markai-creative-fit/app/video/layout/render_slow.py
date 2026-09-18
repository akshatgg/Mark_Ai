"""Plan -> ffmpeg argv, for the two tiers `render_fast` cannot cover.

**This module decides NOTHING.** Every geometry decision (which shot gets
which crop window, whether it pans, the stage's size and position, which
regions get rescued, the copy-state timeline, the trim/hold split) was
already made by `reframe.plan()`, `compose.plan()` and `duration.plan()`.
What is left is turning those plans into ONE ffmpeg invocation: `split` the
decoded source into one branch per kept shot, `trim`/`crop`/`scale` each
branch with its OWN constant crop width/height (never a per-frame-varying
w/h -- that is the ffmpeg limitation the design note calls out, and giving
every branch its own fixed configuration sidesteps it entirely), then
`concat` the branches back into one stream. One decode, one encode, no
intermediate files.

**Why a constant crop w/h per branch, and only `x`/`y` ever vary.**
`reframe.py`'s own planner pins window SIZE for the whole target
(`geometry.max_window`, searched once) and only ever varies the window's
POSITION per shot (`ShotWindow.c0`/`v`) -- so every branch's `crop` filter
gets a fixed `w:h` and an `x`/`y` that is either a constant or a simple
`c0 + v*n` expression in the crop filter's own per-frame frame-number
variable `n`. Integer per-frame stepping is invisible here because
`reframe.MIN_PAN_SPEED` (0.6 px/frame) already forced anything slower to
snap to static -- there is no sub-pixel numpy loop anywhere in this file.

**Why `x`/`y` never need clamping.** `reframe._solve`'s feasibility system
includes the window's OWN in-frame boundary as two of its constraint points
(`_boundary_bounds`, evaluated at the shot's first and last frame). A linear
path between two points that both satisfy a FIXED interval constraint never
leaves that interval in between (the interval does not move over time), so
every intermediate frame's window position is already guaranteed in-bounds
by construction -- reproducing that guard here would be redundant, not
defensive.

**Colour, twice, on purpose.** The reframe tier's ordinary (no text overlay)
case does geometry per shot and ONE combined colour conversion after
`concat` -- exactly `render_fast`'s own single `scale=in_color_matrix=...`
recipe, just moved to run once on the concatenated stream instead of once
per shot (a memoryless per-pixel colour transform commutes with `concat`,
which only splices streams and never touches a pixel value, so the two
orderings are numerically identical and the post-concat version is cheaper).
The compose tier, which always has to alpha-composite Pillow-rendered copy
over the video, cannot take that shortcut: `overlay`'s `format=rgb` blend
needs an ALREADY-correct RGB stream to blend in, not an implicit guess
during the blend itself, so compose explicitly decodes to full-range BT.709
RGB first (mirroring `erase/plate.py::_decode_filter`), overlays every copy
state there, and only THEN converts back to broadcast yuv420p/tv (mirroring
`erase/plate.py::_ENCODE_FILTER` / `check.py::ENCODE_FILTER`). Never `overlay`
without `format=rgb` -- its yuv420 default would halve chroma on the copy
before the encoder halves it again.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.core.config import settings
from app.video import encode, ffmpeg
from app.video.layout import compose, duration, geometry, reframe
from app.video.schemas import FitMode, Shot, VideoBlueprint, VideoProbe, VideoVariant

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Per-shot crop geometry -> ffmpeg filter fragments
# ---------------------------------------------------------------------------


def _crop_geometry(
    pan_axis: str, window_w: float, window_h: float, c0: float, v: float, src_w: int, src_h: int
) -> tuple[int, int, str, str]:
    """One shot's `(crop_w, crop_h, x_expr, y_expr)`.

    `window_w`/`window_h` are rounded ONCE here to the constant integer
    ffmpeg's `crop` filter needs; `c0`/`v` stay in float px so the window's
    CENTRE position keeps sub-pixel precision even though the box it is
    drawn against is an integer size (a systematic <1px bias is not worth
    trading away for a rounder-looking number). The axis that never pans is
    a plain numeric constant; the pan axis is `c0 - size/2` when static, or
    that same expression plus `v*n` when panning -- `n` is `crop`'s own
    "input frame number, starting from 0", which counts from the first
    frame THIS branch's `trim` emits, i.e. exactly the shot-relative frame
    offset `reframe._frame_of` planned against.
    """
    crop_w = max(2, round(window_w))
    crop_h = max(2, round(window_h))
    if pan_axis == "x":
        fixed = (src_h - crop_h) / 2
        y_expr = f"{fixed:.3f}"
        x0 = c0 - window_w / 2
        x_expr = f"{x0:.3f}" if v == 0.0 else f"{x0:.3f}+{v:.6f}*n"
        return crop_w, crop_h, x_expr, y_expr
    fixed = (src_w - crop_w) / 2
    x_expr = f"{fixed:.3f}"
    y0 = c0 - window_h / 2
    y_expr = f"{y0:.3f}" if v == 0.0 else f"{y0:.3f}+{v:.6f}*n"
    return crop_w, crop_h, x_expr, y_expr


#: One kept shot's render entry: the `Shot` (for its absolute source frame
#: range), the window's pan axis/size/position, all in native source px.
ShotEntry = tuple[Shot, str, float, float, float, float]


def _shot_filters(
    entries: list[ShotEntry], src_w: int, src_h: int, scale_w: int, scale_h: int,
    in_prefix: str, out_prefix: str,
) -> tuple[str, list[str]]:
    """`trim`/`setpts`/`crop`/`scale` for every kept shot, fed by an already
    `fps`-normalised, already-`split` stream labelled `{in_prefix}0..N-1`.

    `end_frame` is the shot's own last INCLUSIVE frame (`shots.py`'s
    convention); ffmpeg's `trim` filter takes an EXCLUSIVE `end_frame`, so it
    is always `shot.end_frame + 1` here, not the raw field.
    """
    parts: list[str] = []
    labels: list[str] = []
    for i, (shot, pan_axis, window_w, window_h, c0, v) in enumerate(entries):
        crop_w, crop_h, x_expr, y_expr = _crop_geometry(
            pan_axis, window_w, window_h, c0, v, src_w, src_h
        )
        label = f"{out_prefix}{i}"
        parts.append(
            f"[{in_prefix}{i}]trim=start_frame={shot.start_frame}:"
            f"end_frame={shot.end_frame + 1},setpts=PTS-STARTPTS,"
            f"crop={crop_w}:{crop_h}:{x_expr}:{y_expr},"
            f"scale={scale_w}:{scale_h}[{label}]"
        )
        labels.append(label)
    return ";".join(parts), labels


def _fps_filter(probe: VideoProbe) -> str:
    """Forces a true CFR stream at `probe.fps` BEFORE `split`/`trim`/`crop`
    ever see it. `Shot.start_frame`/`end_frame` (`shots.py`) and every pan's
    `v` (px/frame, `reframe._frame_of`) were computed assuming frame index i
    sits at time i/fps -- an output-side `-fps_mode cfr` would only enforce
    that at the encoder/muxer boundary, AFTER `crop`'s `n` has already
    counted frames from whatever cadence the raw decode actually produced.
    Putting `fps` as a real FILTER, first in the graph, is what makes frame
    counting agree with the plan for a variable-frame-rate source.
    """
    return f"fps={probe.fps:g}"


# ---------------------------------------------------------------------------
# Colour legs -- see module docstring for why there are two shapes of this
# ---------------------------------------------------------------------------


def _colour_broadcast_filter(probe: VideoProbe) -> str:
    """Native decode -> yuv420p(tv) bt709, ONE combined `scale` call --
    `render_fast`'s own recipe, mirrored exactly, for the no-overlay case.
    """
    source_range = probe.color_range if probe.color_range in ("tv", "pc") else "tv"
    return (
        f"scale=in_color_matrix={probe.color_space}:in_range={source_range}:"
        "out_color_matrix=bt709:out_range=tv,"
        "format=yuv420p,"
        "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
    )


def _colour_rgb_filter(probe: VideoProbe) -> str:
    """Native decode -> full-range BT.709 RGB -- the explicit boundary
    conversion `erase/plate.py::_decode_filter` and `check.py::DECODE_FILTER`
    use, so `overlay`'s later `format=rgb` blend has an ALREADY-correct RGB
    stream to work with rather than an implicit, unaudited guess made mid-blend.
    """
    source_range = probe.color_range if probe.color_range in ("tv", "pc") else "tv"
    return (
        f"scale=in_color_matrix={probe.color_space}:in_range={source_range}:"
        "out_color_matrix=bt709:out_range=pc,format=rgb24"
    )


def _colour_broadcast_from_rgb_filter() -> str:
    """RGB(pc) -> yuv420p(tv) bt709 -- the same recipe
    `erase/plate.py::_ENCODE_FILTER`/`check.py::ENCODE_FILTER` use, applied to
    a stream already brought into full-range BT.709 RGB by `_colour_rgb_filter`.
    """
    return (
        "scale=in_range=pc:in_color_matrix=bt709:out_range=tv:out_color_matrix=bt709,"
        "format=yuv420p,"
        "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
    )


# ---------------------------------------------------------------------------
# Encode boundary
# ---------------------------------------------------------------------------


def _encode(
    input_args: list[str], graph: str, map_label: str, out: Path, probe: VideoProbe,
    width: int, height: int, fps: float, level: str, duration_seconds: float,
    mode: str, aspect_shift: float,
) -> VideoVariant:
    ffmpeg.run([
        "-y", *input_args,
        "-filter_complex", graph,
        "-map", map_label,
        "-fps_mode", "cfr", "-r", f"{fps:g}",
        *encode.encode_args(width, height, fps, level=level),
        str(out),
    ])

    # Same warning vocabulary as `render_fast` -- an operator reading a
    # variant's warnings should not have to know which tier produced it.
    warnings: list[str] = []
    if probe.color_inferred:
        warnings.append(
            "Source declared no colour tags; assumed "
            f"{probe.color_space}/{probe.color_range}."
        )
    if probe.is_vfr:
        warnings.append(f"Source was variable frame rate; flattened to {fps:g}fps.")
    if fps < probe.fps:
        warnings.append(f"Source was {probe.fps:g}fps; capped to {fps:g}fps.")
    if probe.has_audio:
        warnings.append("Audio stripped (panels are silent).")

    logger.info(
        "%s %dx%d -> %dx%d level %s (%.2fs)",
        mode, probe.width, probe.height, width, height, level, duration_seconds,
    )
    return VideoVariant(
        width=width, height=height, mode=mode, aspect_shift=aspect_shift, path=str(out),
        duration_seconds=duration_seconds, bytes=out.stat().st_size if out.exists() else None,
        level=level, warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Reframe tier
# ---------------------------------------------------------------------------


def render_reframe(
    source: Path,
    out: Path,
    probe: VideoProbe,
    blueprint: VideoBlueprint,
    plan: reframe.ReframePlan,
    duration_plan: duration.DurationPlan,
    width: int,
    height: int,
) -> VideoVariant:
    """A feasible `ReframePlan`: crop/pan the SOURCE directly onto the panel
    shape, shot by shot, no erase and no drawn copy -- the window always
    keeps every required box in frame, so nothing needs removing or
    redrawing.
    """
    if width % 2 or height % 2:
        raise ValueError(f"Target {width}x{height} must have even dimensions.")

    fps = min(probe.fps, settings.VIDEO_MAX_FPS)
    level = encode.h264_level(width, height, fps)
    src_w, src_h = blueprint.width, blueprint.height

    windows_by_shot = {w.shot_index: w for w in plan.windows}
    shots = sorted(blueprint.shots, key=lambda s: s.index)
    entries: list[ShotEntry] = []
    for shot in shots:
        window = windows_by_shot.get(shot.index)
        if window is None:
            # A feasible ReframePlan gives every shot a window by
            # construction (see reframe.plan()); a missing one here means
            # the plan and the blueprint disagree about which shots exist,
            # which is a caller bug, not a degrade to paper over.
            raise ValueError(f"reframe plan has no window for shot {shot.index}")
        entries.append((shot, window.pan_axis, window.window_w, window.window_h,
                         window.c0, window.v))
    n = len(entries)
    if n == 0:
        raise ValueError("reframe plan has no shots to render")

    shot_graph, labels = _shot_filters(entries, src_w, src_h, width, height, "s", "r")
    split_labels = "".join(f"[s{i}]" for i in range(n))
    parts = [
        f"[0:v]{_fps_filter(probe)}[fsrc]",
        f"[fsrc]split={n}{split_labels}",
        shot_graph,
        f"{''.join(f'[{lab}]' for lab in labels)}concat=n={n}:v=1:a=0[vcat]",
    ]

    current = "vcat"
    hold_seconds = duration_plan.hold_seconds
    if hold_seconds > 0:
        if hold_seconds > duration.HOLD_MAX_SECONDS:
            # Per layout/duration.py's own docstring, a hold this long should
            # switch to a designed card -- but the reframe tier has no canvas
            # to draw one on (it is raw cropped/panned footage, nothing
            # else). Holding the true last frame anyway is an honest,
            # reported degrade rather than a refusal; building a full
            # card-overlay branch here is deferred until a clip actually
            # needs it (none of this task's required cases do).
            logger.warning(
                "reframe hold %.2fs exceeds the %.1fs 'reads as stalled' ceiling "
                "(layout.duration.HOLD_MAX_SECONDS); holding the true last frame "
                "anyway -- the reframe tier has no chrome to draw a designed card",
                hold_seconds, duration.HOLD_MAX_SECONDS,
            )
        parts.append(f"[{current}]tpad=stop_mode=clone:stop_duration={hold_seconds:.3f}[vheld]")
        current = "vheld"

    parts.append(f"[{current}]{_colour_broadcast_filter(probe)}[vout]")
    graph = ";".join(parts)

    total_seconds = duration_plan.run_duration_seconds + hold_seconds
    aspect_shift = geometry.aspect_shift(src_w, src_h, width, height)
    return _encode(
        ["-i", str(source)], graph, "[vout]", out, probe, width, height, fps, level,
        total_seconds, FitMode.REFRAME, aspect_shift,
    )


# ---------------------------------------------------------------------------
# Compose tier
# ---------------------------------------------------------------------------


def render_compose(
    source: Path,
    out: Path,
    probe: VideoProbe,
    blueprint: VideoBlueprint,
    plan: compose.ComposePlan,
    duration_plan: duration.DurationPlan,
    width: int,
    height: int,
    plate_path: Path | None,
    state_dir: Path,
) -> VideoVariant:
    """A `ComposePlan`: the (down-scaled, never up-scaled) video cropped/panned
    into `plan.stage.box` on a flat card, with every rescued copy state
    composited over it as extra PNG inputs.

    `plate_path` is the erased mezzanine to decode FROM instead of `source`
    when at least one rescued region needed its burned-in original removed
    first (`plan.decisions[*].needs_erase`) -- everything outside an erased
    region is bit-identical to `source` (see `erase/plate.py`).

    That plate is shared across every compose target in the same `fit_video`
    call (`pipeline._ensure_plate` erases every rescue-CANDIDATE region for
    the whole creative, not just THIS target's own rescue set -- see its
    docstring for why, and for the failure that sharing alone does not
    prevent). Before the crop/pan pipeline below ever runs, this function
    restores THIS target's own un-rescued (`needs_erase=False`) regions'
    ORIGINAL pixels back over the plate (`erase.plate.restore_regions`) --
    otherwise a region some OTHER target in the batch rescued, but this one
    judged still legible and left burned in, would be erased from the
    footage with nothing queued to replace it, and the message would vanish
    from this render entirely. A target with nothing to restore (it rescues
    every region the plate erased -- both portrait targets, on the creative
    that surfaced this) renders straight off `plate_path`, byte-for-byte
    unchanged from before this restore step existed.
    """
    if width % 2 or height % 2:
        raise ValueError(f"Target {width}x{height} must have even dimensions.")

    fps = min(probe.fps, settings.VIDEO_MAX_FPS)
    level = encode.h264_level(width, height, fps)
    src_w, src_h = blueprint.width, blueprint.height
    stage = plan.stage

    # The stage's OWN window size (`_build_stage`'s `geometry.max_window`
    # call) is the authoritative crop size that `stage.box`'s placement math
    # was computed against; `stage.crop.windows[i].window_w/h` comes from a
    # SEPARATE `reframe.plan()` call at a rounded aspect (see compose.py's
    # `_reframe_at_aspect`) and can disagree by a sub-pixel amount. Only its
    # `c0`/`v`/`pan_axis` -- the actual per-shot SOLVE -- are trusted here;
    # the size is always retaken from `stage.window`.
    windows_by_shot = {w.shot_index: w for w in stage.crop.windows}
    shots = sorted(blueprint.shots, key=lambda s: s.index)
    entries: list[ShotEntry] = []
    skipped: list[int] = []
    for shot in shots:
        window = windows_by_shot.get(shot.index)
        if window is None:
            # Reached when the stage search fell back to "use the full source
            # frame anyway" over a logo/product region already grazing its
            # edge (see compose._search_stage's docstring). That degrade is
            # honest and already warned about -- but it does NOT mean there is
            # no window: a full-frame stage HAS a trivially correct one, the
            # whole frame, held static. Dropping the shot here threw away a
            # complete, rescuable compose plan (measured on a real 1280x1280
            # creative: 5/5 regions rescued, 2 copy states, plate already
            # built -- and then nothing rendered at all).
            #
            # Only synthesise it when the stage really is the full frame.
            # Any other missing window is a genuine planner failure and must
            # still be dropped rather than guessed at.
            full_frame = (
                round(stage.window.width) >= src_w and round(stage.window.height) >= src_h
            )
            if not full_frame:
                skipped.append(shot.index)
                continue
            entries.append((shot, "x", stage.window.width, stage.window.height,
                            src_w / 2.0, 0.0))
            continue
        entries.append((shot, window.pan_axis, stage.window.width, stage.window.height,
                         window.c0, window.v))
    if skipped:
        logger.warning(
            "compose: shot(s) %s had no stage window (see compose._search_stage's "
            "degrade path); dropped from the render", skipped,
        )
    n = len(entries)
    if n == 0:
        raise ValueError("compose plan has no shots to render")

    stage_w = max(2, round(stage.box.width))
    stage_h = max(2, round(stage.box.height))
    video_source = plate_path if plate_path is not None else source

    # See this function's own docstring's "shared plate" section, and
    # `pipeline._ensure_plate`'s, for the failure this restores: the shared
    # plate erased every rescue-CANDIDATE region in the creative, but THIS
    # target only rescues (and thus wants erased) the ones in
    # `plan.decisions` with `needs_erase=True`. Anything else the plate
    # touched -- left burned in as legible, dropped for want of room, or
    # cropped fully outside the stage window -- gets its true pixels back
    # before a single frame is cropped/scaled below.
    if plate_path is not None:
        shots_by_index = {shot.index: shot for shot in blueprint.shots}
        to_restore: list[tuple[Shot, tuple[int, int, int, int]]] = []
        for decision in plan.decisions:
            if decision.needs_erase:
                continue
            shot = shots_by_index.get(decision.shot_index)
            if shot is None:
                # Same disagreement `entries`' own loop above guards against:
                # a decision naming a shot this (already-trimmed) blueprint
                # doesn't have is a planner mismatch, not something to invent
                # a restore box for.
                logger.warning(
                    "compose restore: shot %d not in blueprint; cannot restore "
                    "role %r there", decision.shot_index, decision.role,
                )
                continue
            to_restore.append((shot, decision.native_box))

        if to_restore:
            from app.video.erase import plate as erase_plate  # lazy: see pipeline.py's own note

            restore_path = state_dir / f"compose_{width}x{height}_restored.mov"
            erase_plate.restore_regions(source, plate_path, probe, to_restore, restore_path)
            video_source = restore_path

    shot_graph, labels = _shot_filters(entries, src_w, src_h, stage_w, stage_h, "s", "c")
    split_labels = "".join(f"[s{i}]" for i in range(n))
    parts = [
        f"[0:v]{_fps_filter(probe)}[fsrc]",
        f"[fsrc]split={n}{split_labels}",
        shot_graph,
        f"{''.join(f'[{lab}]' for lab in labels)}concat=n={n}:v=1:a=0[vcat]",
    ]

    hold_seconds = duration_plan.hold_seconds
    current = "vcat"
    if hold_seconds > 0:
        # Compose "draws unconditionally" per layout/duration.py's own
        # framing -- concretely: the stage video freezes on its last frame
        # (same tpad mechanism as reframe) and the LAST copy state's overlay
        # window is widened below to cover the hold too, so the ad's final
        # message keeps being shown, legibly, rather than the panel going
        # blank or looping back to an earlier state.
        parts.append(f"[{current}]tpad=stop_mode=clone:stop_duration={hold_seconds:.3f}[vheld]")
        current = "vheld"

    parts.append(f"[{current}]{_colour_rgb_filter(probe)}[vrgb]")
    x0, y0 = round(stage.box.x0), round(stage.box.y0)
    # `color=black` is never actually visible: every panel pixel outside the
    # stage box is covered by an opaque copy-state PNG below, and every pixel
    # inside it is the video itself -- the pad colour only matters for the
    # (never reached) case of zero copy states, so any constant is fine.
    parts.append(f"[vrgb]pad={width}:{height}:{x0}:{y0}:color=black[vpad]")
    current = "vpad"

    total_seconds = duration_plan.run_duration_seconds + hold_seconds
    background_hex = blueprint.background_hex
    state_paths: list[Path] = []
    input_args = ["-i", str(video_source)]
    last_index = len(plan.states) - 1
    # Every plan-level warning (stage-search degrades, rescue/drop reasons)
    # plus every per-state render warning (colour swaps, a role dropped for
    # want of room) rides along to the returned `VideoVariant.warnings` below
    # -- an operator reading `cli.py`'s report should see the SAME "kept vs
    # dropped" story this function drew, not just a `logger.info` line no CLI
    # invocation surfaces. Deduplicated (not just appended) because the same
    # dropped role reason often repeats verbatim across several copy states.
    compose_warnings = dict.fromkeys(plan.warnings)
    for i, state in enumerate(plan.states):
        rendered = compose.render_state(plan, state, background_hex)
        for warning in rendered.warnings:
            logger.info("compose render_state (state %d): %s", i, warning)
            compose_warnings[warning] = None
        png_path = state_dir / f"compose_{width}x{height}_state{i}.png"
        rendered.image.save(png_path)
        state_paths.append(png_path)

        end_seconds = state.end_seconds + (hold_seconds if i == last_index else 0.0)
        input_args += ["-loop", "1", "-t", f"{total_seconds:.3f}", "-r", f"{fps:g}",
                        "-i", str(png_path)]
        input_index = i + 1  # input 0 is the video
        ov_label = f"ov{i}"
        next_label = f"vov{i}"
        parts.append(f"[{input_index}:v]format=rgba[{ov_label}]")
        # `eof_action=pass:repeatlast=0` is NOT optional once there is more
        # than one copy state, and its absence fails in a way that names
        # nothing useful.
        #
        # Each state is a `-loop 1 -t <clip length>` PNG, so every overlay
        # input is its own stream reaching EOF on its own schedule. With the
        # defaults, the SECOND overlay in the chain aborts the entire graph
        # with a bare "Error while filtering: Invalid argument" and no file is
        # written at all. Bisected on a real 1280x1280 creative: one overlay
        # always succeeded, two or more always failed, and adding these two
        # options made three succeed unchanged.
        #
        # `eof_action=pass` keeps passing the main stream once an overlay
        # input ends instead of ending the output; `repeatlast=0` stops a
        # finished overlay's last frame being held over everything after it,
        # which would otherwise leave the final state's copy burned across the
        # whole tail of the video.
        parts.append(
            f"[{current}][{ov_label}]overlay=0:0:format=rgb:"
            f"eof_action=pass:repeatlast=0:"
            f"enable='between(t\\,{state.start_seconds:.3f}\\,{end_seconds:.3f})'[{next_label}]"
        )
        current = next_label

    parts.append(f"[{current}]{_colour_broadcast_from_rgb_filter()}[vout]")
    graph = ";".join(parts)

    aspect_shift = geometry.aspect_shift(src_w, src_h, width, height)
    variant = _encode(
        input_args, graph, "[vout]", out, probe, width, height, fps, level,
        total_seconds, FitMode.COMPOSE, aspect_shift,
    )
    variant.warnings.extend(compose_warnings)
    return variant
