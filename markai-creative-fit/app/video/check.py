"""The colour-correctness harness — build this before anything that renders.

A colour bug in a video pipeline does not raise. It produces a file that looks
*slightly* flat, passes review, and is only obviously wrong once it is on a
three-metre panel in a cafe. So the pipeline gets a test that fails loudly
instead.

Two independent assertions, and BOTH are required:

1. **Pixels.** Push a known pattern through decode -> raw RGB -> encode, decode
   it again, and compare patch medians.
2. **Tags.** Assert the output actually carries bt709/bt709/bt709/tv.

Why both: a naive encode with no colour handling at all round-trips at delta=1,
perfectly self-consistent, and ships an UNTAGGED file that a BT.709 panel
renders wrong. Pixel equality alone would call that a pass.

Measured on ffmpeg 8.1.2, four recipes, same source, patch-median max delta:

    scale=...out_color_matrix=bt709 + setparams   ->  1   correct AND tagged
    no -vf, no tags                               ->  1   untagged: wrong on glass
    setparams only, matrix not forced             -> 30   601-encoded, 709-tagged
    colorspace=all=bt709:iall=bt709:...           -> 40   wrong filter for RGB->YUV
"""

from __future__ import annotations

import json
import statistics
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.video import ffmpeg


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    detail: str


#: Decode leg. Pins the input matrix/range explicitly rather than letting
#: swscale guess — on unspecified input it falls back to BT.601 limited, and
#: that silent fallback is where the shift is born. RGB is always full range,
#: hence out_range=pc.
DECODE_FILTER = (
    "scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt709:out_range=pc,"
    "format=rgb24"
)

#: Encode leg. `out_color_matrix=bt709` is the whole ballgame — without it
#: swscale encodes with its default 601 matrix while setparams tags the file
#: 709, and the decoder inverts with the wrong one. `setparams` writes the
#: tags; the `-color_*` OUTPUT FLAGS DO NOT (measured on 8.1.2: they leave
#: color_transfer and color_primaries as "unknown").
ENCODE_FILTER = (
    "scale=in_range=pc:in_color_matrix=bt709:out_range=tv:out_color_matrix=bt709,"
    "format=yuv420p,"
    "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
)

#: Patch medians on a grid, NOT per-pixel max. A CORRECT round-trip measures a
#: per-pixel max of ~20 purely from 4:2:0 chroma ringing at the hard edges
#: between colour bars; patch medians on that same correct file measure 1.
PATCH = 8
GRID_X, GRID_Y = 6, 4
PASS_DELTA = 2
WARN_DELTA = 8

EXPECTED_TAGS = {
    "color_space": "bt709",
    "color_transfer": "bt709",
    "color_primaries": "bt709",
    "color_range": "tv",
}


def _patch_medians(frame: np.ndarray) -> np.ndarray:
    """Median of a PATCH x PATCH block at each grid point, avoiding bar edges."""
    height, width, _ = frame.shape
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            cy = round(height * (gy + 0.5) / GRID_Y)
            cx = round(width * (gx + 0.5) / GRID_X)
            half = PATCH // 2
            block = frame[cy - half : cy + half, cx - half : cx + half]
            out.append(np.median(block.reshape(-1, 3), axis=0))
    return np.asarray(out)


def _decode_first_frame(path: Path, width: int, height: int) -> np.ndarray:
    raw = ffmpeg.run(
        ["-i", str(path), "-vf", DECODE_FILTER, "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    )
    return np.frombuffer(raw, np.uint8)[: width * height * 3].reshape(height, width, 3)


def _tags(path: Path) -> dict[str, str]:
    out = ffmpeg.run_probe(
        ["-select_streams", "v:0", "-show_entries",
         "stream=color_space,color_transfer,color_primaries,color_range",
         "-of", "json", str(path)]
    )
    return json.loads(out)["streams"][0]


def golden_frame(width: int = 1920, height: int = 1080) -> list[CheckResult]:
    """Generate SMPTE bars, round-trip them, assert pixels AND tags."""
    results: list[CheckResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "bars.mp4"
        roundtrip = Path(tmp) / "roundtrip.mp4"

        ffmpeg.run([
            "-y", "-f", "lavfi",
            "-i", f"smptehdbars=size={width}x{height}:rate=25:duration=1",
            "-vf", "format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:"
                   "colorspace=bt709:range=tv",
            "-c:v", "libx264", "-preset", "slow", "-crf", "10",
            "-profile:v", "high", "-an", str(source),
        ])

        before = _decode_first_frame(source, width, height)

        # The 75% white bar must decode to ~191 (0.75 * 255). If this drifts to
        # ~180 or ~204 the DECODE leg is mishandling range and nothing
        # downstream can be trusted, so it is asserted before anything else.
        # Sampled well inside the bar, not near its edge: on this smptehdbars
        # frame at 1920 wide the white bar runs pixels 240-445 (measured; the
        # white->yellow boundary sits at x=446), so 0.15-0.21 lands with ~45px
        # of margin on both sides instead of straddling the boundary.
        white = float(np.median(before[height // 6, int(width * 0.15) : int(width * 0.21)]))
        results.append(CheckResult(
            "decode-range",
            abs(white - 191) <= 3,
            f"75% white decoded to {white:.1f}, expected ~191",
        ))

        raw = before.tobytes()
        ffmpeg.run([
            "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{width}x{height}", "-r", "25", "-i", "-",
            "-vf", ENCODE_FILTER,
            "-c:v", "libx264", "-preset", "slow", "-crf", "12",
            "-profile:v", "high", "-an", "-movflags", "+faststart", str(roundtrip),
        ], stdin=raw)

        after = _decode_first_frame(roundtrip, width, height)
        delta = float(np.abs(_patch_medians(before) - _patch_medians(after)).max())
        results.append(CheckResult(
            "golden-pixels",
            delta <= PASS_DELTA,
            f"patch-median max delta {delta:.1f} "
            f"(pass <= {PASS_DELTA}, warn <= {WARN_DELTA})",
        ))

        tags = _tags(roundtrip)
        wrong = {k: tags.get(k) for k, v in EXPECTED_TAGS.items() if tags.get(k) != v}
        results.append(CheckResult(
            "golden-tags",
            not wrong,
            "all four colour tags present" if not wrong else f"wrong/missing: {wrong}",
        ))
    return results


def encode_assertions(width: int = 1920, height: int = 1080, fps: float = 30.0
                      ) -> list[CheckResult]:
    """Render a real target and assert the file a panel would actually receive."""
    # Imported here, not at module scope: check.py is the harness that tests
    # render.py, so a module-level import would make the dependency circular.
    from app.video import encode, render
    from app.video import probe as probe_module

    results: list[CheckResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "src.mp4"
        out = Path(tmp) / "out.mp4"
        ffmpeg.run([
            "-y", "-f", "lavfi",
            "-i", f"testsrc2=size={width}x{height}:rate={fps:g}:duration=2",
            "-vf", "format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:"
                   "colorspace=bt709:range=tv",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", str(source),
        ])
        source_probe = probe_module.probe(source)
        render.render_fast(source, out, source_probe, width, height)

        raw = ffmpeg.run_probe([
            "-select_streams", "v:0", "-show_entries",
            "stream=profile,level,pix_fmt,width,height,codec_type",
            "-show_entries", "format=nb_streams", "-of", "json", str(out),
        ])
        parsed = json.loads(raw)
        stream = parsed["streams"][0]

        expected_level = encode.h264_level(width, height, fps)
        # ffprobe reports the level as an INTEGER: 4.0 -> 40, 5.1 -> 51.
        expected_int = int(round(float(expected_level) * 10))
        results.append(CheckResult(
            "encode-level",
            stream.get("level") == expected_int,
            f"level {stream.get('level')} (expected {expected_int} for "
            f"{width}x{height}@{fps:g})",
        ))
        # `-preset ultrafast` SILENTLY overrides `-profile:v high`, yielding
        # Constrained Baseline: no CABAC, no B-frames, measurably worse at the
        # same bitrate. Nothing else in the pipeline would catch it.
        results.append(CheckResult(
            "encode-profile", stream.get("profile") == "High",
            f"profile {stream.get('profile')!r} (expected 'High')",
        ))
        results.append(CheckResult(
            "encode-pix-fmt", stream.get("pix_fmt") == "yuv420p",
            f"pix_fmt {stream.get('pix_fmt')!r}",
        ))
        results.append(CheckResult(
            "encode-even-dims",
            stream["width"] % 2 == 0 and stream["height"] % 2 == 0,
            f"{stream['width']}x{stream['height']}",
        ))
        results.append(CheckResult(
            "encode-no-audio",
            int(parsed["format"]["nb_streams"]) == 1,
            f"{parsed['format']['nb_streams']} stream(s)",
        ))

        head = out.read_bytes()[:4_000_000]
        moov, mdat = head.find(b"moov"), head.find(b"mdat")
        results.append(CheckResult(
            "encode-faststart", 0 <= moov < mdat,
            f"moov@{moov} mdat@{mdat}",
        ))
    return results


def analysis_assertions() -> list[CheckResult]:
    """Prove the analysis stage can tell its two decisive cases apart.

    A shot detector that finds no cuts and a static test that says everything
    is static would both "pass" a smoke test while being useless. These two
    fixtures are built to discriminate.

    The background-moves fixture is full-frame `geq=random(...)` noise over a
    `nullsrc`, NOT `testsrc2` as an earlier draft of this harness used.
    `testsrc2` is mostly flat static colour bars with motion confined to a
    thin diagonal sweep, so the control ring at this box position measures
    only ~0.014 — under SURROUND_MOVES_MIN (0.02) — and the assertion below
    would fail (confirmed at -crf 0, ruling out compression as the cause).
    `mandelbrot` was tried as a replacement and rejected: its zoom path is not
    reproducible across ffmpeg builds (0.0206 on one machine, 0.0117 on
    another). Full-frame noise is high-entropy by construction, deterministic
    on a given ffmpeg build (`geq`'s `random()` is a fixed-seed LCG in
    libavutil/eval.c, not wall-clock seeded), and measures ring ~0.263 here —
    a decisive margin over the 0.02 threshold. The drawn box on top is still
    solid and unchanging frame to frame, so `pixels_static` stays True.
    """
    from app.video import motion
    from app.video import probe as probe_module
    from app.video import shots as shots_module
    from app.video.schemas import Shot

    results: list[CheckResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        # Three visually distinct segments concatenated -> must find 3 shots.
        parts = []
        for index, source in enumerate([
            "testsrc2=size=320x180:rate=25:duration=1",
            "color=c=red:size=320x180:rate=25:duration=1",
            "smptebars=size=320x180:rate=25:duration=1",
        ]):
            part = Path(tmp) / f"p{index}.mp4"
            ffmpeg.run(["-y", "-f", "lavfi", "-i", source, "-c:v", "libx264",
                        "-preset", "ultrafast", "-crf", "25", "-pix_fmt", "yuv420p",
                        "-an", str(part)])
            parts.append(part)
        listing = Path(tmp) / "list.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in parts))
        cuts = Path(tmp) / "cuts.mp4"
        ffmpeg.run(["-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25",
                    "-an", str(cuts)])

        cut_probe = probe_module.probe(cuts)
        found = shots_module.detect(cuts, cut_probe.duration_seconds, cut_probe.fps)
        # COUNT alone is not proof of correct segmentation: three zero-length
        # shots bunched at t=0 would also satisfy `len(found) == 3`. This
        # fixture's three concatenated segments are exactly 1s each, so the
        # cut times are known in advance -- assert THOSE too, not just how
        # many shots came back. Tolerance is +/-0.05s (~1 frame at 25fps),
        # enough for scdet to land a cut a frame early/late without letting a
        # genuinely wrong boundary (e.g. everything bunched near t=0) pass.
        expected_cuts = [1.0, 2.0]
        actual_cuts = [shot.start_seconds for shot in found[1:]]
        shots_ok = len(found) == 3 and all(
            abs(actual - expected) <= 0.05
            for actual, expected in zip(actual_cuts, expected_cuts, strict=True)
        )
        results.append(CheckResult(
            "analysis-shots", shots_ok,
            f"{len(found)} shot(s), cuts at {actual_cuts} "
            f"(expected 3 shots, cuts ~{expected_cuts})",
        ))

        # A static box over full-frame random noise: pixels static (the box is
        # solid and unmoving), background recoverable (the noise is
        # high-entropy everywhere, so the control ring moves decisively).
        moving = Path(tmp) / "moving.mp4"
        ffmpeg.run(["-y", "-f", "lavfi",
                    "-i", "nullsrc=size=320x180:rate=25:duration=2,"
                          "geq=random(1)*255:random(1)*255:random(1)*255",
                    "-vf", "drawbox=x=60:y=130:w=150:h=30:color=white@1.0:t=fill",
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25",
                    "-pix_fmt", "yuv420p", "-an", str(moving)])
        move_probe = probe_module.probe(moving)
        shot = Shot(index=0, start_seconds=0.0, end_seconds=move_probe.duration_seconds,
                    start_frame=0, end_frame=49)
        box = [round(130 / 180 * 1000), round(60 / 320 * 1000),
               round(160 / 180 * 1000), round(210 / 320 * 1000)]
        measured = motion.classify(moving, box, shot, move_probe.width, move_probe.height)
        results.append(CheckResult(
            "analysis-static-region", measured.pixels_static,
            f"drawn box measured static (ratio {measured.mafd_ratio:.3f})",
        ))
        # `background_moves` alone only checks that mafd_ring clears
        # SURROUND_MOVES_MIN (0.02) -- but that comparison is scale-invariant
        # to the exact metric-conflation bug these modules' docstrings spend
        # twenty lines warning about: removing the /255 normalisation in
        # `_crop_mafd` leaves mafd_ring at ~67 instead of ~0.263 here, and 67
        # clears 0.02 just as easily as 0.263 does, so `background_moves`
        # alone would keep passing on a metric a hundred times the wrong
        # scale. mafd_ring IS defined as YAVG (0-255) / 255 (`_crop_mafd`), so
        # it must land in [0, 1] -- assert that too, so an un-normalised
        # metric fails loudly here instead of shipping silently.
        background_moves_ok = measured.background_moves and 0.0 <= measured.mafd_ring <= 1.0
        results.append(CheckResult(
            "analysis-background-moves", background_moves_ok,
            f"surround measured moving (ring mafd {measured.mafd_ring:.5f}, expected in [0, 1])",
        ))
    return results


#: `erase-recovers`'s thresholds, calibrated against a REAL `plate.build()`
#: run (Task 8) rather than a synthetic stand-in -- see `erase_assertions`'s
#: docstring for the fixture. Measured on this fixture: recovered 23.8 dB,
#: un-erased 16.8 dB -- a ~7 dB gap. The fixture's own full-colour IID noise
#: (needed for a genuine RGB `plate.mov`, unlike the grayscale-luma proxy
#: `erase-registration` gets away with) is the WORST case for 4:2:0 chroma
#: subsampling, so two independently re-encoded copies of "the same" content
#: never round-trip anywhere near lossless -- this ceiling is a property of
#: the fixture's encoding, not of `median`'s reconstruction (which uses an
#: exact integer-px shift here and has nothing left to lose). Both constants
#: sit with a few dB of margin either side of the measured values so the
#: check has real headroom without being vacuous.
PSNR_RECOVERED_MIN_DB = 21.0
PSNR_UNERASED_MAX_DB = 19.0


def erase_assertions() -> list[CheckResult]:
    """Four checks against the erase package (Task 4b + Task 8's real plate).

    `erase-flicker` and `erase-recovers` run the REAL pipeline end to end:
    `erase.router.plan()` decides a branch (asserted to be `median`, so the
    check is provably exercising real-pixel recovery and not silently
    degrading to `scrim`), `erase.plate.build()` spends it, and both metrics
    are measured on the ACTUAL `plate.mov` it produces -- not a synthetic
    stand-in. The fixture is a genuine camera pan (`crop=...:x='rate*n'`)
    over a wide noise still, with a screen-fixed opaque box painted on AFTER
    the pan (so the box is static in FRAME space while the true background
    sweeps underneath it): `background_moves` is true (the sampled ring
    genuinely changes frame to frame), `pixels_static` is true (the box
    itself never changes), and a REAL registration pass over this same clip
    confirms camera motion -- exactly `median`'s three preconditions, and
    the corpus case the design calls "registration recovers real pixels at
    zero LaMa cost". `median` (not `clean_plate`) is chosen deliberately: it
    needs no LaMa/torch initialisation, keeping this check fast, and its
    whole point is recovering REAL pixels rather than a model's guess --
    which is exactly what `erase-recovers`' PSNR-against-ground-truth check
    wants to be measuring.

    `erase-registration` and `erase-loop-seam` still need no plate at all --
    they exercise `erase/register.py` and `erase/flicker.py`'s own
    primitives directly against fixtures built for this file.
    """
    from PIL import Image

    from app.video import motion as motion_module
    from app.video import probe as probe_module
    from app.video.erase import flicker, plate, register, router
    from app.video.schemas import EraseBranch, Shot, TextRegion, VideoBlueprint

    results: list[CheckResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        # --- shared fixture: a real pan over noise, with a screen-fixed
        # overlay box painted on afterward -----------------------------
        # Names prefixed `recover_` throughout this fixture (even where a
        # value happens to equal the erase-registration fixture's own below)
        # so the two are never accidentally coupled by a shared variable.
        recover_canvas_w, recover_w, recover_h, recover_fps, recover_dur = 960, 480, 270, 25, 2.0
        recover_pan_rate_px = 2.0
        recover_rng = np.random.default_rng(20260813 + 1)  # distinct seed from erase-registration's
        recover_noise = recover_rng.integers(
            0, 256, size=(recover_h, recover_canvas_w, 3), dtype=np.uint8
        )
        recover_still_png = tmp_path / "recover_still.png"
        Image.fromarray(recover_noise).save(recover_still_png)

        # Box in NATIVE px (w, h, x, y) -- comfortably inside the panned
        # window with room for erase/plate.py's 128px context margin to
        # clamp against, not overflow.
        box_w, box_h, box_x, box_y = 100, 60, 150, 90
        erase_box_native = (box_w, box_h, box_x, box_y)

        ground_truth = tmp_path / "ground_truth.mp4"
        ffmpeg.run([
            "-y", "-loop", "1", "-i", str(recover_still_png),
            "-vf", f"crop={recover_w}:{recover_h}:x='{recover_pan_rate_px}*n':y=0,format=yuv420p",
            "-t", f"{recover_dur}", "-r", str(recover_fps),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-an", str(ground_truth),
        ])
        with_overlay = tmp_path / "with_overlay.mp4"
        ffmpeg.run([
            "-y", "-loop", "1", "-i", str(recover_still_png),
            "-vf", (
                f"crop={recover_w}:{recover_h}:x='{recover_pan_rate_px}*n':y=0,"
                f"drawbox=x={box_x}:y={box_y}:w={box_w}:h={box_h}:color=gray@1.0:t=fill,"
                "format=yuv420p"
            ),
            "-t", f"{recover_dur}", "-r", str(recover_fps),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-an", str(with_overlay),
        ])

        probe_data = probe_module.probe(with_overlay)
        shot = Shot(index=0, start_seconds=0.0, end_seconds=probe_data.duration_seconds,
                    start_frame=0, end_frame=int(round(recover_fps * recover_dur)) - 1)

        def _to_norm(box: tuple[int, int, int, int], width: int, height: int) -> list[int]:
            w, h, x, y = box
            return [round(y / height * 1000), round(x / width * 1000),
                    round((y + h) / height * 1000), round((x + w) / width * 1000)]

        erase_box_norm = _to_norm(erase_box_native, recover_w, recover_h)
        region_motion = motion_module.classify(
            with_overlay, erase_box_norm, shot, recover_w, recover_h
        )
        region = TextRegion(
            shot_index=0, role="body", text=None, erase_box=erase_box_norm,
            retypeset_box=erase_box_norm, presence=1.0,
            first_seconds=0.0, last_seconds=probe_data.duration_seconds, motion=region_motion,
        )
        blueprint = VideoBlueprint(
            duration_seconds=probe_data.duration_seconds, fps=recover_fps,
            width=recover_w, height=recover_h, shots=[shot], regions=[region],
        )

        # Real registration over the SAME clip -- reuses `register.py`'s own
        # primitive rather than hand-asserting camera_moved=True, so a
        # regression in registration itself would also fail this check.
        raw_gray = ffmpeg.run([
            "-i", str(with_overlay), "-vf", "format=gray",
            "-f", "rawvideo", "-pix_fmt", "gray", "-",
        ])
        recover_frame_bytes = recover_w * recover_h
        recover_n_frames = len(raw_gray) // recover_frame_bytes
        gray_frames = [
            np.frombuffer(
                raw_gray[i * recover_frame_bytes:(i + 1) * recover_frame_bytes], np.uint8
            ).reshape(recover_h, recover_w)
            for i in range(recover_n_frames)
        ]
        camera_verdict = register.shot_path(gray_frames).verdict

        erase_plan = router.plan(blueprint, probe_data, camera_by_shot={0: camera_verdict})
        # Non-vacuity: if this ever demotes to `scrim`, `erase-flicker` and
        # `erase-recovers` below would silently start measuring a flat
        # colour patch instead of a real recovery -- fail loudly here
        # instead of passing on the wrong thing.
        branch = erase_plan.decisions[0].branch
        if branch != EraseBranch.MEDIAN:
            results.append(CheckResult(
                "erase-flicker", False,
                f"fixture routed to {branch!r}, not 'median' -- camera_moved="
                f"{camera_verdict.camera_moved} ({camera_verdict.reason}); cannot "
                "measure a real recovery on this branch",
            ))
            results.append(CheckResult("erase-recovers", False, "skipped -- see erase-flicker"))
        else:
            plate_path = tmp_path / "plate.mov"
            sidecar_path = tmp_path / "plate.json"
            plate_result = plate.build(with_overlay, probe_data, erase_plan, plate_path,
                                        sidecar_path)
            mask_y0, mask_x0, mask_y1, mask_x1 = plate_result.regions[0].mask_box
            measured_box = (mask_x1 - mask_x0, mask_y1 - mask_y0, mask_x0, mask_y0)

            # --- erase-flicker -------------------------------------------
            flicker_result = flicker.measure(plate_path, measured_box, shot, recover_w, recover_h)
            # Bounding both mafd readings away from degenerate zero, not just
            # the ratio: an implementation that always returned ratio=0.0
            # (e.g. a broken _crop_mafd call measuring nothing) would clear
            # `<= FLICKER_PASS_MAX` just as easily as a correct one.
            flicker_ok = (
                flicker_result.ratio <= flicker.FLICKER_PASS_MAX
                and flicker_result.erase_mafd > 0
                and flicker_result.control_mafd > 0
            )
            results.append(CheckResult(
                "erase-flicker", flicker_ok,
                f"real plate.mov: ratio {flicker_result.ratio:.3f} "
                f"(pass <= {flicker.FLICKER_PASS_MAX}); erase mafd "
                f"{flicker_result.erase_mafd:.5f}, control mafd "
                f"{flicker_result.control_mafd:.5f}, branch={branch}",
            ))

            # --- erase-recovers (PSNR vs ground truth) --------------------
            psnr_recovered = flicker.psnr_luma(plate_path, ground_truth, measured_box, shot)
            # Same crop, measured directly off the UN-erased source (the box
            # still baked in) -- the "did the erase actually do anything"
            # control. Without this half, a plate that just left the
            # original box in place could still pass on ratio alone.
            psnr_unerased = flicker.psnr_luma(with_overlay, ground_truth, measured_box, shot)
            recovers_ok = (
                psnr_recovered >= PSNR_RECOVERED_MIN_DB
                and psnr_unerased <= PSNR_UNERASED_MAX_DB
                and psnr_recovered > psnr_unerased
            )
            results.append(CheckResult(
                "erase-recovers", recovers_ok,
                f"real plate.mov PSNR {psnr_recovered:.1f} dB vs ground truth "
                f"(pass >= {PSNR_RECOVERED_MIN_DB:g}); un-erased source PSNR "
                f"{psnr_unerased:.1f} dB (pass <= {PSNR_UNERASED_MAX_DB:g}) -- the "
                "erase must measurably beat leaving the overlay in place",
            ))

        # --- erase-registration --------------------------------------------
        # A synthetic pan with KNOWN ground truth, per the task: crop a STILL
        # with a moving x. The still is genuinely iid noise generated in
        # numpy, not ffmpeg's `geq=random()` -- measured (separately, while
        # building this fixture) to have poor spectral whiteness: its OWN
        # self-correlation peaks at only ~0.40 with strong ~0.16 secondary
        # peaks (vs numpy iid noise's ~0.73 peak against a ~0.004 secondary),
        # which silently caps peak_ratio at ~2.5 regardless of translation --
        # well under register.MIN_PEAK_RATIO (3.0) even for a PERFECT
        # self-match. That is a property of ffmpeg's `random()`, not of
        # `register.translation`, but it would have made this fixture unable
        # to ever pass test D, for a reason having nothing to do with the
        # code under test.
        canvas_w, win_w, pan_h, pan_fps, pan_dur = 960, 480, 270, 25, 2.0
        pan_rate_px = 2.0
        rng = np.random.default_rng(20260813)
        noise = rng.integers(0, 256, size=(pan_h, canvas_w), dtype=np.uint8)
        still_png = tmp_path / "still.png"
        Image.fromarray(noise).save(still_png)

        pan_clip = tmp_path / "pan.mp4"
        ffmpeg.run([
            "-y", "-loop", "1", "-i", str(still_png),
            "-vf", f"crop={win_w}:{pan_h}:x='{pan_rate_px}*n':y=0,format=yuv420p",
            "-t", f"{pan_dur}", "-r", str(pan_fps),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-an", str(pan_clip),
        ])
        n_frames = int(pan_fps * pan_dur)
        frame_bytes = win_w * pan_h
        raw = ffmpeg.run(
            ["-i", str(pan_clip), "-vf", "format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
        )
        frames = [
            np.frombuffer(raw[i * frame_bytes:(i + 1) * frame_bytes], np.uint8)
            .reshape(pan_h, win_w)
            for i in range(n_frames)
        ]
        pan_path = register.shot_path(frames)
        # b(u) = a(u + rate) for this crop (window x advances, so content
        # shifts left) -- see flicker/register design notes: dx is negative
        # of the crop's own advance rate.
        expected_dx = -pan_rate_px
        measured_dx = statistics.mean(
            b[0] - a[0]
            for a, b in zip(pan_path.positions, pan_path.positions[1:], strict=False)
        )

        # The discriminating case Task 2's own checklist calls for: the SAME
        # still, cropped with a FIXED window (no pan) must measure ~0 and
        # FAIL test D. Asserting both directions in one check is what makes
        # it non-vacuous -- a `shot_path` that always reported
        # `camera_moved=True` would still pass a pan-only assertion.
        still_clip = tmp_path / "still_clip.mp4"
        ffmpeg.run([
            "-y", "-loop", "1", "-i", str(still_png),
            "-vf", f"crop={win_w}:{pan_h}:x=0:y=0,format=yuv420p",
            "-t", f"{pan_dur}", "-r", str(pan_fps),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-an", str(still_clip),
        ])
        raw_still = ffmpeg.run(
            ["-i", str(still_clip), "-vf", "format=gray", "-f", "rawvideo",
             "-pix_fmt", "gray", "-"]
        )
        still_frames = [
            np.frombuffer(raw_still[i * frame_bytes:(i + 1) * frame_bytes], np.uint8)
            .reshape(pan_h, win_w)
            for i in range(n_frames)
        ]
        still_path = register.shot_path(still_frames)

        registration_ok = (
            abs(measured_dx - expected_dx) <= 0.5
            and pan_path.verdict.camera_moved
            and pan_path.verdict.mean_peak_ratio >= register.MIN_PEAK_RATIO
            and not still_path.verdict.camera_moved
        )
        results.append(CheckResult(
            "erase-registration", registration_ok,
            f"pan: measured dx {measured_dx:.3f} px/frame (expected {expected_dx:g} +/- 0.5), "
            f"camera_moved={pan_path.verdict.camera_moved}, "
            f"peak_ratio={pan_path.verdict.mean_peak_ratio:.1f} "
            f"(need >= {register.MIN_PEAK_RATIO:g}); "
            f"locked-off control: camera_moved={still_path.verdict.camera_moved} (expected False)",
        ))

        # --- erase-loop-seam -------------------------------------------
        # Two fixtures built directly with numpy-computable luma expressions
        # (no random source needed here -- geq's periodicity issue above is
        # specific to its `random()`, not to deterministic expressions like
        # `sin`/linear ramps). "good_loop" is a sine wave with exactly one
        # full period across the clip's OWN frame count (n-1, since the seam
        # compares frame 0 against frame n-1, the true last DISPLAYED frame
        # -- see loop_seam()'s docstring), so the wrap-around delta is no
        # bigger than an ordinary step. "bad_loop" is a linear ramp that
        # never returns to its start value -- a textbook visible splice.
        seam_w, seam_h, seam_fps, seam_dur = 320, 180, 25, 2.0
        seam_n = int(seam_fps * seam_dur)
        seam_shot = Shot(index=0, start_seconds=0.0, end_seconds=seam_dur, start_frame=0,
                          end_frame=seam_n - 1)
        full_crop = (seam_w, seam_h, 0, 0)

        good_loop = tmp_path / "good_loop.mp4"
        ffmpeg.run([
            "-y", "-f", "lavfi",
            "-i", f"nullsrc=size={seam_w}x{seam_h}:rate={seam_fps}:duration={seam_dur},"
                  f"geq=128+50*sin(2*PI*N/{seam_n - 1}):128:128",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0",
            "-pix_fmt", "yuv420p", "-an", str(good_loop),
        ])
        bad_loop = tmp_path / "bad_loop.mp4"
        ffmpeg.run([
            "-y", "-f", "lavfi",
            "-i", f"nullsrc=size={seam_w}x{seam_h}:rate={seam_fps}:duration={seam_dur},"
                  "geq=128+2.5*N:128:128",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0",
            "-pix_fmt", "yuv420p", "-an", str(bad_loop),
        ])
        seam_good = flicker.loop_seam(good_loop, full_crop, seam_shot, seam_fps)
        seam_bad = flicker.loop_seam(bad_loop, full_crop, seam_shot, seam_fps)
        # Both directions asserted, same non-vacuity reasoning as
        # erase-registration above: a loop_seam() that always returned
        # ratio=0 would still pass a "good loop reads as smooth" assertion
        # alone.
        seam_ok = seam_good.grade == "pass" and seam_bad.grade == "fail"
        results.append(CheckResult(
            "erase-loop-seam", seam_ok,
            f"smooth loop: ratio {seam_good.ratio:.3f} ({seam_good.grade}); "
            f"visible-jump loop: ratio {seam_bad.ratio:.1f} ({seam_bad.grade}) "
            f"(seam {seam_bad.seam_delta:.4f} vs median step {seam_bad.median_step_delta:.4f})",
        ))
    return results


def run_all() -> list[CheckResult]:
    return [*golden_frame(), *encode_assertions(), *analysis_assertions(), *erase_assertions()]
