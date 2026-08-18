"""Per region, per shot: HOW its baked-in overlay gets removed.

Three branches, cheapest-exact-first:

  clean_plate  `not motion.background_moves` — inpaint ONE frame's crop, paste
               it onto every frame. 1 LaMa crop, exact.
  median       `pixels_static AND background_moves AND` test D passes —
               register the frames and take the temporal median of the swept
               band. Zero LaMa cost, exact (it is real pixels, not invented
               ones).
  scrim        everything else, including budget demotions — an opaque band
               at the sampled background colour, with the copy re-typeset on
               top. Zero LaMa cost. Static by construction.

Test D is the reason this file exists rather than being three lines.
``RegionMotion.background_moves`` alone only proves the SURROUND changed — a
locked-off shot with a walking subject clears it too, and then registration
is the identity transform, the median still contains the overlay, and the
flicker check would read a perfect, self-certifying 1.0. Test D's job is to
prove the CAMERA moved before `median` is trusted. Its verdict
(``erase.register.TestDVerdict``) is produced by Task 2's ``shot_path()``,
built in parallel with this module — `plan()` takes it in as a parameter
(``camera_by_shot``) rather than computing it, which is what let the two
modules be written, and tested, independently of each other. This module
imports ONLY ``TestDVerdict`` from register.py (a plain, frame-free
dataclass, not the numpy machinery that produces it), so it stays pure
decision logic: no ffmpeg, no I/O, no numpy frame work, no mutation of its
inputs.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping

from app.video.erase.register import TestDVerdict
from app.video.schemas import (
    EraseBranch,
    EraseDecision,
    ErasePlan,
    RegionMotion,
    Shot,
    TextRegion,
    VideoBlueprint,
    VideoProbe,
)

logger = logging.getLogger(__name__)

#: LaMa measures 8.3 s/MP on this machine (CLAUDE.md's video section, Task 4's
#: 1024x1024 -> 8.68s and 2600x1463 -> 99.5s benchmarks). Against a 900s total
#: budget that also has to cover ~7 Gemini calls/shot and the x264 encode, 60
#: MP of clean_plate work is ~500s of LaMa alone — the ceiling this router
#: enforces so a text-heavy creative degrades instead of blowing the budget.
VIDEO_ERASE_BUDGET_MP = 60.0

#: IOPaint's inpaint-context rule: the crop handed to LaMa is the mask box
#: plus this margin on every edge (Task 4 builds the SAME crop). The router's
#: cost estimate has to count it too, or a plan can under-report the MP a
#: clean_plate decision will actually spend.
MARGIN_PX = 128


def _crop_area_mp(box: list[int], width: int, height: int, margin: int = MARGIN_PX) -> float:
    """Native-pixel area of ``box`` (normalised [ymin,xmin,ymax,xmax], 0-1000)
    plus its erase margin, in megapixels.

    Scales the same way ``motion._pixels`` converts a normalised box to native
    pixels, so this estimate and Task 4's actual crop agree on the same
    region, then clamps to the frame — an edge-hugging box's margin does not
    extend past the picture, so counting as if it did would overstate cost and
    demote regions that would never have needed it.
    """
    y0 = max(0.0, box[0] / 1000 * height - margin)
    x0 = max(0.0, box[1] / 1000 * width - margin)
    y1 = min(float(height), box[2] / 1000 * height + margin)
    x1 = min(float(width), box[3] / 1000 * width + margin)
    area_px = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    return area_px / 1_000_000


def _decide(
    region: TextRegion,
    shot: Shot,
    motion: RegionMotion | None,
    verdict: TestDVerdict | None,
    probe: VideoProbe,
) -> tuple[str, float, str]:
    """One region's branch, LaMa cost and reason — budget-blind.

    Budget demotion is a separate pass in ``plan()``: it needs every region's
    provisional decision and cost before it can rank them by price, so it
    cannot be folded into a single-region function like this one.
    """
    cost_mp = _crop_area_mp(region.erase_box, probe.width, probe.height)

    if motion is None:
        # blueprint.py / pipeline.analyse degrade a single region to
        # motion=None on a measurement failure (see pipeline.py's motion.classify
        # try/except) rather than failing the whole blueprint. Recoverability is
        # unknown, so the cheapest branch that never risks inventing pixels wins.
        return (
            EraseBranch.SCRIM,
            0.0,
            "no motion measurement for this region (classify() likely failed); "
            "scrim is the safe default when recoverability is unknown",
        )

    if not motion.background_moves:
        return (
            EraseBranch.CLEAN_PLATE,
            cost_mp,
            f"background never moves (ring mafd {motion.mafd_ring:.4f}); one "
            "inpainted frame is exact for every frame in the shot",
        )

    if not motion.pixels_static:
        # background_moves is True but the overlay's OWN pixels also change —
        # a caption that animates, a ticking counter. Not a stable static
        # overlay, so neither a single frame nor a temporal median is valid.
        return (
            EraseBranch.SCRIM,
            0.0,
            "overlay content itself changes across the shot (pixels_static=False); "
            "neither a single frame nor a temporal median would be correct",
        )

    # background_moves AND pixels_static: something in frame moved. Test D is
    # the only signal that tells us whether it was the CAMERA (real pixels
    # exist behind the overlay in other frames) or a subject moving in front
    # of an otherwise locked-off shot (nothing exists behind the overlay
    # anywhere — the bug this module's docstring exists to prevent).
    if verdict is not None and verdict.camera_moved:
        return (
            EraseBranch.MEDIAN,
            0.0,
            "background moves, the overlay is static, and test D confirms the "
            f"camera moved ({verdict.reason}); registration recovers real pixels "
            "at zero LaMa cost",
        )

    detail = (
        verdict.reason if verdict is not None
        else f"no test-D verdict supplied for shot {shot.index}"
    )
    return (
        EraseBranch.SCRIM,
        0.0,
        "background moves and the overlay looks static, but test D did not "
        f"confirm camera motion ({detail}) — a subject moving in an otherwise "
        "locked-off shot clears background_moves without the camera ever "
        "moving, which would make registration the identity transform and "
        "leave the overlay sitting in the 'recovered' median; scrim is the "
        "deliberate fallback for exactly this case",
    )


def plan(
    blueprint: VideoBlueprint,
    probe: VideoProbe,
    camera_by_shot: Mapping[int, TestDVerdict] | None = None,
    budget_mp: float = VIDEO_ERASE_BUDGET_MP,
) -> ErasePlan:
    """Decide, per region per shot, how its overlay gets removed.

    Pure and side-effect free: reads ``region.motion`` (set by
    ``pipeline.analyse``'s ``motion.classify`` pass — see schemas.py's
    ``TextRegion``) and ``camera_by_shot`` (test D's verdict, keyed by
    ``Shot.index``; each value is an ``erase.register.TestDVerdict`` — the
    ``.verdict`` of that module's ``shot_path()``, Task 2), and returns a
    fresh ``ErasePlan``. Never mutates ``blueprint``, ``probe`` or
    ``camera_by_shot``. A missing shot index in ``camera_by_shot`` is treated
    the same as test D failing — camera motion is unconfirmed, not assumed.
    """
    camera_by_shot = camera_by_shot or {}
    shots_by_index = {shot.index: shot for shot in blueprint.shots}

    provisional: list[EraseDecision] = []
    warnings: list[str] = []
    for region in blueprint.regions:
        shot = shots_by_index.get(region.shot_index)
        if shot is None:
            message = (
                f"region {region.role!r} references shot {region.shot_index}, which "
                "is not in this blueprint; skipped"
            )
            warnings.append(message)
            logger.warning(message)
            continue
        verdict = camera_by_shot.get(region.shot_index)
        branch, cost_mp, reason = _decide(region, shot, region.motion, verdict, probe)
        provisional.append(
            EraseDecision(branch=branch, region=region, shot=shot, cost_mp=cost_mp, reason=reason)
        )

    total = sum(decision.cost_mp for decision in provisional)
    if total <= budget_mp:
        return ErasePlan(
            decisions=provisional,
            total_cost_mp=round(total, 4),
            budget_mp=budget_mp,
            warnings=warnings,
        )

    # Over budget: demote the priciest clean_plate decisions to scrim, one at
    # a time, until the running total is back at or under budget_mp. Sorting
    # by cost_mp descending (stable, so ties keep blueprint order) buys back
    # the most MP per demotion, which minimises how many regions lose their
    # exact recovery — pulling the cheapest region first would demote more of
    # them to close the same gap. median/scrim decisions never appear in
    # `candidates`: they already cost 0 MP, so demoting one would not free any
    # budget.
    decisions = list(provisional)
    candidates = sorted(
        (i for i, d in enumerate(decisions) if d.branch == EraseBranch.CLEAN_PLATE),
        key=lambda i: decisions[i].cost_mp,
        reverse=True,
    )
    running = total
    for i in candidates:
        if running <= budget_mp:
            break
        victim = decisions[i]
        running -= victim.cost_mp
        message = (
            f"demoted {victim.region.role!r} (shot {victim.shot.index}) from "
            f"clean_plate to scrim: its {victim.cost_mp:.2f} MP pushed the plan "
            f"over the {budget_mp:.0f} MP budget"
        )
        decisions[i] = victim.model_copy(
            update={"branch": EraseBranch.SCRIM, "cost_mp": 0.0, "reason": message}
        )
        warnings.append(message)
        logger.info(message)

    return ErasePlan(
        decisions=decisions,
        total_cost_mp=round(running, 4),
        budget_mp=budget_mp,
        warnings=warnings,
    )
