"""Stage 2 — read a video ad's MEANING with Gemini, across sampled frames per shot.

The division of labour is the same one the image path uses, and it is the
reason this is affordable: the model is asked what things ARE (the exact
wording, the role it plays, the font, the colour), and cheap deterministic
machinery is asked where they are and whether they moved. Asking a model for
per-frame geometry would be both slower and less stable than measuring it.

MULTIPLE frames per shot, not one. A single keyframe is not a real read of a
shot — it is a read of one instant that happens to fall inside it, subject to
whatever a detector hallucinates or misses on that exact frame. This module
samples `tracking.SAMPLES_PER_SHOT` frames per shot (evenly spaced, inset from
the cut points), asks Gemini about each, and hands the whole set to
`app/video/tracking.py`'s ByteTrack-style association so that flicker gets
voted away (`tracking.MIN_PRESENCE`) instead of shipped. This is the module
`tracking.py` was built for; sampling one frame per shot would leave it dead
code and silently reintroduce the exact flicker it exists to remove (see
design spec 4.4 and .superpowers/sdd/video/progress-phase-b.md).

Cost: this is 7x the naive one-call-per-shot design (`tracking.SAMPLES_PER_SHOT`
Gemini calls per shot, run serially). For a typical 1-3 shot ad that is 7-21
Flash calls — cheap in tokens, but not free in wall-clock time; see the phase
report for a measured number.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path

from app.core.config import settings
from app.core.fonts import FONTS
from app.video import ffmpeg, tracking
from app.video.schemas import Shot, TextRegion, VideoBlueprint, VideoProbe

logger = logging.getLogger(__name__)

#: Deliberately the same vocabulary as app/blueprint/service.py's PROMPT. A
#: role means the same thing in both blueprints, so the layout rules that
#: already exist for images apply unchanged to a video's copy.
PROMPT = """You are analysing a frame from a finished video advertisement so it
can be rebuilt for a different screen shape.

Return EVERY distinct element you can see, tagged with the role it plays:

- `headline`  the main claim or product name, the biggest type on screen
- `subhead`   secondary line supporting the headline
- `body`      supporting detail, features, locations
- `legal`     fine print, disclaimers, registration numbers
- `contact`   phone, website, email, address — the reply-to block
- `badge`     text INSIDE a coloured shape: a pill, circle, sticker, ribbon.
              Tag by the SHAPE it sits in, not by what it says.
- `logo`      the brand mark
- `product`   the main product or subject being advertised

Rules:
- `text` must be the exact wording, character for character, in the original
  script. Do NOT transliterate or translate. Null for logo/product.
- `box_2d` is [ymin, xmin, ymax, xmax] normalised 0-1000.
- `font_family` MUST be chosen from: {fonts}
- `background_hex` is the dominant background of the LAYOUT, not of any photo.

Be exhaustive. An element you miss survives into the rebuilt ad as a smear."""


def extract_frames(path: Path, times: list[float]) -> list[bytes | None]:
    """One JPEG per time in ``times``, index-aligned with it.

    Generalises the brief's single-keyframe ffmpeg invocation to an arbitrary
    list of timestamps. A failed extraction becomes ``None`` rather than a
    shrunk list: `tracking.associate()` assigns `frame_index` by position via
    `enumerate()`, and `tracking.presence()` divides by the caller-supplied
    sample count — a shrunk list would silently shift every later frame's
    index and miscount presence for the whole shot.
    """
    out: list[bytes | None] = []
    for at in times:
        try:
            data = ffmpeg.run(
                [
                    "-ss", f"{at:.3f}", "-i", str(path),
                    "-frames:v", "1",
                    "-vf", f"scale={settings.VIDEO_ANALYSIS_WIDTH}:-2",
                    "-f", "image2", "-c:v", "mjpeg", "-q:v", "3", "-",
                ]
            )
        except ffmpeg.FfmpegError:
            logger.warning("frame extraction failed at %.3fs in %s", at, path, exc_info=True)
            data = None
        out.append(data or None)
    return out


def keyframes(
    path: Path, shots: list[Shot]
) -> list[tuple[int, list[float], list[bytes | None]]]:
    """``tracking.SAMPLES_PER_SHOT`` JPEGs per shot, as (shot_index, times, frames).

    Sampled with `tracking.sample_times`, which insets from the shot's edges:
    the first and last frames of a shot are frequently mid-transition (a
    dissolve, a wipe, a fade from black) and read as a muddy blend of two
    scenes. `frames` is always the same length as `times` — see
    `extract_frames` for why a failure is `None` rather than a dropped slot.
    """
    out: list[tuple[int, list[float], list[bytes | None]]] = []
    for shot in shots:
        times = tracking.sample_times(shot)
        out.append((shot.index, times, extract_frames(path, times)))
    return out


class MissingApiKeyError(RuntimeError):
    """No `GEMINI_API_KEY` is configured for `_client()` to use.

    A dedicated type (rather than a bare `RuntimeError`) so a caller can catch
    exactly this expected, common condition without also catching — and
    mislabelling — an unrelated `RuntimeError`. In particular `FfmpegError`
    (`app/video/ffmpeg.py`) subclasses `RuntimeError`, so a real ffmpeg
    decode failure inside `analyse()` (raised by `shots.detect`) must not be
    caught by the same `except` that exists to report "no key configured".
    """


def _client():
    from google import genai
    from google.genai import types

    if not settings.ai_configured:
        raise MissingApiKeyError("Video analysis needs GEMINI_API_KEY.")
    # Set at the client level (not per-request) so every call this module
    # makes gets the same deadline with one line — there is only one call
    # shape here. `HttpOptions.timeout` is milliseconds; the setting is
    # seconds. Verified on google-genai 1.75.0 by reading _api_client.py: a
    # per-request http_options.timeout falls back to this client-level value
    # when unset, and it is threaded straight into the underlying httpx
    # request as an actual socket timeout — confirmed by forcing it to 1s
    # against a real call (see the phase report).
    return genai.Client(
        api_key=settings.GEMINI_API_KEY,
        http_options=types.HttpOptions(
            timeout=settings.VIDEO_ANALYSIS_CALL_TIMEOUT_SECONDS * 1000
        ),
    )


def _read_frame(client, image: bytes) -> list | dict:
    """Ask the model what is in one frame. Returns the raw parsed JSON.

    No `response_schema` is passed (unlike the image path), so the shape is
    whatever JSON mode decides for this prompt — measured empirically as a
    bare list of elements, each carrying its own `background_hex`, rather
    than a `{"elements": [...]}` wrapper. `_split_response` below accepts
    either shape rather than betting the whole read on one of them.
    """
    import json

    from google.genai import types

    resp = client.models.generate_content(
        model=settings.AI_MODEL,
        contents=[
            types.Part.from_bytes(data=image, mime_type="image/jpeg"),
            PROMPT.format(fonts=", ".join(FONTS)),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )
    return json.loads(resp.text)


def _split_response(parsed: list | dict) -> tuple[list[dict], str | None]:
    """Normalise one frame's raw JSON into (elements, background_hex).

    Handles both a bare list and a `{"elements": [...], "background_hex": .}`
    wrapper, and falls back to scanning individual elements for
    `background_hex` when it isn't at the top level — that is where it
    empirically lands when the model responds with a bare list.
    """
    if isinstance(parsed, list):
        elements, background = parsed, None
    elif isinstance(parsed, dict):
        raw_elements = parsed.get("elements")
        # No `response_schema` is passed to generate_content (see _read_frame's
        # docstring), so JSON mode's shape for "elements" is unconstrained: it can
        # legally arrive as an int, a string, null, or anything else JSON allows,
        # not just the list we expect. A bare `for element in elements` below would
        # crash on a non-iterable (`{"elements": 1}` -> TypeError) or silently walk
        # character-by-character through a string (`{"elements": "text"}` — a str
        # IS iterable, so it would produce garbage per-character "elements" rather
        # than erroring). Only a real list/tuple is trusted; anything else means
        # "no elements", which degrades this one frame rather than crashing it.
        elements = raw_elements if isinstance(raw_elements, list | tuple) else []
        background = parsed.get("background_hex")
    else:
        elements, background = [], None
    if background is None:
        for element in elements:
            if isinstance(element, dict) and isinstance(element.get("background_hex"), str):
                background = element["background_hex"]
                break
    return elements, background


def _frame_detections(parsed: list | dict) -> tuple[list[dict], str | None]:
    """One frame's raw Gemini JSON -> (detections for tracking.associate, background_hex).

    A detection carries only what `tracking.associate`/`union_box`/
    `percentile_box` need (`box`) plus what the surviving track will report
    (`role`, `text`, `font_family`, `color_hex`). Anything without a usable
    `box_2d` is dropped rather than crashing the frame — a malformed element
    degrades that one detection, not the read.
    """
    elements, background = _split_response(parsed)
    detections: list[dict] = []
    for element in elements:
        if not isinstance(element, dict):
            continue
        box = element.get("box_2d")
        if not isinstance(box, list) or len(box) != 4:
            continue
        try:
            box = [int(v) for v in box]
        except (TypeError, ValueError):
            continue
        detections.append(
            {
                "box": box,
                "role": str(element.get("role") or "body"),
                "text": element.get("text"),
                "font_family": element.get("font_family"),
                "color_hex": element.get("color_hex"),
            }
        )
    return detections, background


def _agree(values) -> str | None:
    """The track's most common non-null value, ties broken by first-seen.

    A stable overlay should read identically on every frame; when a frame's
    OCR noise disagrees, the majority read is more trustworthy than whichever
    frame happened to run last. Plain dict (not `collections.Counter`)
    because iteration order matters here: it preserves insertion order, and
    `max()` only replaces its current pick on a STRICTLY greater count, so a
    tie resolves to whichever value the track saw first.
    """
    counts: dict[str, int] = {}
    for value in values:
        if value is None:
            continue
        if isinstance(value, list | tuple):
            # No `response_schema` is passed to generate_content (see
            # `_read_frame`'s docstring), so a field the prompt describes as
            # one string can legally arrive as a list instead — measured
            # trigger: a multi-line headline returned as
            # `"text": ["LINE ONE", "LINE TWO"]`. Used directly as the dict
            # key below, that raises `TypeError: unhashable type: 'list'` and
            # takes the whole `analyse()` call down with it — no caller
            # upstream of `_agree` catches it (see the phase report). Joined
            # with a newline rather than dropped: for `text` that IS the
            # multi-line headline the model meant, and for any other field a
            # joined string is still a usable value instead of a silently
            # missing one.
            value = "\n".join(str(item) for item in value)
        elif isinstance(value, dict):
            # A different unhashable shape the prompt's contract doesn't
            # rule out. There is no sane single string to recover from a
            # dict, so skip it — one odd frame degrades, not the whole track.
            continue
        counts[value] = counts.get(value, 0) + 1
    return max(counts, key=counts.get) if counts else None


def _read_one(client, shot_index: int, image: bytes | None) -> tuple[bool, list[dict], str | None]:
    """One frame's (successfully_read, detections, background_hex).

    Never raises — a `None` frame (failed extraction), a failed/timed-out
    Gemini call, AND a malformed parse of a successful response all degrade to
    `(False, [], None)` here rather than propagating, exactly like the old
    serial loop's per-frame `except Exception`. Parsing (`_frame_detections`)
    is deliberately inside this same try: with no `response_schema` on the
    call, a "successful" response can still have a shape `_frame_detections`
    chokes on, and that failure must degrade this one frame exactly like a
    network failure does, not escape and take the whole shot down with it.
    Doing the catch inside the worker (rather than around `pool.map` in
    `analyse`) means the pool below can be trusted to just yield values in
    order — nothing to catch mid-iteration, so nothing can disturb that order.
    """
    if image is None:
        return False, [], None
    try:
        parsed = _read_frame(client, image)
        frame_detections, background = _frame_detections(parsed)
    except Exception:  # noqa: BLE001 — one bad/timed-out/malformed frame must not sink the shot
        logger.warning("shot %d: a frame could not be read", shot_index, exc_info=True)
        return False, [], None
    return True, frame_detections, background


def analyse(path: Path, probe_data: VideoProbe, shots: list[Shot]) -> VideoBlueprint:
    """Read every shot's sampled frames and assemble the blueprint.

    A failed read on one FRAME degrades that frame (it contributes an empty
    detection list, which only pulls down that track's presence share). A
    failed read on every frame of a SHOT degrades that shot: a warning is
    recorded and the loop moves on, because an ad whose third shot could not
    be read is still better refitted knowing shots one and two than knowing
    nothing.
    """
    blueprint = VideoBlueprint(
        duration_seconds=probe_data.duration_seconds,
        fps=probe_data.fps,
        width=probe_data.width,
        height=probe_data.height,
        shots=shots,
    )

    frame_sets = keyframes(path, shots)
    if not any(image is not None for _, _, images in frame_sets for image in images):
        blueprint.warnings.append("No keyframes could be extracted; analysis is empty.")
        return blueprint

    # Only reached once at least one frame was extractable, so a missing key
    # here is a genuine setup error (mirrors app/blueprint/service.py) rather
    # than something to paper over — every subsequent Gemini call would fail
    # identically, so failing loudly now is more honest than 21 silent ones.
    client = _client()

    for shot_index, times, images in frame_sets:
        detections: list[list[dict]] = []
        successful_reads = 0
        # Bounded concurrency over one shot's sampled frames. `ThreadPoolExecutor`
        # is correct (not `asyncio`) because the genai client here is synchronous;
        # `httpx.Client` — what it calls under the hood — pools its connections
        # safely across threads, so sharing one `client` across the workers below
        # is safe on the installed google-genai version (1.75.0; verified by
        # reading _api_client.py rather than assumed — see the phase report).
        #
        # `pool.map` returns results in the order of `images` (sample-time order),
        # NOT completion order, even though the calls race each other — this is
        # what keeps `detections` index-aligned with `times` below. Getting that
        # wrong would silently corrupt `tracking.associate`'s temporal grouping and
        # every region's first_seconds/last_seconds. See the phase report for the
        # reordering proof.
        with ThreadPoolExecutor(max_workers=settings.VIDEO_ANALYSIS_CONCURRENCY) as pool:
            read_one = partial(_read_one, client, shot_index)
            for ok, frame_detections, background in pool.map(read_one, images):
                if ok:
                    successful_reads += 1
                    # First-wins, not voted like the track fields below via
                    # `_agree()`: the layout background is a property of the whole
                    # ad, not of any one frame, so the first successful read is as
                    # good as any other and there is nothing to disagree about.
                    if blueprint.background_hex is None and background is not None:
                        blueprint.background_hex = background
                detections.append(frame_detections)

        if successful_reads == 0:
            logger.warning("shot %d: every sampled frame failed to read", shot_index)
            blueprint.warnings.append(f"Shot {shot_index} could not be analysed.")
            continue

        if successful_reads < len(times):
            # A degraded shot must be visible, not silent. This also feeds the
            # presence denominator below: voting is over frames we actually
            # READ, not frames we merely attempted — attributing a lost read
            # to "the overlay wasn't there" is how a real, stable region gets
            # voted away as flicker (see the phase report for the measured
            # 4/7 = 0.571 < MIN_PRESENCE case).
            lost = len(times) - successful_reads
            logger.warning(
                "shot %d: %d of %d sampled frame(s) failed to read",
                shot_index, lost, len(times),
            )
            blueprint.warnings.append(
                f"Shot {shot_index}: {lost} of {len(times)} sampled frame(s) "
                "failed to read; presence was measured against the frames "
                "that succeeded."
            )

        for track in tracking.associate(detections):
            # Denominator is successful_reads, NOT len(times): a track cannot
            # possibly appear in a frame that was never read, so scoring
            # presence against attempted frames punishes the region for a
            # transport failure, not for actually flickering.
            share = tracking.presence(track, successful_reads)
            if share < tracking.MIN_PRESENCE:
                continue  # detector flicker, voted away
            member_times = [times[member["frame_index"]] for member in track]
            blueprint.regions.append(
                TextRegion(
                    shot_index=shot_index,
                    role=_agree(member["role"] for member in track) or "body",
                    text=_agree(member["text"] for member in track),
                    # Opposite errors, on purpose — see tracking.py's module
                    # docstring. Erasing a few pixels too many is invisible;
                    # a re-typeset box must reject the one blown-out polygon.
                    erase_box=tracking.union_box([member["box"] for member in track]),
                    retypeset_box=tracking.percentile_box(
                        [member["box"] for member in track]
                    ),
                    font_family=_agree(member["font_family"] for member in track),
                    color_hex=_agree(member["color_hex"] for member in track),
                    presence=share,
                    first_seconds=min(member_times),
                    last_seconds=max(member_times),
                )
            )

    logger.info(
        "blueprint: %d shot(s), %d region(s) (%s)",
        len(shots), len(blueprint.regions),
        ", ".join(sorted({r.role for r in blueprint.regions})) or "none",
    )
    return blueprint
