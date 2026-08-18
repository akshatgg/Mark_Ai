"""In-process registry for long-running video work (fit / analyse).

**State lives only in this process's memory.** A dict, one lock, and a
single-worker `ThreadPoolExecutor` -- there is no database, no queue, no
persistence layer behind any of it. Two consequences follow directly and are
recorded here rather than discovered the hard way:

  * A process restart loses every job, in flight or finished. There is no
    recovery; the caller must re-submit.
  * Finished jobs (done / error / cancelled) are swept out `JOB_TTL_SECONDS`
    (1 hour) after their last update, so a client that waits longer than that
    to poll gets a 404, not a stale result kept forever.

This is the right scope for a local single-process service. A real deployment
running more than one worker process would need a durable store (a table,
Redis) behind this same interface before any of the above could change.

**Why a dedicated executor at all.** The image router's handlers run in
FastAPI's own default threadpool. A ten-minute video render must never be
able to starve that pool and stall an unrelated image request -- so every
video job runs on ONE separate worker thread (`max_workers=1`), never on
FastAPI's pool. One worker also means video jobs are naturally serialised,
which keeps "running" an unambiguous state for this simple registry.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

#: Finished jobs are forgotten this long after their last update. See the
#: module docstring -- there is no persistence layer behind this number.
JOB_TTL_SECONDS = 60 * 60


class JobStatus:
    """Greppable string states, matching this codebase's own preference for a
    plain-string class over an Enum for a small closed vocabulary (see
    `app.video.schemas.FitMode` / `EraseBranch`)."""

    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = {JobStatus.DONE, JobStatus.ERROR, JobStatus.CANCELLED}


class Cancelled(RuntimeError):
    """Raised by a job's work function after it notices `Progress.cancelled()`,
    to unwind cleanly. The registry's runner catches this one specifically and
    records `JobStatus.CANCELLED` rather than `JobStatus.ERROR`."""


@dataclass
class Job:
    """One video job's live state.

    Every mutable field is read and written under `lock` -- a route handler
    (polling `GET /jobs/{id}`) and the worker thread (running the job) touch
    the same object from two different threads.
    """

    id: str
    kind: str  # "fit" | "analyse"
    creative_id: str
    status: str = JobStatus.QUEUED
    percent: float = 0.0
    eta_seconds: float | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    result: dict[str, Any] | None = None
    error: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)
    future: Future | None = field(default=None, repr=False)


class Progress:
    """Handed to a job's work function so it can report how far along it is.

    `update()` clamps both `percent` and `eta_seconds` with `max()` against
    whatever was last recorded, so neither field is ever allowed to regress
    mid-job: a progress bar (or a countdown) that visibly moves backward reads
    as more broken than one that briefly holds still. The trade-off is real
    and left visible rather than hidden -- once the slowest target so far has
    pushed the ETA up, it will not fall again until the job finishes.
    """

    def __init__(self, job: Job) -> None:
        self._job = job

    def update(self, percent: float, eta_seconds: float | None) -> None:
        job = self._job
        with job.lock:
            job.percent = max(job.percent, min(100.0, max(0.0, percent)))
            if eta_seconds is not None:
                job.eta_seconds = (
                    eta_seconds if job.eta_seconds is None else max(job.eta_seconds, eta_seconds)
                )
            job.updated_at = time.time()

    def cancelled(self) -> bool:
        return self._job.cancel_event.is_set()


class JobRegistry:
    """Every video job this process currently knows about. See the module
    docstring for the two deliberate limits (memory-only, 1h TTL)."""

    def __init__(self, max_workers: int = 1) -> None:
        self._jobs: dict[str, Job] = {}
        self._registry_lock = threading.Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="video-job"
        )

    def submit(
        self, kind: str, creative_id: str, work: Callable[[Job, Progress], dict[str, Any]]
    ) -> Job:
        """Register a new job and hand it to the single video worker thread.

        `work` receives the `Job` (read-only, in practice) and a `Progress`
        handle to report through, and must return the JSON-safe dict that
        becomes `Job.result` on success.
        """
        job = Job(id=uuid.uuid4().hex, kind=kind, creative_id=creative_id)
        with self._registry_lock:
            self._jobs[job.id] = job
        job.future = self._executor.submit(self._run, job, work)
        return job

    def get(self, job_id: str) -> Job | None:
        self._sweep()
        with self._registry_lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        """Flip the job's cancel flag. Does not block for the worker to
        notice -- a fit job checks it between targets, an analyse job checks
        it once before its single (uninterruptible) call starts. The caller
        should poll the job to see the cancellation actually land."""
        with self._registry_lock:
            job = self._jobs.get(job_id)
        if job is None:
            return None
        job.cancel_event.set()
        return job

    def _run(self, job: Job, work: Callable[[Job, Progress], dict[str, Any]]) -> None:
        with job.lock:
            job.status = JobStatus.RUNNING
            job.updated_at = time.time()
        progress = Progress(job)
        try:
            result = work(job, progress)
        except Cancelled:
            logger.info("video job %s (%s) cancelled", job.id, job.kind)
            with job.lock:
                job.status = JobStatus.CANCELLED
                job.updated_at = time.time()
            return
        except Exception as exc:  # noqa: BLE001 -- surfaced on the job, never crashes the worker
            logger.exception("video job %s (%s) failed", job.id, job.kind)
            with job.lock:
                job.status = JobStatus.ERROR
                job.error = str(exc)
                job.updated_at = time.time()
            return
        with job.lock:
            job.status = JobStatus.DONE
            job.percent = 100.0
            job.result = result
            job.updated_at = time.time()

    def _sweep(self) -> None:
        now = time.time()
        with self._registry_lock:
            expired = [
                job_id
                for job_id, job in self._jobs.items()
                if job.status in TERMINAL_STATUSES and now - job.updated_at > JOB_TTL_SECONDS
            ]
            for job_id in expired:
                del self._jobs[job_id]


#: One process-wide registry, imported by video_router.py. Matches the rest
#: of this codebase's module-level singleton pattern (e.g. `app.core.config.
#: settings`) rather than FastAPI dependency injection -- there is exactly
#: one of these per process.
registry = JobRegistry()
