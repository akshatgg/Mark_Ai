"""Turn flickering per-frame detections into ONE stable region per shot.

Detectors re-decide from scratch every frame: a 0.51-confidence line drops to
0.49 and vanishes, and polygon post-processing shifts edges by 1-3px even when
the pixels are identical. So no single frame is trusted.

The two outputs want OPPOSITE errors, which is why this module produces two
geometries from the same observations:

    union       per-edge maximum -> the erase mask. Over-erasing is invisible;
                a surviving glyph fragment is a defect that ships.
    percentile  per-edge 20th/80th -> the re-typeset box. Rejects the one frame
                where the polygon blew out.

No global-motion compensation, and that is deliberate. It would require opencv,
which this project avoids on purpose, and it buys nothing for the dominant case:
a static overlay on moving footage keeps its box fixed in screen space. When a
later phase genuinely needs flow, it can add the dependency then.
"""

from __future__ import annotations

import logging

from app.video.schemas import Shot

logger = logging.getLogger(__name__)

#: Frames sampled per shot. Enough to vote away a one-frame hallucination,
#: few enough that a 30-second ad is not a detector marathon.
SAMPLES_PER_SHOT = 7

#: A track must appear in at least this share of a shot's sampled frames to be
#: believed. This is where most detector flicker is discarded.
MIN_PRESENCE = 0.60

#: Tighter than a general MOT tracker's gate. Overlays do not occlude each
#: other, so a loose gate merges adjacent lines of the same block rather than
#: recovering from occlusion.
IOU_GATE = 0.45


def sample_times(shot: Shot, count: int = SAMPLES_PER_SHOT) -> list[float]:
    """Evenly spaced sample times inside ``shot``, avoiding its exact edges.

    The first and last frames of a shot are often mid-transition, so samples
    are inset rather than spanning the full range.
    """
    if count < 1:
        return []
    span = shot.duration_seconds
    if span <= 0:
        return [shot.start_seconds]
    inset = span * 0.05
    lo, hi = shot.start_seconds + inset, shot.end_seconds - inset
    if count == 1:
        return [(lo + hi) / 2]
    step = (hi - lo) / (count - 1)
    return [round(lo + step * i, 3) for i in range(count)]


def iou(a: list[int], b: list[int]) -> float:
    """Intersection over union for [ymin, xmin, ymax, xmax] boxes."""
    ay0, ax0, ay1, ax1 = a
    by0, bx0, by1, bx1 = b
    iy0, ix0 = max(ay0, by0), max(ax0, bx0)
    iy1, ix1 = min(ay1, by1), min(ax1, bx1)
    if iy1 <= iy0 or ix1 <= ix0:
        return 0.0
    inter = (iy1 - iy0) * (ix1 - ix0)
    area_a = max(0, ay1 - ay0) * max(0, ax1 - ax0)
    area_b = max(0, by1 - by0) * max(0, bx1 - bx0)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def union_box(boxes: list[list[int]]) -> list[int]:
    """Per-edge maximum extent — the erase mask's geometry."""
    if not boxes:
        raise ValueError("union_box needs at least one box")
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


def _percentile(values: list[float], pct: float) -> float:
    """Linear-interpolated percentile. Avoids a numpy import for four numbers."""
    if not values:
        raise ValueError("percentile needs values")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * (pct / 100.0)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    weight = position - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def percentile_box(boxes: list[list[int]], low: float = 20, high: float = 80) -> list[int]:
    """Per-edge percentile — the re-typeset box's geometry.

    Percentile rather than mean: one blown-out polygon drags a mean badly, and
    the whole point is to reject that frame.

    The defaults are sized for full rejection of a single outlier at
    ``SAMPLES_PER_SHOT`` (currently 7), not chosen for round numbers. With
    linear-interpolation percentiles (``_percentile``, matching numpy's
    default "linear" method) over n samples, the highest observation only
    stops leaking into the high percentile once
    ``high <= 100 * (n - 2) / (n - 1)``. At n=7 that bound is 83.3, so
    ``high=90`` (the textbook default) blends 40% of the outlier into the
    result — measured as a box edge of 281 instead of ~202 on a fixture where
    six boxes clustered near 200 and one blew out to 400. ``high=80`` (and
    its mirror ``low=20``) sits below the bound with margin, so one blown-out
    frame is excluded outright. If ``SAMPLES_PER_SHOT`` changes, recompute
    this bound and revisit these defaults — they are not derived from the
    constant automatically, on purpose (callers may pass box lists of any
    length, so a hidden n-dependent formula here would silently miscalibrate
    for them).
    """
    if not boxes:
        raise ValueError("percentile_box needs at least one box")
    return [
        round(_percentile([b[0] for b in boxes], low)),
        round(_percentile([b[1] for b in boxes], low)),
        round(_percentile([b[2] for b in boxes], high)),
        round(_percentile([b[3] for b in boxes], high)),
    ]


def associate(
    detections: list[list[dict]], iou_gate: float = IOU_GATE
) -> list[list[dict]]:
    """Group per-frame detections into tracks.

    ``detections`` is one list per sampled frame; each item needs a ``box``
    (normalised [ymin, xmin, ymax, xmax]) and may carry any other keys, which
    are preserved. Returns one list of member detections per track.

    Greedy nearest-IoU rather than Hungarian: overlays are few and do not
    occlude, so the optimal assignment and the greedy one agree, and greedy is
    far easier to reason about when a result looks wrong.
    """
    tracks: list[list[dict]] = []
    for frame_index, frame in enumerate(detections):
        for item in frame:
            box = item["box"]
            best, best_iou = None, iou_gate
            for track in tracks:
                # Compare against the track's most recent box, not its first —
                # an overlay that drifts slowly would otherwise fall out of the
                # gate partway through the shot.
                score = iou(track[-1]["box"], box)
                if score >= best_iou:
                    best, best_iou = track, score
            enriched = {**item, "frame_index": frame_index}
            if best is None:
                tracks.append([enriched])
            else:
                best.append(enriched)
    return tracks


def presence(track: list[dict], sampled: int) -> float:
    """Share of sampled frames this track was seen in."""
    if sampled <= 0:
        return 0.0
    return len({m["frame_index"] for m in track}) / sampled
