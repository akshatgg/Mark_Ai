"""Orchestration — probe once, render many.

Mirrors app/pipeline.py's split and its content-hash caching, for the same
reason: the expensive stages run once per creative, and a new screen shape is
then a cheap render. In Phase A only the probe is cached, because the fast path
has no analysis to reuse; Phase B adds shots.json, blueprint.json and the
erased plate under the same key.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from app.core.config import settings
from app.video import ffmpeg, render
from app.video import probe as probe_module
from app.video.layout import duration
from app.video.schemas import FitMode, Shot, VideoBlueprint, VideoProbe, VideoVariant

if TYPE_CHECKING:
    from app.video.erase.register import TestDVerdict

logger = logging.getLogger(__name__)

SOURCE = "source.mp4"
PROBE = "probe.json"
BLUEPRINT = "blueprint.json"
#: The erased mezzanine (Task 4's erase/plate.py) and the sidecar recording
#: which shots it actually covers. One per creative, shared by every compose
#: target -- see `_ensure_plate`'s docstring for why.
PLATE = "plate.mov"
PLATE_SIDECAR = "plate.json"

#: `role`s that never leave the video (compose.py's `_REQUIRED_INSIDE_STAGE_ROLES`,
#: duplicated here rather than imported -- this module only needs the two
#: names, not compose's own private constant, to decide which regions are
#: rescue CANDIDATES worth erasing at all).
_NEVER_ERASED_ROLES = frozenset({"logo", "product"})


def creative_id_for(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:20]


def creative_dir(creative_id: str) -> Path:
    path = settings.WORK_DIR / creative_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _variant_name(width: int, height: int) -> str:
    return f"var_{width}x{height}.mp4"


def _sidecar_path(out: Path) -> Path:
    return out.with_suffix(".json")


def ingest(data: bytes, force: bool = False) -> tuple[str, Path, VideoProbe]:
    """Park the source and probe it. Cached by content hash."""
    if len(data) > settings.VIDEO_MAX_UPLOAD_MB * 1024 * 1024:
        raise ValueError(f"Video exceeds the {settings.VIDEO_MAX_UPLOAD_MB}MB limit.")

    creative_id = creative_id_for(data)
    folder = creative_dir(creative_id)
    source = folder / SOURCE
    probe_path = folder / PROBE

    # The folder name IS sha256(data)[:20], so a parked file whose size doesn't
    # match `data` cannot be the bytes we were given — it's proof of a bad
    # park (crash, OOM, or full disk mid-write on a previous, non-atomic
    # attempt), not a coincidence to shrug off. Trusting it silently is how a
    # half-written 10s upload becomes a "10 second" slot that actually plays
    # 5.03s: probe and render both succeed against the truncated bytes and
    # nothing downstream ever raises. Re-park whenever the sizes disagree,
    # not only when `force` is passed — `force` only bypasses the *probe*
    # cache below, it never touches this file.
    if force or not source.exists() or source.stat().st_size != len(data):
        # Write to a sibling temp file, then os.replace() onto the final name.
        # os.replace is atomic on the same filesystem: a reader (or a crash
        # mid-write) never observes a partially-written `source.mp4` — it
        # sees either the previous complete file or the new complete one,
        # never a truncated in-between state.
        tmp = folder / f"{SOURCE}.part"
        tmp.write_bytes(data)
        os.replace(tmp, source)

    if not force and probe_path.exists():
        logger.info("probe cache hit for %s", creative_id)
        return creative_id, source, VideoProbe.model_validate_json(probe_path.read_text())

    probe_data = probe_module.probe(source)
    if probe_data.duration_seconds > settings.VIDEO_MAX_DURATION_SECONDS:
        raise ValueError(
            f"Video is {probe_data.duration_seconds:.1f}s; the limit is "
            f"{settings.VIDEO_MAX_DURATION_SECONDS}s."
        )
    probe_path.write_text(probe_data.model_dump_json(indent=2))
    return creative_id, source, probe_data


def _cache_hit(out: Path, sidecar: Path, force: bool) -> VideoVariant | None:
    """A trusted cached variant for `out`, or `None` to fall through to a
    real render. Unchanged from Phase A's logic (see the module's own
    CLAUDE.md rule 8) — factored out here only so `fit_video` can call it for
    EVERY tier (fast, reframe, compose), not duplicate it a second time.
    """
    if force or not out.exists() or not sidecar.exists():
        return None
    try:
        cached = VideoVariant.model_validate_json(sidecar.read_text())
    except ValueError:
        logger.warning("variant sidecar for %s unreadable; re-rendering", out.name)
        return None
    actual_bytes = out.stat().st_size
    # The cache is only as trustworthy as the file it points at — see
    # CLAUDE.md rule 8 for the truncated-render failure mode this guards.
    if cached.bytes is None or actual_bytes != cached.bytes:
        logger.warning(
            "variant %s cache size mismatch (disk=%d, sidecar=%s); re-rendering",
            out.name, actual_bytes, cached.bytes,
        )
        return None
    # Never trust the sidecar's own `path` (see app/pipeline.py's
    # render_variant() for the same fix on the image side).
    cached.path = str(out)
    return cached


def _rebase_blueprint(blueprint: VideoBlueprint, run: duration.ShotRun) -> VideoBlueprint:
    """The kept shots/regions of `run`, with every second-based field shifted
    so the run starts at t=0 — the coordinate system `render_slow`'s
    concatenated output actually has, since each kept shot's PTS is reset to
    0 (`setpts=PTS-STARTPTS`) and `concat` then simply appends them with no
    gap. Because `run` is one CONTIGUOUS span of shots (`duration.py`'s own
    invariant — a shot-boundary trim can only ever drop a prefix and/or a
    suffix, never a hole in the middle), shifting every kept timestamp by the
    same constant (`run.start_seconds`) exactly reproduces that concatenated
    timeline; a non-contiguous kept set would need per-shot offsets instead,
    which `duration.plan()` never produces.

    Frame numbers (`Shot.start_frame`/`end_frame`) are left ABSOLUTE — they
    still index into the ORIGINAL source file, which is what `render_slow`'s
    `trim` filters and the erase tier's mask geometry both need.
    """
    shift = run.start_seconds
    kept = set(run.shot_indices)
    kept_shots = sorted(
        (
            s.model_copy(update={
                "start_seconds": round(s.start_seconds - shift, 6),
                "end_seconds": round(s.end_seconds - shift, 6),
            })
            for s in blueprint.shots if s.index in kept
        ),
        key=lambda s: s.index,
    )
    kept_regions = [
        r.model_copy(update={
            "first_seconds": round(max(0.0, r.first_seconds - shift), 6),
            "last_seconds": round(r.last_seconds - shift, 6),
        })
        for r in blueprint.regions if r.shot_index in kept
    ]
    return blueprint.model_copy(update={
        "shots": kept_shots, "regions": kept_regions, "duration_seconds": run.duration_seconds,
    })


def _camera_verdicts(
    source: Path, probe_data: VideoProbe, shots: list[Shot]
) -> dict[int, TestDVerdict]:
    """Whole-clip test-D verdicts, one `erase.register.TestDVerdict` per
    shot, from ONE cheap proxy decode — `register.shot_path()` runs on
    `VIDEO_ANALYSIS_WIDTH`-proxy luma per its own module docs, so this never
    touches native frames. A shot missing from the returned mapping (fewer
    than 2 proxy frames landed inside it) is handled by
    `erase.router.plan()` exactly like an unconfirmed verdict — camera motion
    unconfirmed, never assumed, so this degrades to `scrim` rather than
    crashing or guessing.
    """
    from app.video.erase import register  # lazy: kept out of the module's light import surface

    proxy_w = settings.VIDEO_ANALYSIS_WIDTH
    probe_frame = ffmpeg.run([
        "-i", str(source), "-vf", f"scale={proxy_w}:-2,format=gray",
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ])
    if not probe_frame:
        return {}
    proxy_h = len(probe_frame) // proxy_w
    if proxy_h <= 0:
        return {}

    # `fps` FIRST, before the scale — same reasoning as
    # `render_slow._fps_filter`: shot.start_frame/end_frame assume frame i
    # sits at time i/fps, which only holds once the stream is true CFR.
    raw = ffmpeg.run([
        "-i", str(source),
        "-vf", f"fps={probe_data.fps:g},scale={proxy_w}:{proxy_h},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ])
    frame_bytes = proxy_w * proxy_h
    frame_count = len(raw) // frame_bytes
    frames = [
        np.frombuffer(raw[i * frame_bytes:(i + 1) * frame_bytes], np.uint8)
        .reshape(proxy_h, proxy_w)
        for i in range(frame_count)
    ]

    verdicts = {}
    for shot in shots:
        start = max(0, shot.start_frame)
        end = min(frame_count - 1, shot.end_frame)
        if end < start + 1:
            # Fewer than 2 proxy frames landed in this shot — shot_path()
            # itself would just report "no motion to measure" anyway.
            continue
        verdicts[shot.index] = register.shot_path(frames[start:end + 1]).verdict
    return verdicts


def _ensure_plate(
    folder: Path, source: Path, probe_data: VideoProbe, blueprint: VideoBlueprint, force: bool
) -> tuple[Path | None, set[int]]:
    """Build (or reuse) ONE erased plate covering every rescue-CANDIDATE
    region, shared by every compose target this call renders — never built
    at all when nothing in the (trimmed) blueprint could ever need rescuing
    (see the module docs / Task 8's own constraint: no plate when every
    target lands on stretch/crop, and by the same logic, none when reframe
    covers everything either).

    Erasing every candidate rather than each target's own precise
    `ComposePlan.plate_request` is a deliberate simplification: the exact
    per-target union would be tighter, but computing it needs every target's
    `ComposePlan` before anything can be built (a two-pass plan-then-build
    pipeline). This creative-wide superset needs only one pass, never erases
    a `logo`/`product` region (compose never rescues those — see
    `compose._REQUIRED_INSIDE_STAGE_ROLES`), and `erase.router.
    VIDEO_ERASE_BUDGET_MP`'s own demotion still caps the LaMa cost regardless
    of how many targets are being fit.

    **This is NOT, by itself, "always SAFE" — it shipped documented that way
    and that was wrong.** The rescue decision (`compose.plan`'s
    `RescueDecision.rescued`/`needs_erase`) is made PER TARGET: a region one
    target rescues (redrawn, legibly, in its own copy column) may be judged
    still legible burned-in by a DIFFERENT target at a different stage scale,
    and left alone there. Erasing that region into the ONE plate every target
    shares, for the first target's benefit, means the second target decodes a
    hole where the burned-in original used to be -- and since that target
    never queued a redraw for it either (it never decided to rescue it), the
    region disappears from the ad completely: not in the footage, not in the
    copy column. Measured on a real creative: a 1920x1080 compose judged
    "Make Your Own Way" still legible in the stage and left it burned in,
    while the SAME creative's portrait targets rescued it -- the shared plate
    had already erased it, and the 1920x1080 render shipped with no headline
    anywhere.

    The fix is not computing the tighter per-target union up front (that is
    still the two-pass restructure this function exists to avoid); it lives
    downstream, in `render_slow.render_compose`: every compose target
    restores its OWN un-rescued (`needs_erase=False`) regions' ORIGINAL
    pixels back over this shared plate before its crop/pan pipeline runs -- a
    plain crop-and-paste from the decoded source (`erase.plate.
    restore_regions`), feathered exactly like an erase patch, at native
    resolution, no model call. A target that rescues everything the plate
    erased has nothing to restore and renders straight off this plate,
    unchanged -- which is why the portrait targets are unaffected by this.
    """
    from app.video.erase import plate as erase_plate
    from app.video.erase import router as erase_router

    candidates = [r for r in blueprint.regions if r.role not in _NEVER_ERASED_ROLES]
    if not candidates:
        return None, set()

    plate_path = folder / PLATE
    sidecar_path = folder / PLATE_SIDECAR
    if not force and plate_path.exists() and sidecar_path.exists():
        try:
            payload = json.loads(sidecar_path.read_text())
            ready = {int(r["shot_index"]) for r in payload["regions"]}
        except (ValueError, KeyError, OSError):
            logger.warning("plate sidecar for %s unreadable; rebuilding", folder.name)
        else:
            if plate_path.stat().st_size > 0:
                logger.info("plate cache hit for %s", folder.name)
                return plate_path, ready
            logger.warning("plate for %s is 0 bytes; rebuilding", folder.name)

    erase_blueprint = blueprint.model_copy(update={"regions": candidates})
    camera_by_shot = _camera_verdicts(source, probe_data, blueprint.shots)
    erase_plan = erase_router.plan(erase_blueprint, probe_data, camera_by_shot=camera_by_shot)
    plate_result = erase_plate.build(source, probe_data, erase_plan, plate_path, sidecar_path)
    ready = {report.shot_index for report in plate_result.regions}
    return plate_path, ready


def fit_video(
    data: bytes,
    targets: list[tuple[int, int]],
    force: bool = False,
    slot_seconds: float | None = None,
) -> tuple[str, VideoProbe, list[VideoVariant], list[tuple[tuple[int, int], str]]]:
    """Fit one creative to N targets, without letting one bad target cost the rest.

    ``slot_seconds`` is the DOOH slot every reframe/compose target is trimmed
    to fit EXACTLY (`layout.duration.plan()`, which always runs first, before
    reframe/compose). Defaults to the source's own duration — i.e. no
    trimming — so a caller that never asks for slot-fitting sees no change in
    behaviour. The fast path (stretch/crop) never trims: it is one
    whole-source ffmpeg pass, unchanged from Phase A, and slot-fitting a
    same-shape re-target is not this task's job.

    Returns ``(creative_id, probe, variants, failures)`` — ``failures`` is a
    list of ``((width, height), reason)`` for targets that could not be
    rendered: a shape shift the fast path can't cover AND analysis
    unavailable (no Gemini key, no cached blueprint), an infeasible slot fit,
    or a reframe/compose gate failure. A single bad target used to cost every
    other target's result too, on every retry; this function's job is to not
    throw away renders that already succeeded.
    """
    creative_id, source, probe_data = ingest(data, force=force)
    folder = creative_dir(creative_id)

    variants: list[VideoVariant] = []
    failures: list[tuple[tuple[int, int], str]] = []
    to_render: list[tuple[int, int, Path, Path]] = []
    for width, height in targets:
        out = folder / _variant_name(width, height)
        sidecar = _sidecar_path(out)
        cached = _cache_hit(out, sidecar, force)
        if cached is not None:
            variants.append(cached)
            logger.info("variant cache hit for %dx%d", width, height)
            continue
        to_render.append((width, height, out, sidecar))

    if not to_render:
        return creative_id, probe_data, variants, failures

    needs_blueprint = any(
        render.fit_mode(probe_data.width, probe_data.height, w, h)
        not in (FitMode.STRETCH, FitMode.CROP)
        for w, h, _out, _sidecar in to_render
    )

    trimmed_blueprint: VideoBlueprint | None = None
    duration_plan: duration.DurationPlan | None = None
    plate_path: Path | None = None
    plate_ready_shots: set[int] = set()
    blueprint_error: str | None = None

    if needs_blueprint:
        from app.video.blueprint import MissingApiKeyError

        try:
            raw_blueprint = analyse(creative_id, source, probe_data, force=force)
        except MissingApiKeyError as exc:
            # Only the reframe/compose tiers below need this — stretch/crop
            # targets in the same batch still render fine without a key.
            blueprint_error = str(exc)
        else:
            slot = probe_data.duration_seconds if slot_seconds is None else slot_seconds
            duration_plan = duration.plan(raw_blueprint, slot)
            if not duration_plan.feasible:
                blueprint_error = duration_plan.reason
            else:
                trimmed_blueprint = _rebase_blueprint(raw_blueprint, duration_plan.run)
                plate_path, plate_ready_shots = _ensure_plate(
                    folder, source, probe_data, trimmed_blueprint, force
                )

    for width, height, out, sidecar in to_render:
        mode = render.fit_mode(probe_data.width, probe_data.height, width, height)
        if mode not in (FitMode.STRETCH, FitMode.CROP) and trimmed_blueprint is None:
            failures.append(((width, height), blueprint_error or "analysis unavailable"))
            continue
        try:
            variant = render.render(
                source, out, probe_data, trimmed_blueprint, duration_plan, width, height,
                plate_path=plate_path, plate_ready_shots=plate_ready_shots, state_dir=folder,
            )
        except render.NeedsRebuild as exc:
            # Not a failure of the input, and not fatal to the batch — record
            # it and keep going so the other targets still render.
            logger.warning("target %dx%d needs a rebuild: %s", width, height, exc)
            failures.append(((width, height), str(exc)))
            continue
        sidecar.write_text(variant.model_dump_json())
        variants.append(variant)
    return creative_id, probe_data, variants, failures


def parse_target(value: str) -> tuple[int, int]:
    """'1080x2400' -> (1080, 2400)."""
    try:
        width, height = value.lower().split("x")
        parsed = (int(width), int(height))
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"bad resolution {value!r}, expected WIDTHxHEIGHT") from exc
    if parsed[0] < 1 or parsed[1] < 1:
        raise ValueError(f"bad resolution {value!r}")
    if max(parsed) > settings.MAX_OUTPUT_EDGE:
        raise ValueError(
            f"{value} exceeds the {settings.MAX_OUTPUT_EDGE}px limit on the long edge"
        )
    return parsed


def analyse(
    creative_id: str, source: Path, probe_data: VideoProbe, force: bool = False
) -> VideoBlueprint:
    """Stage 2 — segment, read and measure. Cached beside the probe.

    Cached for the same reason the image path caches its blueprint: this is the
    only stage that costs model calls, and every target resolution renders off
    the same artifact. A new screen shape must never re-run analysis.
    """
    from app.video import blueprint as blueprint_module
    from app.video import motion
    from app.video import shots as shots_module

    folder = creative_dir(creative_id)
    path = folder / BLUEPRINT

    if not force and path.exists():
        try:
            logger.info("blueprint cache hit for %s", creative_id)
            return VideoBlueprint.model_validate_json(path.read_text())
        except ValueError:
            logger.warning("blueprint cache unreadable; re-analysing")

    found = shots_module.detect(source, probe_data.duration_seconds, probe_data.fps)
    result = blueprint_module.analyse(source, probe_data, found)

    by_index = {s.index: s for s in result.shots}
    for region in result.regions:
        shot = by_index.get(region.shot_index)
        if shot is None:
            continue
        try:
            region.motion = motion.classify(
                source, region.erase_box, shot, probe_data.width, probe_data.height
            )
        except Exception:  # noqa: BLE001 — a measurement failure degrades one region
            logger.warning("motion classify failed for %s", region.erase_box, exc_info=True)

    if result.warnings:
        # A blueprint with warnings is a DEGRADED read (a shot's frames
        # couldn't be extracted, every sampled frame in a shot failed to
        # read, ...) — caching it indistinguishably from a clean one means a
        # transient model outage during the only analysis run poisons this
        # creative forever, silently, until someone thinks to pass --force.
        # Still return the degraded result so this run completes and the
        # warnings reach the caller; just don't let a later run trust it.
        logger.warning(
            "blueprint for %s has %d warning(s); NOT caching so the next run "
            "re-analyses instead of serving this degraded result forever: %s",
            creative_id, len(result.warnings), "; ".join(result.warnings),
        )
    else:
        path.write_text(result.model_dump_json(indent=2))
    return result
