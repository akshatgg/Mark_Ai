"""The moving-window planner and its gate — decides where a target-aspect crop
window sits over time, per shot. Pure planning: no ffmpeg, no pixels, no PIL.
Task 8's `render_slow.py` turns whatever this module decides into ffmpeg argv;
this module decides nothing about HOW to render, only WHERE the window goes.

**Why not the spec's Grundmann L1 camera path (w1=10, w2=1, w3=100).** An L1
optimal path is built for ~600 PER-FRAME position estimates and a solver (LP,
usually via `cvxpy`/`scipy`) that smooths a continuous trajectory against
first/second/third-derivative penalties. Neither premise holds here: analysis
(`blueprint.py`) samples `tracking.SAMPLES_PER_SHOT` (7) instants per shot, not
per frame — an LP over 7 points is a suspension system tuned for a road that
was only measured seven times. And every window change this codebase ever
makes happens AT a shot boundary, where the picture already cuts to something
else — that discontinuity is exactly the global-continuity problem L1 exists to
solve, and it is already gone by construction. scipy is also not a dependency
this project carries. So: per shot, either ONE fixed window (exact, by
construction, whenever it exists) or a closed-form linear pan solved exactly
over a tiny feasibility system — no solver, no iteration, no scipy.

**The per-shot model.** Each shot contributes up to `tracking.SAMPLES_PER_SHOT`
instants. At each instant, every `TextRegion` from THIS blueprint whose
`[first_seconds, last_seconds]` covers that instant is "required" to stay
inside the window there (denormalised from its `erase_box` — the per-edge
UNION over the shot, i.e. the most generous/safest footprint on record, see
`schemas.TextRegion`). A shot's required set can therefore change discretely
across its own samples (one line ends, another begins elsewhere) — this is the
only "drift" available from the data this codebase collects, and the linear
pan below fits a straight line through it rather than needing continuous
per-frame tracking to exist.

**Window SIZE is always `geometry.max_window` — never searched, never
shrunk.** A smaller window only ever makes two things worse at once: less room
to contain the required boxes, and a higher `effective_upscale`. There is no
axis on which shrinking below the maximum ever helps, so the only thing left
to solve for, per shot, is the window's POSITION over time.

**Write down the consequence.** Because window size is pinned to `max_window`,
and for a target NARROWER than the source `max_window` is bound by the full
source height, `effective_upscale = target_h / window_h == target_h /
src_h` — independent of content, independent of shots. A 1920x1080 master
therefore can NEVER reframe onto 1080x1920 (upscale 1920/1080 = 1.78x) or onto
1080x2400 (upscale 2400/1080 = 2.22x): both permanently exceed even the
relaxed 1.8x ceiling, for every shot, before a single box is even examined.
Reframe's real domain is a 4K/2K master onto a 1080p panel, or a mild aspect
shift — this is arithmetic, not a gap to discover later.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

from app.video import tracking
from app.video.layout import geometry
from app.video.layout.geometry import Box
from app.video.schemas import Shot, TextRegion, VideoBlueprint

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------
#: Below this, an integer-rounded ffmpeg `x`/`y` expression holds its value
#: for multiple frames and then jumps a whole pixel — a 0.2 px/frame pan
#: holds for 4 frames then steps, which reads as a broken player. At or above
#: it the per-frame integer step is visually continuous against real footage.
#: This single threshold is why no sub-pixel numpy loop exists anywhere in
#: this tier — the plan is either exactly static or moving fast enough that
#: ffmpeg's own per-frame integer evaluation is all that is needed.
MIN_PAN_SPEED = 0.6  # px/frame, at native (source) resolution

#: Effective-upscale ceiling. The tighter number applies whenever the window
#: still shows any burned-in text — type degrades under magnification far
#: faster than footage does, so a plan that keeps text on screen is held to
#: the stricter bound; a plan whose window happens to exclude every burned-in
#: text region (logo-only, or textless) is allowed the looser one.
MAX_UPSCALE_WITH_TEXT = 1.5
MAX_UPSCALE_NO_TEXT = 1.8

#: Total centre travel allowed over one shot, as a fraction of SOURCE width —
#: named "source width" deliberately, matching the design spec's own wording,
#: even for the (rare) vertical-pan case; it is a conservative proxy there,
#: not a claim that a vertical pan's natural budget is measured in width.
MAX_TRAVEL_FRACTION = 0.25


class ReframeMode:
    """String constants, matching this codebase's `FitMode`/`EraseBranch`
    convention — a greppable literal beats an Enum's indirection in logs."""

    STATIC = "static"
    PAN = "pan"


class BoxKind:
    """What a required box represents. Only the SAFE-AREA MARGIN differs by
    kind (`_MARGIN_FRACTION` below); containment itself is identical."""

    #: Type baked into the source pixels by whoever made the original ad.
    TEXT_BURNED_IN = "text_burned_in"
    #: The brand mark. Also part of the original footage, hence the same
    #: (tighter) margin as burned-in text rather than the looser placed one.
    LOGO = "logo"
    #: Copy THIS codebase draws (compose.py, Task 7). Not produced by
    #: anything in this module today — kept here because Task 7's compose
    #: reuses this module's gate as a subroutine and needs the same kind
    #: vocabulary to express its own placed-text requirements against it.
    TEXT_PLACED = "text_placed"
    #: No detector in this codebase can ever produce a FACE box: Global
    #: Constraints forbid adding one (Ultralytics/YOLO weights are AGPL,
    #: InsightFace weights are non-commercial, SAM2 would fight the per-shot
    #: mask freeze the erase tier depends on). "No partially-cropped faces"
    #: is a real requirement from the design, but this codebase has no
    #: signal to check it against — so it is satisfied VACUOUSLY (no face
    #: boxes are ever supplied), never silently claimed as verified. Should
    #: a face/subject signal exist someday, its boxes plug in here with kind
    #: FACE and the containment/margin machinery below already covers them
    #: unchanged: the gate must never reject what it cannot see, only what
    #: it can.
    FACE = "face"


_MARGIN_FRACTION: dict[str, float] = {
    BoxKind.TEXT_BURNED_IN: geometry.SAFE_AREA_BURNED_IN,
    BoxKind.LOGO: geometry.SAFE_AREA_BURNED_IN,
    BoxKind.FACE: geometry.SAFE_AREA_BURNED_IN,
    BoxKind.TEXT_PLACED: geometry.SAFE_AREA_PLACED,
}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RequiredBox:
    """One thing that must stay inside the window. `box` is already in NATIVE
    px — denormalising from a blueprint's 0-1000 space is the caller's job,
    keeping this module unit-agnostic about where boxes come from."""

    box: Box
    kind: str
    label: str = ""


@dataclass(frozen=True)
class GateViolation:
    """One reason a target failed. `shot_index=-1` marks a plan-level check
    (currently only the upscale ceiling) that is not tied to any one shot."""

    shot_index: int
    region: str
    shortfall_px: float
    reason: str


@dataclass(frozen=True)
class ShotWindow:
    """One shot's crop-window decision. `c0`/`v` are expressed along
    `pan_axis` only — the other axis has zero slack by construction (see
    module docstring) and is always centred, so it needs no state here;
    Task 8 recovers it from `window_w`/`window_h` and the source size."""

    shot_index: int
    mode: str  # ReframeMode.*
    pan_axis: str  # "x" | "y"
    window_w: float
    window_h: float
    c0: float  # window centre along pan_axis, px, at the shot's own frame 0
    v: float  # px/frame along pan_axis; exactly 0.0 for STATIC


@dataclass(frozen=True)
class ReframePlan:
    """The whole target's reframe decision. `violations` is non-empty exactly
    when this target must route to compose instead — the WHOLE target, never
    a per-shot mix (a plan half reframed and half composed reads as a broken
    player, per the design)."""

    target_w: int
    target_h: int
    src_w: int
    src_h: int
    effective_upscale: float
    windows: list[ShotWindow] = field(default_factory=list)
    violations: list[GateViolation] = field(default_factory=list)

    @property
    def feasible(self) -> bool:
        return not self.violations


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def _pan_axis(window: Box, src_w: float, src_h: float) -> str:
    """Which axis the window has room to slide along.

    `max_window` pins ONE dimension to the source's own size (zero slack) and
    shrinks the other to the target aspect — only the shrunk dimension can
    ever move without the window leaving the source frame.
    """
    return "x" if window.width < src_w - 1e-6 else "y"


def _denorm(raw: list[int], width: int, height: int) -> Box:
    """`[ymin, xmin, ymax, xmax]`, normalised 0-1000, to a native-px `Box`."""
    ymin, xmin, ymax, xmax = raw
    return Box(xmin / 1000 * width, ymin / 1000 * height, xmax / 1000 * width, ymax / 1000 * height)


def _required_boxes(regions: list[TextRegion], width: int, height: int) -> list[RequiredBox]:
    return [
        RequiredBox(
            box=_denorm(r.erase_box, width, height),
            kind=BoxKind.LOGO if r.role == "logo" else BoxKind.TEXT_BURNED_IN,
            label=r.role,
        )
        for r in regions
    ]


def _samples(
    shot: Shot, regions: list[TextRegion], width: int, height: int
) -> list[tuple[float, list[RequiredBox]]]:
    """One `(t_seconds, required_boxes)` pair per shot-sample instant that has
    at least one active region. An instant with nothing active contributes no
    constraint at all — the window is free there, which is correct: absence
    of a requirement can never narrow where the window is allowed to be.
    """
    boxes = _required_boxes(regions, width, height)
    out: list[tuple[float, list[RequiredBox]]] = []
    for t in tracking.sample_times(shot):
        active = [
            box
            for region, box in zip(regions, boxes, strict=True)
            if region.first_seconds <= t <= region.last_seconds
        ]
        if active:
            out.append((t, active))
    return out


def _frame_of(shot: Shot, t_seconds: float) -> float:
    """`t_seconds` (absolute, within the shot's own span) as a frame OFFSET
    from the shot's first frame — the unit `MIN_PAN_SPEED`, `v`, and ffmpeg's
    per-frame `x`/`y` expression (Task 8) all share.
    """
    span = shot.duration_seconds
    if span <= 0:
        return 0.0
    frames = shot.end_frame - shot.start_frame
    return (t_seconds - shot.start_seconds) / span * frames


def _window_at(window: Box, pan_axis: str, centre: float, src_w: float, src_h: float) -> Box:
    """The window's absolute Box when its pan-axis centre is `centre`. The
    other axis is always centred on the source — it has zero slack, so
    "centred" is its only valid position.
    """
    if pan_axis == "x":
        x0 = centre - window.width / 2
        y0 = (src_h - window.height) / 2
        return Box(x0, y0, x0 + window.width, y0 + window.height)
    y0 = centre - window.height / 2
    x0 = (src_w - window.width) / 2
    return Box(x0, y0, x0 + window.width, y0 + window.height)


def _safe_box(window: Box, margin_fraction: float) -> Box:
    """`geometry.safe_area`, translated onto `window`'s actual position (that
    helper works in a window's own 0,0-origin space)."""
    inset = geometry.safe_area(window.width, window.height, margin_fraction)
    return Box(
        window.x0 + inset.x0, window.y0 + inset.y0, window.x0 + inset.x1, window.y0 + inset.y1
    )


def _axis_bounds(
    req: RequiredBox,
    window: Box,
    pan_axis: str,
    src_w: float,
    src_h: float,
    margin_scale: float = 1.0,
) -> tuple[float, float] | None:
    """The range of pan-axis window-CENTRE positions that keep `req` inside
    the window's safe area. `None` when no position works at all — either
    the box overflows the FIXED axis (which never moves, so no centre choice
    on the other axis can rescue it), or the box itself, plus margin, is
    wider/taller than the window's own fixed size on the pan axis.

    `margin_scale` shrinks the applied safe margin toward 0 without touching
    RAW containment — see `_plan_shot`'s MIN_PAN_SPEED-snap path, the only
    caller that passes anything other than the default 1.0.
    """
    margin = _MARGIN_FRACTION[req.kind] * min(window.width, window.height) * margin_scale
    if pan_axis == "x":
        fixed0 = (src_h - window.height) / 2
        if req.box.y0 < fixed0 + margin or req.box.y1 > fixed0 + window.height - margin:
            return None
        lo = req.box.x1 - window.width / 2 + margin
        hi = req.box.x0 + window.width / 2 - margin
    else:
        fixed0 = (src_w - window.width) / 2
        if req.box.x0 < fixed0 + margin or req.box.x1 > fixed0 + window.width - margin:
            return None
        lo = req.box.y1 - window.height / 2 + margin
        hi = req.box.y0 + window.height / 2 - margin
    return (lo, hi) if lo <= hi else None


def _sample_bounds(
    boxes: list[RequiredBox],
    window: Box,
    pan_axis: str,
    src_w: float,
    src_h: float,
    margin_scale: float = 1.0,
) -> tuple[float, float] | None:
    """Intersection of every active box's own centre-range at one instant."""
    lo, hi = -math.inf, math.inf
    for req in boxes:
        bounds = _axis_bounds(req, window, pan_axis, src_w, src_h, margin_scale)
        if bounds is None:
            return None
        lo, hi = max(lo, bounds[0]), min(hi, bounds[1])
    return (lo, hi) if lo <= hi else None


def _boundary_bounds(window: Box, pan_axis: str, src_w: float, src_h: float) -> tuple[float, float]:
    """The centre range that keeps the window itself inside the source frame
    — independent of any content, this bounds every plan regardless of shot.
    """
    if pan_axis == "x":
        return window.width / 2, src_w - window.width / 2
    return window.height / 2, src_h - window.height / 2


def _static_centre(points: list[tuple[float, float, float]]) -> float | None:
    """The v=0 special case: is there ONE centre satisfying every point's
    interval at once? `points` are `(frame, lo, hi)`; `frame` is unused here
    (a static centre must satisfy every interval regardless of when it was
    observed) but kept in the tuple shape shared with `_solve`.
    """
    lo = max(p[1] for p in points)
    hi = min(p[2] for p in points)
    return (lo + hi) / 2 if lo <= hi else None


def _minimax_centre(points: list[tuple[float, float, float]]) -> float:
    """The v=0 centre minimising the WORST interval crossing, used only when
    `_static_centre` already failed — a standard 1-D minimax argument (the
    midpoint of the tightest lower and upper bound is equidistant from both,
    which is the best any single fixed point can do).
    """
    lo = max(p[1] for p in points)
    hi = min(p[2] for p in points)
    return (lo + hi) / 2


def _solve(points: list[tuple[float, float, float]], v_cap: float) -> tuple[float, float] | None:
    """Exact 2-variable (c0, v) feasibility for `c(t) = c0 + v*t` against
    `points` — `(frame, lo, hi)` interval constraints, at most ~14 for a
    7-sample shot plus the two frame-boundary points. Returns `(v, c0)`
    minimising `|v|`, or `None` if infeasible.

    No LP library. `c0` is eliminated by pairwise combination: feasibility
    needs `max_i(lo_i - v*t_i) <= min_i(hi_i - v*t_i)`, which holding for
    every ordered pair `(i, j)` gives `v*(t_j - t_i) <= hi_j - lo_i` — a
    single linear bound on `v` alone per pair. Intersecting all of them
    collapses the whole 2-D feasible region down to one interval of `v`
    (this IS Fourier-Motzkin elimination on two variables, i.e. exactly the
    vertex a walk of the feasible polygon in (c0, v) space would find,
    reached here without ever materialising the polygon). The vertex
    minimising `|v|` is then whichever end of that interval sits closest to
    zero; `c0` is recovered as the midpoint of the (now single-variable)
    range it must occupy at that `v`.
    """
    v_lo, v_hi = -v_cap, v_cap
    for t_i, lo_i, _hi_i in points:
        for t_j, _lo_j, hi_j in points:
            dt = t_j - t_i
            if dt == 0:
                continue
            bound = (hi_j - lo_i) / dt
            if dt > 0:
                v_hi = min(v_hi, bound)
            else:
                v_lo = max(v_lo, bound)
    if v_lo > v_hi:
        return None
    # 0 can't be feasible here — the caller only reaches `_solve` after
    # `_static_centre` (the exact v=0 case) already failed — but the guard
    # costs nothing and keeps this function correct standalone.
    v = 0.0 if v_lo <= 0.0 <= v_hi else (v_lo if v_lo > 0 else v_hi)
    c_lo = max(lo - v * t for t, lo, _hi in points)
    c_hi = min(hi - v * t for t, _lo, hi in points)
    if c_lo > c_hi + 1e-6:
        return None  # numerical guard only; v was derived from these points
    return v, (c_lo + c_hi) / 2


# ---------------------------------------------------------------------------
# The gate — reporting
# ---------------------------------------------------------------------------


def _verify(
    shot: Shot,
    samples: list[tuple[float, list[RequiredBox]]],
    window: Box,
    pan_axis: str,
    src_w: float,
    src_h: float,
    c0: float,
    v: float,
    margin_scale: float = 1.0,
) -> list[GateViolation]:
    """Re-checks a chosen `(c0, v)` against every sample with real numbers —
    the pass this module's `list[GateViolation]` contract actually reports
    through. Used for the STATIC-SNAP path (see `_plan_shot`), where the
    minimax centre is not guaranteed feasible and any shortfall must be
    reported honestly rather than assumed away.

    `margin_scale` matches `_axis_bounds`' parameter of the same name: 0.0
    checks RAW containment only (no safe-area cushion), which is what the
    snap path verifies against once it has spent the margin as extra room.
    """
    violations: list[GateViolation] = []
    for t_seconds, boxes in samples:
        frame = _frame_of(shot, t_seconds)
        at = _window_at(window, pan_axis, c0 + v * frame, src_w, src_h)
        for req in boxes:
            safe = _safe_box(at, _MARGIN_FRACTION[req.kind] * margin_scale)
            if not geometry.contains(safe, req.box):
                shortfall = geometry.shortfall_px(safe, req.box)
                violations.append(GateViolation(
                    shot.index, req.label or req.kind, shortfall,
                    f"{req.kind} '{req.label}' exceeds the "
                    f"{'raw' if margin_scale == 0.0 else 'safe'} window by "
                    f"{shortfall:.1f}px at t={t_seconds:.2f}s",
                ))
    return violations


def _report_unplaceable(
    shot_index: int,
    boxes: list[RequiredBox],
    window: Box,
    pan_axis: str,
    src_w: float,
    src_h: float,
) -> list[GateViolation]:
    """Real shortfall numbers for a box that cannot fit the window at ANY
    position (see `_axis_bounds`) — measured against the source-centred
    window, since once this is true no placement is actually better than any
    other. Exists so an unrecoverable shot fails with px, never silently.
    """
    centre = (src_w if pan_axis == "x" else src_h) / 2
    at = _window_at(window, pan_axis, centre, src_w, src_h)
    out = []
    for req in boxes:
        safe = _safe_box(at, _MARGIN_FRACTION[req.kind])
        if not geometry.contains(safe, req.box):
            shortfall = geometry.shortfall_px(safe, req.box)
            out.append(GateViolation(
                shot_index, req.label or req.kind, shortfall,
                f"{req.kind} '{req.label}' cannot fit the window at any position "
                f"(shortfall {shortfall:.1f}px)",
            ))
    return out


# ---------------------------------------------------------------------------
# Per-shot planning
# ---------------------------------------------------------------------------


def _plan_shot(
    shot: Shot, regions: list[TextRegion], src_w: int, src_h: int, window: Box, pan_axis: str
) -> tuple[ShotWindow | None, list[GateViolation]]:
    samples = _samples(shot, regions, src_w, src_h)
    if not samples:
        centre = (src_w if pan_axis == "x" else src_h) / 2
        return ShotWindow(shot.index, ReframeMode.STATIC, pan_axis, window.width, window.height,
                           centre, 0.0), []

    points: list[tuple[float, float, float]] = []
    unplaceable: list[GateViolation] = []
    for t_seconds, boxes in samples:
        bounds = _sample_bounds(boxes, window, pan_axis, src_w, src_h)
        if bounds is None:
            unplaceable.extend(
                _report_unplaceable(shot.index, boxes, window, pan_axis, src_w, src_h)
            )
            continue
        points.append((_frame_of(shot, t_seconds), *bounds))

    if unplaceable:
        # At least one instant needs a placement no window position can ever
        # give it — panning cannot rescue a per-instant impossibility, so
        # this shot fails outright rather than attempting the LP.
        return None, unplaceable

    lo_b, hi_b = _boundary_bounds(window, pan_axis, src_w, src_h)
    frame_span = float(shot.end_frame - shot.start_frame)
    all_points = [*points, (0.0, lo_b, hi_b), (frame_span, lo_b, hi_b)]

    # --- 1. Static first -----------------------------------------------
    centre = _static_centre(all_points)
    if centre is not None:
        return ShotWindow(shot.index, ReframeMode.STATIC, pan_axis, window.width, window.height,
                           centre, 0.0), []

    # --- 2. Else a linear pan --------------------------------------------
    v_cap = (MAX_TRAVEL_FRACTION * src_w) / frame_span if frame_span > 0 else math.inf
    solved = _solve(all_points, v_cap)
    if solved is None:
        # Infeasible even allowing motion (or motion enough to satisfy
        # containment would exceed the travel budget) -- report against the
        # best static compromise so the failure carries real numbers.
        centre = _minimax_centre(all_points)
        violations = _verify(shot, samples, window, pan_axis, src_w, src_h, centre, 0.0)
        if not violations:
            # The crossing was purely in the boundary/travel constraints,
            # not in any content box -- name that explicitly rather than
            # reporting an empty list for a shot that still failed.
            violations = [GateViolation(
                shot.index, "window", 0.0,
                "no window placement/pan satisfies both containment and the "
                f"{MAX_TRAVEL_FRACTION:g}x source-width travel budget",
            )]
        return None, violations

    v, c0 = solved
    if 0 < abs(v) < MIN_PAN_SPEED:
        # A crawl this slow reads as broken on real footage (see MIN_PAN_SPEED's
        # docstring) -- snap to v=0 instead. "Widen the window" cannot mean
        # growing its PIXEL size: it is already at `max_window`'s ceiling on
        # the pan axis (see module docstring), and growing it further would
        # either break the target aspect or push it outside the source frame.
        # What CAN widen is the window's usable INTERIOR: recompute the
        # per-sample bounds with the safe-area margin scaled to 0 (RAW
        # containment only -- the box must still never be cropped, but the
        # legibility cushion around it is spent as extra room instead). The
        # sub-MIN_PAN_SPEED pan this replaces was, by construction, bridging
        # a tiny crossing (bounded by MIN_PAN_SPEED * frame_span/2), and a
        # margin of SAFE_AREA_BURNED_IN/PLACED (5-10% of the window's short
        # side) is normally far bigger than that bound, so this recovers
        # cleanly in the case the threshold exists to serve. When it still
        # does not, `_verify` reports the honest (now un-cushioned) shortfall
        # instead of forcing a pass -- never silence.
        widened_points = []
        for t_seconds, boxes in samples:
            bounds = _sample_bounds(boxes, window, pan_axis, src_w, src_h, margin_scale=0.0)
            if bounds is not None:
                widened_points.append((_frame_of(shot, t_seconds), *bounds))
        widened_points.extend([(0.0, lo_b, hi_b), (frame_span, lo_b, hi_b)])
        centre = _minimax_centre(widened_points)
        violations = _verify(
            shot, samples, window, pan_axis, src_w, src_h, centre, 0.0, margin_scale=0.0
        )
        if not violations:
            logger.info(
                "shot %d: drift %.3f px/frame is below MIN_PAN_SPEED (%.2g) -- snapped to "
                "static, safe margin spent as content room (raw containment still holds)",
                shot.index, v, MIN_PAN_SPEED,
            )
        return ShotWindow(shot.index, ReframeMode.STATIC, pan_axis, window.width, window.height,
                           centre, 0.0), violations

    mode = ReframeMode.PAN if v != 0 else ReframeMode.STATIC
    return ShotWindow(shot.index, mode, pan_axis, window.width, window.height, c0, v), []


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def plan(blueprint: VideoBlueprint, target_w: int, target_h: int) -> ReframePlan:
    """The whole target's reframe decision: one window per shot, or a
    `violations` list explaining why the WHOLE target must route to compose
    instead (never a per-shot mix — see `ReframePlan`'s docstring).
    """
    src_w, src_h = blueprint.width, blueprint.height
    window = geometry.max_window(src_w, src_h, target_w, target_h)
    pan_axis = _pan_axis(window, src_w, src_h)

    # See module docstring's "Write down the consequence" — this is where
    # that arithmetic actually happens. Aspect-locked, so target_h/window.height
    # == target_w/window.width; either reads the same number.
    effective_upscale = target_h / window.height

    has_burned_in_text = any(r.role != "logo" for r in blueprint.regions)
    max_upscale = MAX_UPSCALE_WITH_TEXT if has_burned_in_text else MAX_UPSCALE_NO_TEXT

    violations: list[GateViolation] = []
    if effective_upscale > max_upscale:
        violations.append(GateViolation(
            -1, "upscale", 0.0,
            f"{target_w}x{target_h} needs {effective_upscale:.3f}x upscale over the "
            f"{window.width:.0f}x{window.height:.0f} window (limit {max_upscale:g}x"
            + ("" if has_burned_in_text else " -- no burned-in text survives the crop") + ")",
        ))

    windows: list[ShotWindow] = []
    for shot in blueprint.shots:
        shot_window, shot_violations = _plan_shot(
            shot, blueprint.regions_in(shot.index), src_w, src_h, window, pan_axis
        )
        violations.extend(shot_violations)
        if shot_window is not None:
            windows.append(shot_window)

    # `_verify`/`_report_unplaceable` run once PER SAMPLE, so a region that is
    # active (and equally short) across every sample of a shot would
    # otherwise repeat the identical line up to SAMPLES_PER_SHOT times — true,
    # but not more auditable for the repetition. Collapse exact repeats,
    # order-preserving, so one violation reads as one reason.
    seen: set[tuple[int, str, str]] = set()
    deduped: list[GateViolation] = []
    for violation in violations:
        key = (violation.shot_index, violation.region, violation.reason)
        if key not in seen:
            seen.add(key)
            deduped.append(violation)

    plan_result = ReframePlan(
        target_w, target_h, src_w, src_h, effective_upscale, windows, deduped
    )
    logger.info(
        "reframe %dx%d -> %dx%d: upscale %.3fx, %d shot(s), %s",
        src_w, src_h, target_w, target_h, effective_upscale, len(blueprint.shots),
        "feasible" if plan_result.feasible else f"{len(violations)} violation(s) -> compose",
    )
    return plan_result
