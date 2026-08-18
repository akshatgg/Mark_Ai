"""Slot fitting — trims a video ad to an EXACT DOOH slot length.

**The industry rule.** DOOH networks enumerate discrete slot lengths (8, 10,
15, 30s), not ranges — JCDecaux: "We only broadcast 10-second digital spots."
A creative that misses its slot "can throw off the loop or be rejected."
Indian DOOH is typically 10s spots in a 60-90s loop. So the output must equal
the slot EXACTLY: ``TOLERANCE_SECONDS = 0.0``.

**Why this cannot be a post-process on the delivered file.** A stream-copy
trim can only cut on keyframes, and this codebase's fixed 2-second GOP
quantises any such cut to 2s — fatal when the rule above is an exact match.
The trim has to be decided at plan time, before a single ffmpeg pass runs,
and it has to be decided on SHOT boundaries: a shot boundary is the only
place in the timeline where the picture already changes completely, so
cutting there is invisible in a way a mid-shot cut never is.

**Trim and hold are ONE mechanism, not two.** A shot-boundary trim can
(almost) never land exactly on a slot — shot durations are whatever the
source was cut to, not multiples of anything. So the residual left after the
best-fitting run of whole shots is ALWAYS absorbed by a hold:
``run_duration_seconds + hold_seconds == slot_seconds`` exactly, by
construction (`hold_seconds` is computed as the subtraction, never chosen
independently). This module never proposes a mid-shot cut for the same
reason `render_slow.py` (Task 8) is described as one ffmpeg graph with a
`concat` filter over whole per-shot chains — the picture is only ever built
from complete shots.

**Runs, not seconds, are what gets scored.** Because a trim only happens at
shot boundaries, a `TextRegion` (which belongs to exactly one shot,
`TextRegion.shot_index`) is either kept in full — its entire
`first_seconds..last_seconds` lifetime survives, because the whole shot that
carries it survives — or dropped in full. There is no partial-region case to
model, which is why the scoring below is a role-weighted SUM over
regions-whose-shot-is-kept rather than a per-frame or per-second integral:
the two are mathematically identical here, and the region-sum is the simpler,
faster, and more auditable computation of the same quantity.

**Pure planning.** No ffmpeg, no pixels, no I/O. Consumes a `VideoBlueprint`
and a target slot length and returns a `DurationPlan` that names exactly
which shots survive, what the hold is, and why. `reframe.plan()` and
`compose.py` (Task 6/7) then plan the crop and copy timeline ONLY over the
shots this module kept — trimming runs first because it changes which shots
exist, which changes both of those plans.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.video.schemas import Shot, TextRegion, VideoBlueprint

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: A DOOH slot is not a range — it is matched exactly. This constant exists
#: as documentation of that fact (see module docstring) rather than as a
#: fuzz-comparison input: `hold_seconds` is always computed as
#: `slot_seconds - run_duration_seconds`, which is exact by construction and
#: needs no tolerance to land on the slot.
TOLERANCE_SECONDS = 0.0

#: Role -> weight for "how much of the ad's MESSAGE survives a given run",
#: per the design: headline carries the claim, contact/logo carry the CTA and
#: brand, body is supporting detail. Any role not listed (subhead, legal, or
#: a role vocabulary Gemini invents) falls back to `DEFAULT_ROLE_WEIGHT`,
#: the same weight as body — supporting-detail territory, not the message's
#: headline or its call-to-action.
ROLE_WEIGHT: dict[str, float] = {
    "headline": 3.0,
    "contact": 2.0,
    "logo": 2.0,
    "body": 1.0,
}
DEFAULT_ROLE_WEIGHT = 1.0

#: Above this fraction of the slot, the hold is an operator-visible fact, not
#: something to swallow quietly into a plan nobody reads.
RESIDUAL_WARN_FRACTION = 0.20

#: The reframe render tier (Task 6/8) has no chrome to draw a designed hold
#: card with — it is raw footage, cropped and panned. Below this many
#: seconds it may instead hold the shot's true last frame; beyond it, a
#: static freeze reads as a stalled player and it must switch to the
#: designed card (which the compose tier draws unconditionally, since it
#: already has a canvas). Defined here, alongside the hold-length arithmetic
#: that decides whether it applies, so the two render tiers reference one
#: number rather than two copies drifting apart. Applying it is Task 8's
#: job — this module only exposes it and reports the raw hold length; it
#: touches no pixels.
HOLD_MAX_SECONDS = 1.5

#: Enumerating every contiguous run of shots is only cheap because ad shot
#: counts are small: for N shots there are N*(N+1)/2 runs (any start i <= any
#: end j), which is 210 at N=20 — the plan's own arithmetic for "no
#: cleverness needed". This is a sanity ceiling, not a hard limit: a blueprint
#: with more shots than this still gets a correct answer, just a warning that
#: the corpus assumption behind "just enumerate them" no longer holds.
_EXPECTED_MAX_SHOTS = 20


@dataclass(frozen=True)
class LoopSeamCheck:
    """The verdict on whether a clip SHORTER than its slot can hard-loop
    instead of holding on a still.

    **The interface, not the implementation.** Deciding this for real means
    comparing frame 0 against frame N-1 perceptually (a near-identical pair
    loops seamlessly; anything else — a narrative ad with a beginning and an
    end — must not be hard-looped, because it looks broken). That comparison
    touches pixels, which this module deliberately does not: `plan()` takes
    an OPTIONAL `LoopSeamCheck`, produced elsewhere (the same render tier
    that already decodes frames, e.g. via a `flicker`-style patch-median
    delta or a PSNR check against frame 0), and treats a missing verdict as
    "unknown, therefore not loopable" — never assuming a hard loop is safe
    just because nobody measured it yet.
    """

    loops_seamlessly: bool
    reason: str


@dataclass(frozen=True)
class ShotRun:
    """One candidate contiguous span of WHOLE shots, considered as the
    portion of the ad this plan would keep. Never a partial shot — see the
    module docstring for why a mid-shot cut is off the table entirely."""

    first_shot_index: int
    last_shot_index: int
    #: Every kept `Shot.index`, in order. A tuple (not a set) so `ShotRun` can
    #: stay a frozen, hashable dataclass; callers that need membership tests
    #: wrap this in a `set()` once (see `kept_shots`/`kept_regions` below).
    shot_indices: tuple[int, ...]
    start_seconds: float
    end_seconds: float

    @property
    def duration_seconds(self) -> float:
        return self.end_seconds - self.start_seconds


@dataclass(frozen=True)
class DurationPlan:
    """The chosen trim, the hold that makes it exact, and why.

    `run` is always populated, even when `feasible` is False — see `plan()`'s
    infeasible branch for why an honest "here is the untrimmed source, and
    here is by how much it overruns" beats returning nothing at all.
    """

    feasible: bool
    slot_seconds: float
    run: ShotRun
    run_duration_seconds: float
    #: `slot_seconds - run_duration_seconds`, always. Zero when infeasible —
    #: a negative hold is not a real quantity, so the infeasible branch never
    #: manufactures one; it reports the overrun in `warnings`/`reason`
    #: instead.
    hold_seconds: float
    #: True only when: (a) the run keeps the ENTIRE source (nothing was
    #: trimmed away — see the module docstring on why a truncated edit must
    #: never be hard-looped) and (b) a `LoopSeamCheck` was supplied AND it
    #: measured a seamless loop. False is the safe default in every other
    #: case, including "nobody measured it yet".
    hold_is_loop: bool
    #: Role-weighted fraction of the blueprint's text message this run
    #: retains, 0.0-1.0. 0.0 when the blueprint carries no text regions at
    #: all (nothing to weigh — every run ties, see `_score`).
    score: float
    #: `hold_seconds / slot_seconds`, 0.0 when infeasible (no hold exists to
    #: express as a fraction of anything).
    residual_fraction: float
    warnings: tuple[str, ...] = field(default_factory=tuple)
    reason: str = ""


def _role_weight(role: str) -> float:
    return ROLE_WEIGHT.get(role, DEFAULT_ROLE_WEIGHT)


def _candidate_runs(shots: list[Shot], slot_seconds: float) -> list[ShotRun]:
    """Every contiguous run of >=1 whole shots whose total duration fits the
    slot, in `shots`' order.

    O(n^2) pairs, each summed in O(1) via a running total — n=20 is 210 runs,
    matching the plan's own "no cleverness needed" arithmetic. The tiny
    epsilon on the cutoff guards against a run that sums to EXACTLY the slot
    landing just over it from float accumulation error (e.g. repeated 0.1s
    additions); it never relaxes what actually ships, because the hold that
    makes the final duration exact is always computed from the run's real
    summed duration, not from the slot itself.
    """
    runs: list[ShotRun] = []
    epsilon = 1e-6
    n = len(shots)
    for i in range(n):
        total = 0.0
        for j in range(i, n):
            total += shots[j].duration_seconds
            if total > slot_seconds + epsilon:
                break  # every longer j only grows total further; stop this i
            runs.append(
                ShotRun(
                    first_shot_index=shots[i].index,
                    last_shot_index=shots[j].index,
                    shot_indices=tuple(s.index for s in shots[i : j + 1]),
                    start_seconds=shots[i].start_seconds,
                    end_seconds=shots[j].end_seconds,
                )
            )
    return runs


def _score(run: ShotRun, regions: list[TextRegion], total_weight: float) -> float:
    """Role-weighted fraction of the ad's text message `run` retains.

    Binary per region, not fractional: a region belongs to exactly one shot
    (`TextRegion.shot_index`), and a run only ever keeps or drops a shot in
    full (see the module docstring), so a kept region always keeps its whole
    on-screen lifetime. `total_weight <= 0` means the blueprint carries no
    text at all — every run ties at 0.0, and `plan()`'s tie-break (ends on
    the last shot, then longest kept duration) decides instead.
    """
    if total_weight <= 0:
        return 0.0
    kept = set(run.shot_indices)
    kept_weight = sum(_role_weight(r.role) for r in regions if r.shot_index in kept)
    return kept_weight / total_weight


def _ends_on_last_shot(run: ShotRun, shots: list[Shot]) -> bool:
    return bool(shots) and run.last_shot_index == shots[-1].index


def _keeps_whole_source(run: ShotRun, shots: list[Shot]) -> bool:
    """True when `run` drops nothing — the FIRST and last shot both survive.

    This is the "source is SHORTER than the slot" case from the design: when
    the whole clip already fits, keeping everything is always at least tied
    for the best score (it cannot score lower than any subset) and always
    ends on the last shot, so it always wins `plan()`'s selection. Looping is
    only ever considered here, never for a run that trimmed something away —
    hard-looping a truncated edit is the "looks broken" failure the design
    explicitly rules out.
    """
    if not shots:
        return False
    return run.first_shot_index == shots[0].index and _ends_on_last_shot(run, shots)


def kept_shots(blueprint: VideoBlueprint, run: ShotRun) -> list[Shot]:
    """The `Shot`s `run` retains, in the blueprint's original order — what a
    downstream reframe/compose plan (Task 6/7) walks instead of the full
    shot list, now that duration has decided which shots exist."""
    indices = set(run.shot_indices)
    return [s for s in blueprint.shots if s.index in indices]


def kept_regions(blueprint: VideoBlueprint, run: ShotRun) -> list[TextRegion]:
    """The `TextRegion`s `run` retains — exactly those whose shot survives,
    in full, per the module docstring's binary-per-shot argument."""
    indices = set(run.shot_indices)
    return [r for r in blueprint.regions if r.shot_index in indices]


def _infeasible_plan(
    shots: list[Shot], regions: list[TextRegion], slot_seconds: float
) -> DurationPlan:
    """No contiguous run of whole shots fits the slot at all — not even the
    single shortest shot. Shot-boundary trimming has no valid answer here.

    **Degrade honestly.** The alternative to this branch would be picking
    the "closest" run anyway, but every available run overruns the slot, so
    that would mean either a negative hold (nonsense — there is no such
    thing as removing time from a hold that doesn't exist) or silently
    emitting a plan whose total exceeds the slot the caller asked for, which
    is exactly the "creative that does not match its slot" failure this
    whole module exists to prevent. Instead: report the untrimmed source,
    the exact overrun, and `feasible=False`, so the caller can reject it or
    offer a longer slot rather than receive a plan that lies about fitting.
    """
    shortest = min(shots, key=lambda s: s.duration_seconds)
    overrun = shortest.duration_seconds - slot_seconds
    warning = (
        f"no shot-boundary trim fits the {slot_seconds:.2f}s slot: even the "
        f"shortest shot (index {shortest.index}, {shortest.duration_seconds:.2f}s) "
        f"alone overruns it by {overrun:.2f}s; a mid-shot cut is not an option "
        "(see module docstring), so returning the untrimmed source for the "
        "caller to reject or re-slot rather than a plan that silently exceeds "
        "the requested duration"
    )
    logger.warning(warning)
    full_run = ShotRun(
        first_shot_index=shots[0].index,
        last_shot_index=shots[-1].index,
        shot_indices=tuple(s.index for s in shots),
        start_seconds=shots[0].start_seconds,
        end_seconds=shots[-1].end_seconds,
    )
    total_weight = sum(_role_weight(r.role) for r in regions)
    return DurationPlan(
        feasible=False,
        slot_seconds=slot_seconds,
        run=full_run,
        run_duration_seconds=full_run.duration_seconds,
        hold_seconds=0.0,
        hold_is_loop=False,
        score=_score(full_run, regions, total_weight),
        residual_fraction=0.0,
        warnings=(warning,),
        reason=warning,
    )


def plan(
    blueprint: VideoBlueprint,
    slot_seconds: float,
    loop_seam: LoopSeamCheck | None = None,
) -> DurationPlan:
    """Pick the run of whole shots that best fills `slot_seconds`, and the
    hold that makes the total exact.

    Selection order (each a tie-break on the previous, applied to every
    candidate run of `_candidate_runs`):

    1. Highest role-weighted text-hold coverage (`_score`) — "how much of
       the ad's message survives", the design's own framing.
    2. Ends on the last shot — the end card is almost always last and
       carries the logo and CTA (design's stated tie-break).
    3. Longest kept duration — among ties, the run that leaves the SMALLEST
       hold keeps the most of the actual ad on screen; a hold is a
       deliberate but literally empty beat, so minimising it is the natural
       next preference once the design's own two criteria are exhausted.
    4. Earliest start — the final, purely mechanical tie-break so the choice
       is deterministic when 1-3 all still tie (e.g. no text at all and two
       equal-length runs both ending on the last shot cannot occur
       simultaneously, but this keeps the function total regardless).

    Never mutates `blueprint`.
    """
    shots = sorted(blueprint.shots, key=lambda s: s.index)
    if not shots:
        warning = "blueprint has no shots — nothing to trim or hold"
        logger.warning(warning)
        empty_run = ShotRun(
            first_shot_index=-1, last_shot_index=-1, shot_indices=(), start_seconds=0.0,
            end_seconds=0.0,
        )
        return DurationPlan(
            feasible=False, slot_seconds=slot_seconds, run=empty_run,
            run_duration_seconds=0.0, hold_seconds=0.0, hold_is_loop=False, score=0.0,
            residual_fraction=0.0, warnings=(warning,), reason=warning,
        )

    if len(shots) > _EXPECTED_MAX_SHOTS:
        logger.info(
            "plan(): %d shots exceeds the %d this module's enumeration was sized "
            "for; still correct, just O(n^2) over a larger n",
            len(shots), _EXPECTED_MAX_SHOTS,
        )

    total_weight = sum(_role_weight(r.role) for r in blueprint.regions)
    candidates = _candidate_runs(shots, slot_seconds)
    if not candidates:
        return _infeasible_plan(shots, blueprint.regions, slot_seconds)

    best = max(
        candidates,
        key=lambda run: (
            _score(run, blueprint.regions, total_weight),
            _ends_on_last_shot(run, shots),
            run.duration_seconds,
            -run.first_shot_index,
        ),
    )

    run_duration = best.duration_seconds
    hold_seconds = slot_seconds - run_duration
    residual_fraction = hold_seconds / slot_seconds if slot_seconds > 0 else 0.0
    score = _score(best, blueprint.regions, total_weight)

    warnings: list[str] = []
    if residual_fraction > RESIDUAL_WARN_FRACTION:
        message = (
            f"residual hold is {hold_seconds:.2f}s of a {slot_seconds:.2f}s slot "
            f"({residual_fraction:.0%}) — over the {RESIDUAL_WARN_FRACTION:.0%} "
            "reporting threshold; this is an operator-visible fact, not something "
            "to swallow"
        )
        warnings.append(message)
        logger.info(message)

    hold_is_loop = False
    if hold_seconds > 0 and _keeps_whole_source(best, shots):
        if loop_seam is not None and loop_seam.loops_seamlessly:
            hold_is_loop = True
            logger.info("plan(): hold expressed as a loop — %s", loop_seam.reason)
        elif loop_seam is not None:
            warnings.append(f"loop seam check failed: {loop_seam.reason}; holding instead")
        else:
            warnings.append(
                "source is shorter than the slot and no loop-seam verdict was "
                "supplied; defaulting to a designed hold rather than assuming the "
                "clip loops — see LoopSeamCheck, and never hard-loop a narrative ad"
            )

    reason = (
        f"kept shots {list(best.shot_indices)} ({run_duration:.2f}s of "
        f"{sum(s.duration_seconds for s in shots):.2f}s source) for a "
        f"{slot_seconds:.2f}s slot; coverage score {score:.2f}; hold "
        f"{hold_seconds:.2f}s"
        + (" (loop)" if hold_is_loop else "")
    )
    logger.info("plan(): %s", reason)

    return DurationPlan(
        feasible=True,
        slot_seconds=slot_seconds,
        run=best,
        run_duration_seconds=run_duration,
        hold_seconds=hold_seconds,
        hold_is_loop=hold_is_loop,
        score=score,
        residual_fraction=residual_fraction,
        warnings=tuple(warnings),
        reason=reason,
    )
