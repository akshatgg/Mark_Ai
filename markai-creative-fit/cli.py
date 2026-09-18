#!/usr/bin/env python
"""Local runner — same pipeline the API uses, no server required.

    python cli.py fit banner.jpg 1080x2400 1920x1080
    python cli.py fit banner.jpg 1080x2400 --sheet     # + before/after sheet
    python cli.py blueprint banner.jpg                 # analysis only
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from app import pipeline  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.logging_config import configure_logging  # noqa: E402
from app.video.ffmpeg import FfmpegError  # noqa: E402

#: The message + exit behaviour every image-only entry point had before this
#: check moved off the global guard in main(). Kept as one constant so the two
#: call sites (cmd_blueprint, the image branch of cmd_fit) can't drift apart.
_NO_GEMINI_KEY = "GEMINI_API_KEY is not set (put it in .env)."


def _load(path: Path) -> bytes:
    if not path.is_file():
        sys.exit(f"No such file: {path}")
    return path.read_bytes()


def _print_blueprint(blueprint) -> None:
    print(f"\n{len(blueprint.elements)} elements:")
    for element in blueprint.elements:
        label = (element.text or "").replace("\n", " ")[:44]
        conf = f"{element.font_confidence:.2f}" if element.font_confidence else "-"
        print(
            f"  {element.role.value:9s} {str(element.box_2d):26s} "
            f"{element.font_family or '-':18s} {element.color_hex or '-':8s} "
            f"conf={conf:5s} {label}"
        )


def cmd_blueprint(args) -> None:
    # Gemini is only needed here, not for the video path — see cmd_fit below
    # for why this moved off a global guard in main().
    if not settings.ai_configured:
        sys.exit(_NO_GEMINI_KEY)
    creative_id, blueprint = pipeline.deconstruct(_load(args.image), force=args.force)
    print(f"creative_id: {creative_id}")
    print(f"artifacts:   {pipeline.creative_dir(creative_id)}")
    _print_blueprint(blueprint)


VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}


def cmd_fit_video(args) -> None:
    """The video path. Same command, sniffed from the file.

    Only the FAST tier (stretch/crop) needs no Gemini call. A target past
    ``ASPECT_TOLERANCE`` now renders for real (reframe or compose) instead of
    refusing, and both of those tiers need an analysed `VideoBlueprint` —
    from a Gemini call if none is cached yet. A batch that mixes a fast
    target with a reframe/compose one still renders the fast one even
    without a key; see `pipeline.fit_video`'s per-target failure handling.
    """
    from app.video import pipeline as video_pipeline

    targets = [video_pipeline.parse_target(t) for t in args.targets]
    creative_id, probe_data, variants, failures = video_pipeline.fit_video(
        _load(args.image), targets, force=args.force, slot_seconds=args.slot_seconds
    )
    print(f"creative_id: {creative_id}")
    print(f"artifacts:   {video_pipeline.creative_dir(creative_id)}")
    print(
        f"\nsource: {probe_data.width}x{probe_data.height} "
        f"{probe_data.fps:g}fps {probe_data.duration_seconds:.2f}s "
        f"{probe_data.codec} audio={'yes' if probe_data.has_audio else 'no'}"
    )
    if variants:
        print("\nvariants:")
        for variant in variants:
            print(
                f"  {variant.width}x{variant.height:<6d} {variant.mode:9s} "
                f"shift={variant.aspect_shift:.2f}x  level={variant.level:4s} "
                f"{Path(variant.path).name}"
            )
            for warning in variant.warnings:
                print(f"      note: {warning}")
    if failures:
        # Reframe and compose are both real now — a failure here means the
        # reframe/compose gate genuinely could not be satisfied (or analysis
        # was unavailable: no Gemini key, no cached blueprint), not "not
        # built yet". One out-of-range panel must not cost every other
        # panel's result, on every retry.
        print("\nfailed targets:")
        for (width, height), reason in failures:
            print(f"  {width}x{height}: {reason}")
    # Non-zero only when NOTHING rendered — a partial batch is still useful
    # output, not a failed run.
    if not variants:
        sys.exit(1)


def cmd_fit(args) -> None:
    if args.image.suffix.lower() in VIDEO_SUFFIXES:
        return cmd_fit_video(args)
    # The video branch above never needs a model; only gate the image path,
    # right where it's about to be used.
    if not settings.ai_configured:
        sys.exit(_NO_GEMINI_KEY)
    targets = [pipeline.parse_target(t) for t in args.targets]
    creative_id, blueprint, variants = pipeline.fit(
        _load(args.image), targets, force=args.force
    )
    print(f"creative_id: {creative_id}")
    print(f"artifacts:   {pipeline.creative_dir(creative_id)}")
    _print_blueprint(blueprint)

    print("\nvariants:")
    for variant in variants:
        print(
            f"  {variant.width}x{variant.height:<6d} {variant.mode:9s} "
            f"shift={variant.aspect_shift:.2f}x  {variant.path.name}"
        )

    weak = [
        e.text or e.role.value
        for e in blueprint.elements
        if e.font_confidence is not None and e.font_confidence < 0.6
    ]
    if weak:
        print(f"\n  ⚠ weak font match on: {', '.join(weak)}")

    if args.sheet:
        path = build_sheet(creative_id, variants)
        print(f"\nsheet: {path}")


def build_sheet(creative_id: str, variants) -> Path:
    """Before/after contact sheet — the fastest way to eyeball a result."""
    from PIL import Image, ImageDraw, ImageFont

    source = pipeline.load_source(creative_id)
    font_path = str(settings.FONT_DIR / "Montserrat.ttf")
    f_title = ImageFont.truetype(font_path, 44)
    f_label = ImageFont.truetype(font_path, 34)

    width, pad = 2400, 60
    top_h, box_w, box_h = 1100, 700, 1360
    columns = max(1, len(variants))
    row2 = 140 + top_h + 150
    height = row2 + 70 + box_h + 70
    sheet = Image.new("RGB", (width, height), (18, 18, 20))
    draw = ImageDraw.Draw(sheet)

    def fit(img, bw, bh):
        s = min(bw / img.width, bh / img.height)
        return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))),
                          Image.LANCZOS)

    draw.text((pad, 45), f"SOURCE  {source.width} x {source.height}", font=f_title,
              fill=(240, 240, 245))
    scaled = fit(source, width - 2 * pad, top_h)
    sheet.paste(scaled, ((width - scaled.width) // 2, 140))
    draw.text((pad, row2 - 85), "REBUILT", font=f_title, fill=(240, 240, 245))

    gap = (width - 2 * pad - columns * box_w) // max(1, columns - 1) if columns > 1 else 0
    for i, variant in enumerate(variants[:3]):
        x = pad + i * (box_w + gap)
        draw.rectangle([x, row2 + 60, x + box_w, row2 + 60 + box_h], fill=(32, 32, 36))
        img = fit(Image.open(variant.path).convert("RGB"), box_w - 30, box_h - 30)
        sheet.paste(img, (x + (box_w - img.width) // 2, row2 + 60 + (box_h - img.height) // 2))
        draw.text((x, row2 - 10), f"{variant.width} x {variant.height}", font=f_label,
                  fill=(240, 240, 245))
        draw.text((x, row2 + 26), f"{variant.mode}  ({variant.aspect_shift:.2f}x)",
                  font=f_label, fill=(150, 200, 255))

    out = pipeline.creative_dir(creative_id) / "sheet.png"
    sheet.save(out)
    return out


def cmd_check(args) -> None:
    """Run the colour and encode harness. This repo's test suite."""
    from app.video import check, ffmpeg

    # assert_build() had no callers anywhere in the codebase despite its own
    # docstring saying it should fail loudly at startup — the toolchain check
    # this test suite depends on was never actually exercised. require_text
    # stays False: Phase A renders no text, and this dev machine's ffmpeg
    # lacks --enable-libharfbuzz, so requiring it here would fail every run
    # over a build flag Phase A never touches.
    ffmpeg.assert_build()

    results = check.run_all()
    width = max(len(r.name) for r in results)
    for result in results:
        mark = "PASS" if result.passed else "FAIL"
        print(f"  {mark}  {result.name:{width}s}  {result.detail}")
    if not all(r.passed for r in results):
        sys.exit(1)


def cmd_analyse(args) -> None:
    """Analyse a video without rendering anything.

    No upfront Gemini guard here — unlike the image path, this command's own
    ingest step never needs a key. But analyse() DOES call Gemini (it reads
    shots via vision), and without a key blueprint._client() raises
    `blueprint.MissingApiKeyError` rather than degrading cleanly. That's
    foreseeable and common (no key configured yet), so it's caught right
    around the one call that can raise it and turned into a readable message —
    the same "expected condition, not a traceback" treatment cmd_fit_video
    gives a NeedsRebuild target.
    #
    # Deliberately NOT a bare `except RuntimeError` here: `analyse()` also
    # runs `shots.detect` (ffmpeg), and `FfmpegError` subclasses
    # `RuntimeError` — a blanket catch would relabel a genuine decode failure
    # ("ffmpeg timed out...") as a missing-key problem, which is exactly
    # backwards. Catching the dedicated `MissingApiKeyError` type instead
    # means a real `FfmpegError` falls through uncaught here and is handled by
    # main()'s `except (ValueError, FfmpegError)`, which already reports it
    # correctly. Not added to main()'s tuple itself: `MissingApiKeyError`
    # needs this command's own "no key for video" wording, which is specific
    # to `cmd_analyse` (video's other commands never call Gemini).
    """
    from app.video import pipeline as video_pipeline
    from app.video.blueprint import MissingApiKeyError

    creative_id, source, probe_data = video_pipeline.ingest(
        _load(args.video), force=args.force
    )
    try:
        blueprint = video_pipeline.analyse(
            creative_id, source, probe_data, force=args.force
        )
    except MissingApiKeyError as exc:
        # `fit` on a video needs no key at all (render.py never touches a
        # model) — only `analyse` does, so point the operator at the fix.
        sys.exit(f"{exc} Set it in .env — the `fit` command needs no key for video.")
    print(f"creative_id: {creative_id}")
    print(f"artifacts:   {video_pipeline.creative_dir(creative_id)}")
    print(
        f"\nsource: {probe_data.width}x{probe_data.height} {probe_data.fps:g}fps "
        f"{probe_data.duration_seconds:.2f}s"
    )
    print(f"\n{len(blueprint.shots)} shot(s):")
    for shot in blueprint.shots:
        regions = blueprint.regions_in(shot.index)
        print(
            f"  shot {shot.index}: {shot.start_seconds:6.2f}-{shot.end_seconds:6.2f}s "
            f"({shot.duration_seconds:5.2f}s)  {len(regions)} region(s)"
        )
        for region in regions:
            motion = region.motion
            state = "?" if motion is None else (
                "static/recoverable" if motion.pixels_static and motion.background_moves
                else "static/locked" if motion.pixels_static
                else "moving"
            )
            print(
                f"      {region.role:9s} {str(region.erase_box):24s} {state:18s} "
                f"{(region.text or '')[:36]}"
            )
    if blueprint.warnings:
        print("\nwarnings:")
        for warning in blueprint.warnings:
            print(f"  - {warning}")


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser(description="Mark AI creative auto-fit")
    sub = parser.add_subparsers(dest="command", required=True)

    p_bp = sub.add_parser("blueprint", help="analyse only")
    p_bp.add_argument("image", type=Path)
    p_bp.add_argument("--force", action="store_true")
    p_bp.set_defaults(func=cmd_blueprint)

    p_fit = sub.add_parser("fit", help="analyse and render target resolutions")
    p_fit.add_argument("image", type=Path)
    p_fit.add_argument("targets", nargs="+", help="e.g. 1080x2400 1920x1080")
    p_fit.add_argument("--force", action="store_true")
    p_fit.add_argument("--sheet", action="store_true", help="also write a comparison sheet")
    p_fit.add_argument(
        "--slot-seconds", type=float, default=None,
        help="video only: trim reframe/compose targets to fit this DOOH slot exactly "
             "(default: the source's own duration, i.e. no trim)",
    )
    p_fit.set_defaults(func=cmd_fit)

    p_check = sub.add_parser("check", help="colour + encode harness (the test suite)")
    p_check.set_defaults(func=cmd_check)

    p_an = sub.add_parser("analyse", help="segment, read and measure — no rendering")
    p_an.add_argument("video", type=Path)
    p_an.add_argument("--force", action="store_true")
    p_an.set_defaults(func=cmd_analyse)

    args = parser.parse_args()
    # No global Gemini guard here: video jobs never call a model (dispatch
    # happens inside cmd_fit, by file suffix), so a guard at this level would
    # block every video job for a key it will never use. Each image entry
    # point (cmd_blueprint, the image branch of cmd_fit) checks for itself,
    # right where the key is actually needed.
    try:
        args.func(args)
    except (ValueError, FfmpegError) as exc:
        # ValueError covers bad CLI input (targets, limits); FfmpegError
        # covers real ffmpeg/ffprobe failures (zero-byte file, garbage bytes,
        # truncated video, a still image with a .mp4 extension, audio-only
        # input). It subclasses RuntimeError, not ValueError, so it was
        # falling through to an unhandled traceback for a bad UPLOAD — not a
        # bug in our code — which is not what an operator feeding in a bad
        # creative should see.
        sys.exit(str(exc))


if __name__ == "__main__":
    main()
