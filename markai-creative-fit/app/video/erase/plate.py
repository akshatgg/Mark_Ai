"""Erase EXECUTION — spends what `erase/router.py` planned and produces
`plate.mov`.

**Native composite, always.** The clip is decoded at native resolution
(`ffmpeg.stream_frames`, colour pinned exactly like `render.py`'s fast path);
only the small crop handed to LaMa may ever be downscaled, and only for that
one model call. Every composite happens in numpy — never ffmpeg `overlay`,
whose `format=yuv420` default would halve chroma on the way in, before the
encoder halves it again on the way out (`render.py`'s and `check.py`'s
docstrings measured exactly this failure on the image/H.264 side; the same
physics applies here). Everything outside a region's mask box is therefore
bit-identical to the source, frame for frame — this module never touches a
pixel it wasn't asked to erase.

**One decode pass, one encode pass, buffered per shot rather than per clip.**
`ffmpeg.run()`'s whole-clip buffering (600 native 1080p frames = 3.7GB) is
exactly the problem `stream_frames`/`frame_sink` exist to avoid (see
`ffmpeg.py`), so this module never holds more than the frames of the shot
currently being finished. `clean_plate` and `scrim` need only the first frame
of a shot — LaMa/colour-sampling run the instant it arrives, and every later
frame of that shot streams straight through with zero buffering. `median` is
the one branch that is mathematically incapable of that: reconstructing a
swept background needs the WHOLE shot's frames at once, so those (and only
those) shots are buffered, composited and flushed together. A single shot
spanning the entire clip would still buffer the entire clip — a real, stated
residual limit of this design, not a hidden one; splitting that case into two
decode passes (harvest small per-frame crops, then a second cheap decode to
compose) would remove it, but a single ~15-20s ad being one continuous
uncut, camera-moved shot is the corpus's rare case, not its normal one, so
that complexity is deferred rather than pre-built for a shot pattern this
corpus doesn't actually contain.

**Mask geometry is frozen for the shot.** Computed once per region from the
blueprint's already-per-shot-unioned `erase_box` (see `schemas.TextRegion`),
never recomputed frame to frame — a mask that changes shape is the cheapest
way to make an otherwise-perfect erase flicker.
"""

from __future__ import annotations

import json
import logging
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from app.core.config import settings
from app.plate import lama  # the one permitted image-path import — see module docs
from app.video import ffmpeg
from app.video.erase import register, scrim
from app.video.erase.router import MARGIN_PX  # same crop router.py already costed
from app.video.schemas import (
    EraseBranch,
    EraseDecision,
    ErasePlan,
    Shot,
    TextRegion,
    VideoProbe,
)

logger = logging.getLogger(__name__)

#: IOPaint's own strategy above this size is not to downscale the whole
#: frame but to crop with a margin and run at 1:1 — and above THIS size on
#: the crop itself, downscale the crop alone (Global Constraints, rule 7).
LAMA_MAX_EDGE = 768

#: Base 5px (IOPaint's shipped 11x11 elliptical kernel) generalised to scale
#: with the region instead of a flat constant — see `_dilate`.
_MIN_DILATION_PX = 4.0
_CHROMA_BLEED_PX = 2.0
_DILATION_CAP_FRACTION = 0.25
_DILATION_SCALE = 0.06


@dataclass(frozen=True)
class RegionGeometry:
    """One region's frozen-for-the-shot geometry, native pixels.

    ``mask`` is what gets painted (feathered via ``alpha``); ``context`` is
    the wider crop handed to LaMa/registration for surrounding pixels to
    reason with; ``control`` is a same-size box mirrored away from ``mask``,
    recorded for a later flicker check to compare against (not computed
    here — this module has no ffmpeg pass dedicated to measuring MAFD).
    """

    mask: tuple[int, int, int, int]  # y0, x0, y1, x1
    context: tuple[int, int, int, int]
    control: tuple[int, int, int, int]
    alpha: np.ndarray  # (mask_h, mask_w) feathered blend weight, precomputed once


@dataclass(frozen=True)
class RegionReport:
    """One region's outcome, the JSON-serialisable half of ``RegionGeometry``
    plus the router's own decision — what `erase.json` is built from."""

    shot_index: int
    role: str
    branch: str
    cost_mp: float
    reason: str
    mask_box: tuple[int, int, int, int]
    control_box: tuple[int, int, int, int]


@dataclass(frozen=True)
class PlateResult:
    plate_path: Path
    width: int
    height: int
    fps: float
    frame_count: int
    regions: list[RegionReport]


# --- Geometry ----------------------------------------------------------------


def _quantise_box(box: list[int], width: int, height: int) -> tuple[int, int, int, int]:
    """Normalised [ymin,xmin,ymax,xmax] (0-1000) -> native pixel (y0,x0,y1,x1).

    The same scaling `motion._pixels`/`router._crop_area_mp` apply, kept as
    its own function here rather than imported because those two want a
    (w,h,x,y) shape for an ffmpeg `crop` filter and this module wants
    (y0,x0,y1,x1) throughout, to slice numpy arrays directly.
    """
    y0 = max(0, min(height - 1, round(box[0] / 1000 * height)))
    x0 = max(0, min(width - 1, round(box[1] / 1000 * width)))
    y1 = max(y0 + 1, min(height, round(box[2] / 1000 * height)))
    x1 = max(x0 + 1, min(width, round(box[3] / 1000 * width)))
    return y0, x0, y1, x1


def _dilate(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Grow ``box`` by the design's dilation rule, clamped only at the end by
    the caller (this function doesn't know the frame size).

    ``cap_px`` (the design doc's "cap height") has no direct measurement on
    `TextRegion` — no per-region font-size/cap-height field was added in
    Task 1's schema extension, and this module has no licence to add one
    (schemas.py is a video-owned file, but growing it is a Task 1 concern,
    not this one's). The box's own height is used as the stand-in: both the
    0.06x dilation factor and the 0.25x cap below then read as the same
    fraction of the one per-region size measurement this schema actually
    carries, which is self-consistent even though it isn't literally cap
    height. The shadow-side asymmetric widening the design doc also calls
    for (`shadow_offset + 2*shadow_blur`) is skipped for the same reason —
    `TextRegion` carries no shadow fields to read.
    """
    y0, x0, y1, x1 = box
    box_h = y1 - y0
    cap_px = box_h
    dilation = max(_MIN_DILATION_PX, _DILATION_SCALE * cap_px) + _CHROMA_BLEED_PX
    dilation = min(dilation, _DILATION_CAP_FRACTION * box_h)
    d = round(dilation)
    return y0 - d, x0 - d, y1 + d, x1 + d


def _clamp(box: tuple[int, int, int, int], height: int, width: int) -> tuple[int, int, int, int]:
    y0, x0, y1, x1 = box
    y0c, x0c = max(0, y0), max(0, x0)
    y1c, x1c = min(height, y1), min(width, x1)
    return y0c, x0c, max(y0c + 1, y1c), max(x0c + 1, x1c)


def _expand(
    box: tuple[int, int, int, int], margin: int, height: int, width: int
) -> tuple[int, int, int, int]:
    y0, x0, y1, x1 = box
    return _clamp((y0 - margin, x0 - margin, y1 + margin, x1 + margin), height, width)


def _boxes_overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    ay0, ax0, ay1, ax1 = a
    by0, bx0, by1, bx1 = b
    return ay0 < by1 and by0 < ay1 and ax0 < bx1 and bx0 < ax1


def _control_box(
    mask_box: tuple[int, int, int, int], height: int, width: int
) -> tuple[int, int, int, int]:
    """A same-size box mirrored away from ``mask_box``, for a later flicker
    check's control comparison. Mirrored horizontally first (the common
    case — a corner bug or a caption off to one side); re-picked (mirrored
    vertically) only when that lands back on the region itself, which only
    happens for a box already centred on the frame's vertical midline.
    """
    y0, x0, y1, x1 = mask_box
    box_w, box_h = x1 - x0, y1 - y0

    mirror_x0 = width - x1
    horizontal = _clamp((y0, mirror_x0, y1, mirror_x0 + box_w), height, width)
    if not _boxes_overlap(horizontal, mask_box):
        return horizontal

    mirror_y0 = height - y1
    vertical = _clamp((mirror_y0, x0, mirror_y0 + box_h, x1), height, width)
    if not _boxes_overlap(vertical, mask_box):
        return vertical

    # Centred both ways (a full-bleed lower-third, in practice) — no mirror
    # misses it, so push to whichever horizontal edge has more clearance
    # instead. Still just a recorded geometry for Task 4b to consume, not a
    # value this module computes a ratio from.
    if x0 >= width - x1:
        return _clamp((y0, 0, y1, box_w), height, width)
    return _clamp((y0, width - box_w, y1, width), height, width)


def _feathered_alpha(height: int, width: int, seam: int) -> np.ndarray:
    """Blend weight in [0, 1], shape (height, width): ~1 in the interior,
    tapering to a soft edge over ``seam`` px.

    The taper happens INSIDE the box only — the patch this multiplies has no
    data beyond the box's own edges to blend outward into, so a rectangle is
    blurred on a padded canvas and re-cropped back to (height, width), which
    softens the box's own boundary rather than extending it. Same idea as
    `app/plate/service.py`'s `Image.composite(...)` feather (frozen, read-only
    reference — not imported), sized to a small per-region patch instead of a
    full frame because this gets precomputed once per region and reused for
    every frame of the shot.
    """
    pad = max(seam * 2, 1)
    canvas = Image.new("L", (width + 2 * pad, height + 2 * pad), 0)
    ImageDraw.Draw(canvas).rectangle([pad, pad, pad + width - 1, pad + height - 1], fill=255)
    blurred = canvas.filter(ImageFilter.GaussianBlur(radius=max(seam, 0.5)))
    alpha = np.asarray(blurred, dtype=np.float32)[pad : pad + height, pad : pad + width]
    return alpha / 255.0


def _region_geometry(region: TextRegion, probe: VideoProbe, seam: int) -> RegionGeometry:
    mask = _clamp(
        _dilate(_quantise_box(region.erase_box, probe.width, probe.height)),
        probe.height, probe.width,
    )
    context = _expand(mask, MARGIN_PX, probe.height, probe.width)
    control = _control_box(mask, probe.height, probe.width)
    mask_h, mask_w = mask[2] - mask[0], mask[3] - mask[1]
    return RegionGeometry(
        mask=mask, context=context, control=control,
        alpha=_feathered_alpha(mask_h, mask_w, seam),
    )


# --- Patch construction --------------------------------------------------------


def _lama_patch(
    frame: np.ndarray, mask_box: tuple[int, int, int, int], context_box: tuple[int, int, int, int]
) -> np.ndarray:
    """One LaMa call on ``frame``'s ``context_box`` crop; returns just the
    ``mask_box``-sized sub-patch to composite — the wider crop only exists to
    give the model surrounding pixels, per IOPaint's own strategy.
    """
    cy0, cx0, cy1, cx1 = context_box
    crop = np.ascontiguousarray(frame[cy0:cy1, cx0:cx1])
    my0, mx0, my1, mx1 = mask_box
    ly0, lx0, ly1, lx1 = my0 - cy0, mx0 - cx0, my1 - cy0, mx1 - cx0

    local_mask = np.zeros(crop.shape[:2], dtype=np.uint8)
    local_mask[ly0:ly1, lx0:lx1] = 255

    crop_h, crop_w = crop.shape[:2]
    crop_img = Image.fromarray(crop)
    mask_img = Image.fromarray(local_mask, mode="L")

    long_edge = max(crop_h, crop_w)
    if long_edge > LAMA_MAX_EDGE:
        # Rule 3: only the crop handed to LaMa may ever be downscaled, never
        # the native frame. NEAREST for the mask — a blurred mask edge would
        # soften exactly the hard fill/keep boundary LaMa needs; LANCZOS for
        # the colour crop and for undoing the downscale afterwards.
        scale = LAMA_MAX_EDGE / long_edge
        small_size = (max(1, round(crop_w * scale)), max(1, round(crop_h * scale)))
        crop_img = crop_img.resize(small_size, Image.LANCZOS)
        mask_img = mask_img.resize(small_size, Image.NEAREST)
        inpainted = lama.inpaint(crop_img, mask_img).resize((crop_w, crop_h), Image.LANCZOS)
    else:
        inpainted = lama.inpaint(crop_img, mask_img)

    inpainted_arr = np.asarray(inpainted)
    return inpainted_arr[ly0:ly1, lx0:lx1]


def _luma_proxy(frame: np.ndarray, width: int = settings.VIDEO_ANALYSIS_WIDTH) -> np.ndarray:
    """Small grayscale proxy of a native frame, for registration only — the
    480px convention `register.py`'s docstring assumes, so its ~1ms/pair FFT
    figure actually holds (a native-resolution FFT would not be free).
    """
    height, width_native = frame.shape[:2]
    proxy_h = max(1, round(height * width / width_native))
    img = Image.fromarray(frame).convert("L").resize((width, proxy_h), Image.BILINEAR)
    return np.asarray(img)


def _median_reconstruct(
    crops: list[np.ndarray],
    local_mask: tuple[int, int, int, int],
    positions_native: list[tuple[float, float]],
) -> list[np.ndarray]:
    """Warp ``crops`` (one shot's native context crop, the same screen-fixed
    window in every frame) onto a common reference by the registered camera
    path, take the temporal median of the swept band, then resample that
    reconstruction back into each frame's own local coordinates.

    Resampling uses NEAREST (rounded-integer) shifts, not full bilinear
    interpolation. Test D's own gate (`register.MIN_PAN_SPEED_PX` = 1.0
    px/frame — the reason this region reached `median` at all) means the
    rounding error is a small fraction of the real motion being compensated
    for, and it turns the whole reconstruction into plain numpy slice
    arithmetic — worth it here because this runs once per median region
    (not once per frame like the compositing step below).
    """
    height, width = crops[0].shape[:2]
    ly0, lx0, ly1, lx1 = local_mask
    stack = np.stack(crops).astype(np.float32)  # (T, H, W, 3)
    frame_count = stack.shape[0]

    # register.translation()'s contract (see its docstring): frame_t[row,col]
    # ~= frame0[row - dy(t), col - dx(t)]. Solving that for frame0 in terms of
    # frame_t (substitute u = row-dy, v = col-dx, so row = u+dy, col = v+dx)
    # gives frame0[u,v] ~= frame_t[u + dy(t), v + dx(t)] — so the reference
    # array at (row,col) is read from crop_t at (row + sy, col + sx), NOT
    # (row - sy, col - sx). Getting this sign backwards silently produces a
    # plausible-looking but WRONG reconstruction (still "an image", just the
    # wrong one) rather than an obvious crash — verified against a hand-built
    # fixture with known ground truth before trusting either sign.
    ref_stack = np.full_like(stack, np.nan)
    yy, xx = np.mgrid[0:height, 0:width]
    for t in range(frame_count):
        dx, dy = positions_native[t]
        sx, sy = int(round(dx)), int(round(dy))
        dst = np.full((height, width, 3), np.nan, dtype=np.float32)
        y_dst_lo, y_dst_hi = max(0, -sy), min(height, height - sy)
        x_dst_lo, x_dst_hi = max(0, -sx), min(width, width - sx)
        if y_dst_hi > y_dst_lo and x_dst_hi > x_dst_lo:
            y_src_lo, y_src_hi = y_dst_lo + sy, y_dst_hi + sy
            x_src_lo, x_src_hi = x_dst_lo + sx, x_dst_hi + sx
            dst[y_dst_lo:y_dst_hi, x_dst_lo:x_dst_hi] = stack[
                t, y_src_lo:y_src_hi, x_src_lo:x_src_hi
            ]
        # A reference pixel is occluded by frame t's overlay iff the source
        # pixel that maps to it — (y+sy, x+sx), where the overlay actually
        # sits in frame t's own coordinates — falls inside the frozen mask
        # rectangle (screen-fixed, so it is the same box in every frame).
        src_y, src_x = yy + sy, xx + sx
        occluded = (src_y >= ly0) & (src_y < ly1) & (src_x >= lx0) & (src_x < lx1)
        dst[occluded] = np.nan
        ref_stack[t] = dst

    with warnings.catch_warnings():
        # "All-NaN slice" is expected at the swept band's outer edge on a
        # short pan (a reference pixel no frame ever saw unoccluded) and is
        # handled explicitly by the fallback below, not a bug to surface.
        warnings.simplefilter("ignore", category=RuntimeWarning)
        reference = np.nanmedian(ref_stack, axis=0)
    if np.isnan(reference).any():
        fallback = np.nanmedian(stack, axis=0)  # `stack` itself has no NaNs
        reference = np.where(np.isnan(reference), fallback, reference)

    patches: list[np.ndarray] = []
    for t in range(frame_count):
        dx, dy = positions_native[t]
        sx, sy = int(round(dx)), int(round(dy))
        ys = np.clip(np.arange(ly0, ly1) - sy, 0, height - 1)
        xs = np.clip(np.arange(lx0, lx1) - sx, 0, width - 1)
        patch = reference[np.ix_(ys, xs)]
        patches.append(np.clip(patch, 0, 255).round().astype(np.uint8))
    return patches


def _median_patches(frames: list[np.ndarray], geom: RegionGeometry) -> list[np.ndarray]:
    """Register ``frames`` (one shot, native RGB, in order) and reconstruct a
    per-frame patch for ``geom.mask`` — see `_median_reconstruct`."""
    proxies = [_luma_proxy(frame) for frame in frames]
    path = register.shot_path(proxies)
    if not path.verdict.camera_moved:
        # `router.plan()` already required test D to pass, on an EARLIER
        # registration (over the analysis proxy, not these native frames) —
        # a disagreement here is a rare re-measurement discrepancy, not a
        # reason to abandon a decision already committed to. The best
        # available motion estimate is still used.
        logger.warning(
            "median: re-registration on native frames did not confirm camera "
            "motion (%s) — proceeding with the recovered path anyway",
            path.verdict.reason,
        )

    frame_h, frame_w = frames[0].shape[:2]
    proxy_h, proxy_w = proxies[0].shape[:2]
    scale_x, scale_y = frame_w / proxy_w, frame_h / proxy_h
    positions_native = [(dx * scale_x, dy * scale_y) for dx, dy in path.positions]

    cy0, cx0, cy1, cx1 = geom.context
    crops = [np.ascontiguousarray(frame[cy0:cy1, cx0:cx1]) for frame in frames]
    my0, mx0, my1, mx1 = geom.mask
    local_mask = (my0 - cy0, mx0 - cx0, my1 - cy0, mx1 - cx0)
    return _median_reconstruct(crops, local_mask, positions_native)


def _prepare_patch(branch: str, frame: np.ndarray, geom: RegionGeometry) -> np.ndarray:
    """The two branches that only need ONE representative frame. `median`
    needs the whole shot and is handled separately, at flush time."""
    if branch == EraseBranch.CLEAN_PLATE:
        return _lama_patch(frame, geom.mask, geom.context)
    if branch == EraseBranch.SCRIM:
        colour = scrim.sample_background_color(frame, geom.mask)
        return scrim.render(geom.mask, colour)
    raise ValueError(f"_prepare_patch does not handle branch {branch!r}")


def _composite_patch(
    frame: np.ndarray, patch: np.ndarray, mask: tuple[int, int, int, int], alpha: np.ndarray
) -> None:
    """Alpha-blend ``patch`` into ``frame[mask]`` in place, feathered by
    ``alpha``. Mutates only that box — every other pixel is untouched, which
    is what keeps the rest of the frame bit-identical.

    Takes ``mask``/``alpha`` directly rather than a full ``RegionGeometry`` so
    `restore_regions` below can reuse the identical feathered blend for a
    plain crop-and-paste of ORIGINAL pixels (its "patch" is a source crop, not
    a LaMa/scrim guess) without a `context`/`control` pair that operation has
    no use for.
    """
    y0, x0, y1, x1 = mask
    region_px = frame[y0:y1, x0:x1].astype(np.float32)
    weight = alpha[..., None]
    blended = patch.astype(np.float32) * weight + region_px * (1.0 - weight)
    frame[y0:y1, x0:x1] = np.clip(blended, 0, 255).round().astype(np.uint8)


# --- ffmpeg boundary -----------------------------------------------------------


def _decode_filter(probe: VideoProbe) -> str:
    """Native resolution, full-range RGB — the working colour space for the
    numpy compositing below. Same `scale ... in/out_color_matrix + in/out_
    range` shape `render.py`'s fast path and `check.py`'s DECODE_FILTER use;
    only the destination (`rgb24`/`out_range=pc` instead of `yuv420p`/`tv`)
    differs, because this leg feeds numpy, not an encoder.
    """
    source_range = probe.color_range if probe.color_range in ("tv", "pc") else "tv"
    return (
        f"scale=in_color_matrix={probe.color_space}:in_range={source_range}:"
        "out_color_matrix=bt709:out_range=pc,format=rgb24"
    )


#: Encode leg: RGB (pc) -> ProRes 422 HQ (tv), tagged bt709 via `setparams`
#: — never via `-color_*` output flags, which `check.py` measured leaving
#: color_transfer/color_primaries as "unknown" on this ffmpeg build.
_ENCODE_FILTER = (
    "scale=in_range=pc:in_color_matrix=bt709:out_range=tv:out_color_matrix=bt709,"
    "format=yuv422p10le,"
    "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
)


def _decode_args(source: Path, probe: VideoProbe) -> list[str]:
    return [
        "-i", str(source),
        "-vf", _decode_filter(probe),
        "-fps_mode", "cfr", "-r", f"{probe.fps:g}",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]


def _encode_args(plate_path: Path, probe: VideoProbe) -> list[str]:
    return [
        "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{probe.width}x{probe.height}", "-r", f"{probe.fps:g}",
        "-i", "-",
        "-vf", _ENCODE_FILTER,
        "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
        "-an",
        str(plate_path),
    ]


# --- Orchestration ---------------------------------------------------------


def _region_report(decision: EraseDecision, geom: RegionGeometry) -> RegionReport:
    return RegionReport(
        shot_index=decision.shot.index, role=decision.region.role, branch=decision.branch,
        cost_mp=decision.cost_mp, reason=decision.reason,
        mask_box=geom.mask, control_box=geom.control,
    )


def _write_sidecar(path: Path, result: PlateResult) -> None:
    payload = {
        "plate_path": str(result.plate_path),
        "width": result.width, "height": result.height, "fps": result.fps,
        "frame_count": result.frame_count,
        "regions": [
            {
                "shot_index": r.shot_index, "role": r.role, "branch": r.branch,
                "cost_mp": r.cost_mp, "reason": r.reason,
                "mask_box": list(r.mask_box), "control_box": list(r.control_box),
            }
            for r in result.regions
        ],
    }
    path.write_text(json.dumps(payload, indent=2))


def build(
    source: Path, probe: VideoProbe, plan: ErasePlan, plate_path: Path, sidecar_path: Path
) -> PlateResult:
    """Execute ``plan`` against ``source`` and write ``plate_path``/``sidecar_path``.

    Whether to call this at all is the caller's decision (a plan whose every
    target lands on stretch/crop needs no plate — see this package's module
    docs and Task 8, which wires that up); this function always builds one
    when asked, including the degenerate zero-region case (a straight native
    ProRes re-encode, still CFR/bt709-tagged/audio-stripped).
    """
    decisions = plan.decisions
    seam = max(2, round(0.002 * min(probe.width, probe.height)))
    geometries = [_region_geometry(d.region, probe, seam) for d in decisions]

    by_shot: dict[int, list[int]] = {}
    for index, decision in enumerate(decisions):
        by_shot.setdefault(decision.shot.index, []).append(index)

    intervals = sorted(
        (
            (decisions[idxs[0]].shot.start_frame, decisions[idxs[0]].shot.end_frame, idxs)
            for idxs in by_shot.values()
        ),
        key=lambda item: item[0],
    )

    patches: dict[int, np.ndarray] = {}
    median_patches: dict[int, list[np.ndarray]] = {}

    frame_bytes = probe.width * probe.height * 3
    frame_count = 0
    interval_ptr = 0
    current_indices: list[int] = []
    current_shot_index: int | None = None
    buffer: list[np.ndarray] = []

    def flush(sink) -> None:
        nonlocal buffer
        if not buffer:
            return
        for index in current_indices:
            decision = decisions[index]
            geom = geometries[index]
            if decision.branch == EraseBranch.MEDIAN:
                median_patches[index] = _median_patches(buffer, geom)
            else:
                patches[index] = _prepare_patch(decision.branch, buffer[0], geom)
        for offset, buffered_frame in enumerate(buffer):
            for index in current_indices:
                geom = geometries[index]
                patch = (
                    median_patches[index][offset]
                    if decisions[index].branch == EraseBranch.MEDIAN
                    else patches[index]
                )
                _composite_patch(buffered_frame, patch, geom.mask, geom.alpha)
            sink.write(buffered_frame.tobytes())
        buffer = []

    with ffmpeg.frame_sink(_encode_args(plate_path, probe)) as sink:
        for frame_index, raw in enumerate(
            ffmpeg.stream_frames(_decode_args(source, probe), frame_bytes)
        ):
            frame = np.frombuffer(raw, dtype=np.uint8).reshape(probe.height, probe.width, 3).copy()

            while interval_ptr < len(intervals) and frame_index > intervals[interval_ptr][1]:
                interval_ptr += 1
            in_range = (
                interval_ptr < len(intervals)
                and intervals[interval_ptr][0] <= frame_index <= intervals[interval_ptr][1]
            )
            indices = intervals[interval_ptr][2] if in_range else []
            shot_index = decisions[indices[0]].shot.index if indices else None

            if shot_index != current_shot_index:
                flush(sink)
                current_indices = indices
                current_shot_index = shot_index
                needs_buffer_now = any(
                    decisions[i].branch == EraseBranch.MEDIAN for i in current_indices
                )
                if current_indices and not needs_buffer_now:
                    for index in current_indices:
                        patches[index] = _prepare_patch(
                            decisions[index].branch, frame, geometries[index]
                        )

            needs_buffer = any(decisions[i].branch == EraseBranch.MEDIAN for i in current_indices)
            if needs_buffer:
                buffer.append(frame)
            else:
                for index in current_indices:
                    geom = geometries[index]
                    _composite_patch(frame, patches[index], geom.mask, geom.alpha)
                sink.write(frame.tobytes())
            frame_count += 1

        flush(sink)

    result = PlateResult(
        plate_path=plate_path, width=probe.width, height=probe.height, fps=probe.fps,
        frame_count=frame_count,
        regions=[_region_report(d, g) for d, g in zip(decisions, geometries, strict=True)],
    )
    _write_sidecar(sidecar_path, result)
    logger.info(
        "plate built: %s (%dx%d @ %.3ffps, %d frames, %d region(s))",
        plate_path, probe.width, probe.height, probe.fps, frame_count, len(decisions),
    )
    return result


# --- Per-target restore (undoing the shared plate for one compose target) --


def restore_regions(
    source: Path,
    plate_path: Path,
    probe: VideoProbe,
    restores: list[tuple[Shot, tuple[int, int, int, int]]],
    out_path: Path,
) -> None:
    """Undo `build()`'s erasure of ``restores`` and write the result to
    ``out_path`` — the same ProRes mezzanine shape `build()` itself produces,
    so a caller can decode it exactly like a plate.

    **Why this exists.** `pipeline._ensure_plate` builds ONE plate per
    creative, erasing every rescue-CANDIDATE region so every compose target
    in the batch can share it (see that function's own docstring for the
    failure this fixes). But the rescue decision — whether a region gets
    redrawn or left burned in — is made PER TARGET (`compose.plan`'s
    `RescueDecision.needs_erase`). A region ONE target rescues (and so needs
    erased) may be judged still legible burned-in by ANOTHER target and left
    alone; if the shared plate already erased it for the first target's
    benefit, the second target's render would decode a blank hole where the
    original used to be — erased from the footage, never redrawn either, the
    message simply gone.

    The fix is a plain crop-and-paste, not a second model pass: for each
    ``(shot, native_box)`` in ``restores``, every frame in that shot's
    ``[start_frame, end_frame]`` gets ``source``'s OWN pixels blended back
    over the plate's — feathered with the identical Gaussian taper `build()`
    uses for an erase patch (`_composite_patch`/`_feathered_alpha`, same
    ``seam`` formula), so the restored edge is as invisible as an erased
    one's. Frames outside every listed shot pass through the plate untouched.

    **The restored box is `_dilate`d exactly like `_region_geometry` dilates
    it for an erase, not left as the raw ``native_box``.** `build()` never
    erases just the raw text box — it grows it first (`_dilate`, IOPaint's
    context-margin rule) and erases THAT. Restoring only the raw box left a
    thin ring of still-erased pixels sitting between the restored patch and
    the true edge of what the plate actually wiped — measured on the real
    creative as a faint rectangular halo around "Make Your Own Way" that
    didn't match the flat card colour it should have disappeared into.
    Dilating here the same way guarantees the restored area covers AT LEAST
    what got erased, so nothing of the plate's fill peeks out around it.

    ``restores`` should be the target's own ``needs_erase=False`` decisions
    (see `render_slow.render_compose`) — a region that target rescued keeps
    the plate's erasure; a region it left burned in, dropped for want of
    room, or that fell outside the stage window all get their true pixels
    back, uniformly, regardless of which erase branch the plate happened to
    use for it.
    """
    seam = max(2, round(0.002 * min(probe.width, probe.height)))
    alpha_cache: dict[tuple[int, int, int, int], np.ndarray] = {}

    def _alpha_for(box: tuple[int, int, int, int]) -> np.ndarray:
        cached = alpha_cache.get(box)
        if cached is None:
            y0, x0, y1, x1 = box
            cached = _feathered_alpha(y1 - y0, x1 - x0, seam)
            alpha_cache[box] = cached
        return cached

    by_shot: dict[int, list[tuple[int, int, int, int]]] = {}
    span_by_shot: dict[int, tuple[int, int]] = {}
    for shot, box in restores:
        mask = _clamp(_dilate(box), probe.height, probe.width)
        by_shot.setdefault(shot.index, []).append(mask)
        span_by_shot[shot.index] = (shot.start_frame, shot.end_frame)

    intervals = sorted(
        ((*span_by_shot[index], boxes) for index, boxes in by_shot.items()),
        key=lambda item: item[0],
    )

    frame_bytes = probe.width * probe.height * 3
    interval_ptr = 0
    restored_count = 0

    # Two independent decodes (the plate, and the untouched source) streamed
    # in lockstep and re-encoded in one pass -- the same buffered-per-frame
    # discipline `build()` uses, never the whole clip in memory at once.
    with ffmpeg.frame_sink(_encode_args(out_path, probe)) as sink:
        plate_frames = ffmpeg.stream_frames(_decode_args(plate_path, probe), frame_bytes)
        source_frames = ffmpeg.stream_frames(_decode_args(source, probe), frame_bytes)
        # `strict=True`: both are the SAME content decoded under the SAME
        # `probe.fps` CFR forcing, so their frame counts must agree exactly —
        # a mismatch means one of the two files is not what it claims to be,
        # and silently truncating to the shorter one would ship a compose
        # render whose LATER shots reference frames that were never restored
        # (or never written at all), which is a worse failure than a loud
        # crash here.
        for frame_index, (plate_raw, source_raw) in enumerate(
            zip(plate_frames, source_frames, strict=True)
        ):
            frame = (
                np.frombuffer(plate_raw, dtype=np.uint8)
                .reshape(probe.height, probe.width, 3)
                .copy()
            )

            while interval_ptr < len(intervals) and frame_index > intervals[interval_ptr][1]:
                interval_ptr += 1
            in_range = (
                interval_ptr < len(intervals)
                and intervals[interval_ptr][0] <= frame_index <= intervals[interval_ptr][1]
            )
            if in_range:
                source_frame = np.frombuffer(source_raw, dtype=np.uint8).reshape(
                    probe.height, probe.width, 3
                )
                for box in intervals[interval_ptr][2]:
                    y0, x0, y1, x1 = box
                    _composite_patch(frame, source_frame[y0:y1, x0:x1], box, _alpha_for(box))
                    restored_count += 1

            sink.write(frame.tobytes())

    logger.info(
        "plate restore: %s (%d shot(s), %d region-frame(s) restored to original pixels)",
        out_path, len(by_shot), restored_count,
    )
