"""The ffmpeg subprocess boundary.

Everything that touches ffmpeg goes through here. It is a subprocess and not a
library binding on purpose:

* colour handling is explicit and auditable per invocation, which is the whole
  ballgame (see check.py) — a library that defaults to BT.601 on unspecified
  input produces output that is subtly wrong and passes review;
* `-autorotate` and `-fps_mode cfr` come free, so rotation metadata and
  variable-frame-rate sources are normalised at the boundary rather than in
  our code;
* libx264 is GPL. A hosted service is not distribution, but keeping it behind a
  process boundary rather than linking it into our address space is the
  cheaper posture to defend.
"""

from __future__ import annotations

import contextlib
import logging
import shutil
import subprocess
import threading
from collections.abc import Iterator
from functools import lru_cache
from typing import BinaryIO

from app.core.config import settings

logger = logging.getLogger(__name__)


class FfmpegError(RuntimeError):
    """ffmpeg exited non-zero. Carries stderr, which is where the reason is."""


#: Build flags we refuse to start without, and why.
#:
#: libharfbuzz is the one that matters and the one that fails silently: without
#: it ffmpeg's text path does no shaping, so Devanagari and Kannada render as
#: disconnected code points rather than raising. Nobody on the team reads
#: Kannada well enough to catch that in review, so it is asserted at startup.
REQUIRED_BUILD_FLAGS: tuple[str, ...] = ("--enable-libharfbuzz",)

#: Below this, `drawtext` predates the HarfBuzz requirement entirely.
MIN_MAJOR_VERSION = 7

#: `version()`/`buildconf()` are metadata calls, not encodes — they either
#: answer instantly or the binary is broken, so a short hard-coded timeout is
#: correct here and there's nothing for a caller to usefully configure.
_METADATA_TIMEOUT_SECONDS = 10


@lru_cache(maxsize=1)
def binary() -> str:
    path = settings.FFMPEG_BIN or shutil.which("ffmpeg")
    if not path:
        raise FfmpegError("ffmpeg not found. Set FFMPEG_BIN or install it.")
    return path


@lru_cache(maxsize=1)
def probe_binary() -> str:
    path = settings.FFPROBE_BIN or shutil.which("ffprobe")
    if not path:
        raise FfmpegError("ffprobe not found. Set FFPROBE_BIN or install it.")
    return path


@lru_cache(maxsize=1)
def version() -> tuple[int, int]:
    try:
        result = subprocess.run(
            [binary(), "-hide_banner", "-version"],
            capture_output=True, text=True, check=False,
            timeout=_METADATA_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError(
            f"ffmpeg -version did not return within {_METADATA_TIMEOUT_SECONDS}s "
            "— the binary is likely wedged, not slow."
        ) from exc
    # A binary that exists but can't run (bad dylib, permissions) exits
    # non-zero with the real reason in stderr and empty/garbage stdout — that
    # must not fall through to the "could not parse" message below, which
    # would hide the actual cause.
    if result.returncode != 0:
        raise FfmpegError(result.stderr.strip()[:2000])
    out = result.stdout
    # "ffmpeg version 8.1.2 Copyright ..." / "ffmpeg version n7.1-..." / "...-static"
    for token in out.split():
        cleaned = token.lstrip("n")
        parts = cleaned.split(".")
        if parts[0].isdigit():
            minor = parts[1] if len(parts) > 1 and parts[1].isdigit() else "0"
            return int(parts[0]), int(minor)
    raise FfmpegError(f"Could not parse an ffmpeg version from: {out[:120]!r}")


@lru_cache(maxsize=1)
def buildconf() -> str:
    try:
        result = subprocess.run(
            [binary(), "-hide_banner", "-buildconf"],
            capture_output=True, text=True, check=False,
            timeout=_METADATA_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError(
            f"ffmpeg -buildconf did not return within {_METADATA_TIMEOUT_SECONDS}s "
            "— the binary is likely wedged, not slow."
        ) from exc
    if result.returncode != 0:
        raise FfmpegError(result.stderr.strip()[:2000])
    return result.stdout


def assert_build(require_text: bool = False) -> None:
    """Fail loudly at startup rather than silently at render time.

    The version floor always applies. The HarfBuzz build-flag check only
    applies when ``require_text`` is set: Phase A renders no text at all, and
    this dev machine's Homebrew ffmpeg (8.1.2) lacks --enable-libharfbuzz, so
    hard-failing on it unconditionally would block a phase that never touches
    drawtext. A later phase that turns on text rendering passes
    require_text=True and gets the hard fail this was written for.
    """
    major, minor = version()
    if major < MIN_MAJOR_VERSION:
        raise FfmpegError(
            f"ffmpeg {major}.{minor} is too old; need >= {MIN_MAJOR_VERSION}. "
            "Debian's 5.1 predates drawtext's HarfBuzz requirement and would "
            "render Indic scripts as disconnected code points without erroring."
        )
    conf = buildconf()
    missing = [flag for flag in REQUIRED_BUILD_FLAGS if flag not in conf]
    if missing:
        if require_text:
            raise FfmpegError(
                f"ffmpeg is missing {', '.join(missing)}. Indic text would not shape. "
                "Pin a static build that has it."
            )
        logger.warning(
            "ffmpeg is missing %s. Text rendering will need it — deferred "
            "until a later phase turns on require_text.",
            ", ".join(missing),
        )
    else:
        # Only reached when nothing is missing — logging "build OK" right
        # after a WARNING that something IS missing would read as
        # self-contradictory, so the two are now mutually exclusive.
        logger.info("ffmpeg %d.%d at %s — build OK", major, minor, binary())


def run(args: list[str], stdin: bytes | None = None, timeout: int | None = None) -> bytes:
    """Run ffmpeg with ``args`` (without the binary) and return stdout.

    ``timeout`` overrides ``settings.FFMPEG_TIMEOUT_SECONDS`` for this one call —
    the default is the service's 15-minute-per-video budget, past which the
    process is hung rather than slow, so it's killed rather than left to block
    a FastAPI threadpool worker forever.
    """
    command = [binary(), "-nostdin", "-v", "error", *args]
    logger.debug("ffmpeg %s", " ".join(args))
    wait = settings.FFMPEG_TIMEOUT_SECONDS if timeout is None else timeout
    try:
        result = subprocess.run(
            command, input=stdin, capture_output=True, check=False, timeout=wait
        )
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError(
            f"ffmpeg timed out after {wait}s running: {' '.join(args)}"
        ) from exc
    if result.returncode != 0:
        raise FfmpegError(result.stderr.decode("utf-8", "replace").strip()[:2000])
    return result.stdout


def run_probe(args: list[str], timeout: int | None = None) -> str:
    """Run ffprobe with ``args`` (without the binary) and return stdout.

    Same timeout contract as `run()` — see there for why the default is
    `settings.FFMPEG_TIMEOUT_SECONDS` rather than unbounded.
    """
    command = [probe_binary(), "-v", "error", *args]
    wait = settings.FFMPEG_TIMEOUT_SECONDS if timeout is None else timeout
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, check=False, timeout=wait
        )
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError(
            f"ffprobe timed out after {wait}s running: {' '.join(args)}"
        ) from exc
    if result.returncode != 0:
        raise FfmpegError(result.stderr.strip()[:2000])
    return result.stdout


# --- Streaming frame I/O -----------------------------------------------------
#
# `run()` is `subprocess.run(capture_output=True)`: correct for the metadata
# and short-clip calls above, but it buffers the ENTIRE child output in memory
# before returning a single byte to the caller. Decoding one clip's worth of
# frames at native resolution for erase (600 frames x 1080p RGB24) is 3.7 GB
# buffered that way — it does not fit, and it does not need to: the erase
# pass only ever needs one frame in memory at a time. `stream_frames` and
# `frame_sink` are Popen-based generators/context managers that hand the
# caller one frame at a time instead, so peak memory is one frame's bytes,
# not the clip's.
#
# Both share two helpers below rather than duplicating the pipe-draining and
# timeout logic twice.


def _drain_pipe(pipe: BinaryIO, chunks: list[bytes]) -> None:
    """Background-thread target: read `pipe` to EOF, appending chunks as they arrive.

    This is the deadlock fix, and it is required in BOTH streaming functions
    below, not just one. `stream_frames` reads ffmpeg's stdout (frames) while
    ffmpeg writes decode diagnostics to stderr; `frame_sink` writes ffmpeg's
    stdin (frames) while ffmpeg writes encode diagnostics to stderr. In either
    direction, stderr is a pipe with a small, fixed OS buffer (~64 KiB). If
    ffmpeg fills it and nobody is reading, its next write to stderr blocks —
    and since we are simultaneously blocked reading stdout (or writing stdin)
    waiting on THAT SAME child process, neither side can make progress: a
    classic two-pipe deadlock, and one that only shows up on a chatty/erroring
    run, not on the happy path, which is exactly the kind of bug that survives
    to production. Running stderr collection on its own thread means it is
    always being drained concurrently with whatever the main thread is doing,
    so the child can never be stalled on a stderr write.
    """
    for chunk in iter(lambda: pipe.read(65536), b""):
        chunks.append(chunk)


def _watch_timeout(
    process: subprocess.Popen, wait: float, finished: threading.Event, timed_out: threading.Event
) -> None:
    """Background-thread target: kill `process` if `finished` isn't set within `wait`s.

    `subprocess.run(..., timeout=...)` (used by `run`/`run_probe` above) can
    enforce a timeout because it owns the whole blocking call. A generator
    that yields control back to the caller between frames can't do that the
    same way — a plain `read()`/`write()` on a pipe has no timeout parameter —
    so the same "hung, not slow, kill it" contract is reproduced with a
    watchdog thread instead. It only fires if the CHILD itself never finishes;
    a caller that takes a long time processing one frame between reads is not
    ffmpeg's fault and is not timed out here.
    """
    if not finished.wait(wait):
        timed_out.set()
        process.kill()


def stream_frames(
    args: list[str], frame_bytes: int, timeout: int | None = None
) -> Iterator[bytes]:
    """Stream raw frames from an ffmpeg decode, yielding exactly `frame_bytes` at a time.

    `args` must end in something like `-f rawvideo -pix_fmt rgb24 -` so ffmpeg
    writes raw frames to stdout with no container framing to parse — `frame_bytes`
    (typically width*height*3 for rgb24) is then the exact stride between frames.

    Same `-nostdin -v error` prefix and the same `settings.FFMPEG_TIMEOUT_SECONDS`
    (overridable per call) as `run()`. A caller only ever needs to catch
    `FfmpegError` — no raw `subprocess`/`OSError` escapes:

    * a short final chunk (ffmpeg exited mid-frame) is never yielded — a
      partial frame handed to a caller expecting a fixed stride would silently
      corrupt every subsequent frame's alignment, so this raises instead;
    * a non-zero exit raises `FfmpegError` carrying stderr;
    * a hung child raises `FfmpegError` via the watchdog above.

    If the caller stops iterating early (breaks out of the loop, or the
    generator is otherwise closed/GC'd before EOF), the `finally` below still
    kills the child and joins both helper threads, but no error is raised —
    stopping early is a caller choice, not a failure.
    """
    command = [binary(), "-nostdin", "-v", "error", *args]
    logger.debug("ffmpeg (stream) %s", " ".join(args))
    wait = settings.FFMPEG_TIMEOUT_SECONDS if timeout is None else timeout

    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    assert process.stderr is not None

    stderr_chunks: list[bytes] = []
    drain_thread = threading.Thread(
        target=_drain_pipe, args=(process.stderr, stderr_chunks), daemon=True
    )
    drain_thread.start()

    finished = threading.Event()
    timed_out = threading.Event()
    watchdog_thread = threading.Thread(
        target=_watch_timeout, args=(process, wait, finished, timed_out), daemon=True
    )
    watchdog_thread.start()

    # -1 means "the loop below never hit a short read"; any other value is
    # the byte count of the truncated final chunk, checked (and raised on)
    # only AFTER the process/threads are reaped in `finally`, so the error
    # message can include real stderr rather than an empty buffer.
    truncated_bytes = -1
    try:
        while True:
            chunk = process.stdout.read(frame_bytes)
            if not chunk:
                break  # clean EOF exactly on a frame boundary
            if len(chunk) < frame_bytes:
                truncated_bytes = len(chunk)
                break
            yield chunk
    finally:
        if process.poll() is None:
            process.kill()
        returncode = process.wait()
        finished.set()
        watchdog_thread.join()
        drain_thread.join()

    # Only reached when the loop above ended itself (clean EOF or a truncated
    # read) — an exception propagating out of the caller's `yield` (including
    # GeneratorExit from an early `break`/close) skips straight past this and
    # re-raises unchanged, per the "stopping early is not a failure" contract
    # documented above.
    stderr = b"".join(stderr_chunks).decode("utf-8", "replace").strip()
    if timed_out.is_set():
        raise FfmpegError(f"ffmpeg (stream) timed out after {wait}s running: {' '.join(args)}")
    if returncode != 0:
        raise FfmpegError(stderr[:2000])
    if truncated_bytes >= 0:
        raise FfmpegError(
            f"ffmpeg exited cleanly (code 0) but the frame stream ended mid-frame "
            f"({truncated_bytes}/{frame_bytes} bytes on the final read) — a partial "
            f"frame is never yielded. stderr: {stderr[:1500] if stderr else '(empty)'}"
        )


@contextlib.contextmanager
def frame_sink(args: list[str], timeout: int | None = None) -> Iterator[BinaryIO]:
    """Context manager giving writable stdin to an ffmpeg encode, one frame at a time.

    `args` must contain an input reading raw frames from stdin (`-f rawvideo
    -pix_fmt ... -s WxH -r FPS -i -`) and end in the real output path — the
    encoded file is written directly by ffmpeg, never captured through this
    module, so nothing here buffers the clip either.

    Same `-nostdin -v error` prefix and timeout contract as `run()`/
    `stream_frames()` above. On exit — however the `with` block ends — stdin is
    closed (so ffmpeg sees EOF and can flush/finalise) and the process is
    waited on. If the block completed normally, a non-zero exit (or a timeout)
    then raises `FfmpegError` carrying stderr, same contract as everywhere else
    in this module. If the block raised its own exception, that exception wins
    and propagates unchanged — an unrelated ffmpeg exit code must not mask a
    real bug in the caller's frame-writing loop.
    """
    command = [binary(), "-nostdin", "-v", "error", *args]
    logger.debug("ffmpeg (sink) %s", " ".join(args))
    wait = settings.FFMPEG_TIMEOUT_SECONDS if timeout is None else timeout

    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None
    assert process.stderr is not None

    stderr_chunks: list[bytes] = []
    drain_thread = threading.Thread(
        target=_drain_pipe, args=(process.stderr, stderr_chunks), daemon=True
    )
    drain_thread.start()

    finished = threading.Event()
    timed_out = threading.Event()
    watchdog_thread = threading.Thread(
        target=_watch_timeout, args=(process, wait, finished, timed_out), daemon=True
    )
    watchdog_thread.start()

    try:
        yield process.stdin
    except BrokenPipeError:
        # The child closed its read end from under us — almost always because
        # it already died on a bad argument before we finished writing. The
        # real reason lives in stderr, not in this OS-level symptom, so it is
        # swallowed here and left to the exit-code check below to report.
        pass
    finally:
        try:
            process.stdin.close()
        except OSError:
            pass  # already broken; the exit-code check below has the real story
        returncode = process.wait()
        finished.set()
        watchdog_thread.join()
        drain_thread.join()

    stderr = b"".join(stderr_chunks).decode("utf-8", "replace").strip()
    if timed_out.is_set():
        raise FfmpegError(f"ffmpeg (sink) timed out after {wait}s running: {' '.join(args)}")
    if returncode != 0:
        raise FfmpegError(stderr[:2000])
