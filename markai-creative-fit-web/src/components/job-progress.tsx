"use client";

import { useEffect, useRef, useState } from "react";

import type { VideoFitResult, VideoJobStatus } from "@/lib/video-types";

type StepStatus = "queued" | "current" | "done";

interface StepRecord {
  target: string;
  status: StepStatus;
  /** Wall-clock ms this client actually observed the transition — a real
   * measured duration, never a value recomputed from the server's own
   * percent/eta. */
  startedAt: number | null;
  finishedAt: number | null;
  /** What actually happened to this target, filled in once the job's
   * result names it — a rendered mode, or a refusal's reason. Never
   * guessed ahead of the server saying so. */
  finding: string | null;
}

interface Props {
  /** The targets this job was submitted for, in request order — the only
   * thing this component knows ahead of the server, since the job itself
   * carries no per-target breakdown until it's done. */
  targets: string[];
  job: VideoJobStatus | null;
  /** When THIS client started watching this job (Date.now() at submit). */
  startedAt: number;
}

/**
 * A growing receipt, not a spinner — the image flow's spinner reads as hung
 * past 400s (phase C/D/E plan, Task 10). `percent` and `eta_seconds` are
 * read straight off the job and rendered as-is: they are already monotonic
 * server-side (see app/api/jobs.py::Progress.update), so this component
 * never recomputes or smooths them. The only client-side arithmetic here is
 * "when did I last see this step change" — a receipt of what was actually
 * observed, not a forecast.
 */
export function JobProgress({ targets, job, startedAt }: Props) {
  const stepsRef = useRef<StepRecord[]>(
    targets.map((t) => ({ target: t, status: "queued", startedAt: null, finishedAt: null, finding: null })),
  );
  const [, bump] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Re-key the receipt whenever the target list changes (a fresh job).
  useEffect(() => {
    stepsRef.current = targets.map((t) => ({
      target: t,
      status: "queued",
      startedAt: null,
      finishedAt: null,
      finding: null,
    }));
    bump((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.join(",")]);

  // Tick the "elapsed" clock while a job is in flight — display only, does
  // not touch percent/eta.
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error" || job.status === "cancelled") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job]);

  useEffect(() => {
    if (!job) return;
    const total = targets.length;
    const doneCount = total > 0 ? Math.min(total, Math.round((job.percent / 100) * total)) : 0;
    const steps = stepsRef.current;
    const at = Date.now();

    steps.forEach((step, i) => {
      if (i < doneCount && step.status !== "done") {
        step.status = "done";
        if (step.startedAt === null) step.startedAt = at;
        step.finishedAt = at;
      } else if (i === doneCount && job.status === "running" && step.status === "queued") {
        step.status = "current";
        step.startedAt = at;
      }
    });

    // Once the job is done, the result names what actually happened to each
    // target — enrich the receipt with real findings, not guesses.
    if (job.status === "done" && job.result) {
      const result = job.result as VideoFitResult;
      steps.forEach((step) => {
        const v = result.variants?.find((x) => `${x.width}x${x.height}` === step.target);
        const r = result.refusals?.find((x) => `${x.width}x${x.height}` === step.target);
        step.status = "done";
        if (step.startedAt === null) step.startedAt = at;
        if (step.finishedAt === null) step.finishedAt = at;
        step.finding = v ? `rendered · ${v.mode}` : r ? "not yet — needs a rebuild" : step.finding;
      });
    }

    bump((n) => n + 1);
  }, [job, targets.length]);

  if (!job) return null;

  const percent = Math.max(0, Math.min(100, job.percent));
  const elapsed = Math.max(0, (now - startedAt) / 1000);

  const statusLine =
    job.status === "queued"
      ? "Queued…"
      : job.status === "running"
        ? "Fitting the video…"
        : job.status === "done"
          ? "Done."
          : job.status === "cancelled"
            ? "Cancelled."
            : "Something went wrong.";

  return (
    <div className="mt-4 rounded-[10px] border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-[13px] text-fg">{statusLine}</span>
        <span className="dim text-[11px] text-fg-subtle">
          {elapsed.toFixed(0)}s elapsed
          {job.status === "running" && job.eta_seconds !== null
            ? ` · ~${job.eta_seconds.toFixed(0)}s left`
            : ""}
        </span>
      </div>

      {/* The bar's width is percent, straight off the job — never recomputed. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas-subtle">
        <div
          className="h-full rounded-full bg-teal transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {stepsRef.current.map((step) => (
          <li key={step.target} className="flex items-center justify-between gap-3 text-[12px]">
            <span className={step.status === "queued" ? "text-fg-subtle" : "text-fg"}>
              {step.target}
              {step.status === "current" && " — fitting…"}
            </span>
            <span className="dim text-fg-subtle">
              {step.status === "done"
                ? (step.finding ??
                  (step.startedAt !== null && step.finishedAt !== null
                    ? `${Math.max(0, (step.finishedAt - step.startedAt) / 1000).toFixed(0)}s`
                    : "done"))
                : step.status === "current"
                  ? "in progress"
                  : "queued"}
            </span>
          </li>
        ))}
      </ul>

      {job.error && <p className="mt-3 text-[12px] text-danger">{job.error}</p>}
    </div>
  );
}
