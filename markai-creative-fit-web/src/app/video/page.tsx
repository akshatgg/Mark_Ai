"use client";

import { useEffect, useMemo, useState } from "react";

import { FitModeToggle } from "@/components/fit-mode-toggle";
import { JobProgress } from "@/components/job-progress";
import { VideoDrop } from "@/components/video-drop";
import { VideoRack } from "@/components/video-rack";
import { VideoApiError, fitVideo, getVideoJob, ingestVideo } from "@/lib/video-api";
import { PRESETS, targetOf, type ScreenSpec } from "@/lib/video-screens";
import type {
  VideoFitResult,
  VideoJobState,
  VideoJobStatus,
  VideoRefusal,
  VideoVariant,
} from "@/lib/video-types";

/**
 * The video workbench. Structurally mirrors src/app/page.tsx (the image
 * workbench) on purpose — same two-column layout, same fit/reset flow — but
 * is its own file, not a mode branch inside that one. See CLAUDE.md and the
 * phase C/D/E plan's Task 10: the toggle is a route so the tested image page
 * never has to carry a video branch.
 *
 * The one structural difference the video API forces: ingest (upload) and
 * fit (render) are two separate calls, and fit runs as a polled job rather
 * than a single synchronous response — a ten-minute encode can't be a
 * blocking fetch. `pollJob` is the only place that reflects that.
 */
export default function VideoPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [creativeId, setCreativeId] = useState<string | null>(null);

  const [screens, setScreens] = useState<ScreenSpec[]>(PRESETS);
  const [selected, setSelected] = useState<Set<string>>(new Set(["1080x2400", "1920x1080"]));

  const [result, setResult] = useState<VideoFitResult | null>(null);
  const [variants, setVariants] = useState<Map<string, VideoVariant>>(new Map());
  const [refusals, setRefusals] = useState<Map<string, VideoRefusal>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [job, setJob] = useState<VideoJobStatus | null>(null);
  const [jobStartedAt, setJobStartedAt] = useState(0);
  const [activeTargets, setActiveTargets] = useState<string[]>([]);

  // Object URLs leak unless revoked when replaced. Only ours are object URLs —
  // a restored preview never sets one (there is nothing to point it at without
  // re-downloading the source, which this workbench doesn't do).
  useEffect(
    () => () => {
      if (file && previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [file, previewUrl],
  );

  // A fitted creative is shareable: ?creative=<id>&screens=1080x2400,1920x1080.
  // Unlike the image path there is no single "render more" GET — restoring
  // means resubmitting the same fit job, which hits the on-disk variant
  // cache in app/video/pipeline.py and comes back fast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = params.get("creative");
    if (!cid) return;

    const targets = (params.get("screens") ?? "1080x2400,1920x1080")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    setCreativeId(cid);
    setScreens((prev) => {
      const known = new Set(prev.map((s) => s.id));
      const extra = targets
        .filter((t) => !known.has(t))
        .map((t) => {
          const [w, h] = t.split("x").map(Number);
          return { id: t, width: w, height: h, label: "Shared screen" };
        });
      return [...prev, ...extra];
    });
    setSelected(new Set(targets));
    setBusy(true);
    setError(null);

    (async () => {
      try {
        const accepted = await fitVideo(cid, targets);
        const start = Date.now();
        setActiveTargets(targets);
        setJobStartedAt(start);
        setJob({
          job_id: accepted.job_id,
          kind: "fit",
          status: (accepted.status as VideoJobState) ?? "queued",
          percent: 0,
          eta_seconds: null,
          created_at: start / 1000,
          updated_at: start / 1000,
          error: null,
          result: null,
        });
        await pollJob(accepted.job_id);
      } catch (err) {
        setError(
          err instanceof VideoApiError ? err.message : "That shared link could not be opened.",
        );
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The shareable link tracks whatever has actually rendered — mirrors the
  // image page's history.replaceState, just driven by state instead of
  // being inlined into fit() (fit() here can finish long after the click).
  useEffect(() => {
    if (!result) return;
    const q = new URLSearchParams({
      creative: result.creative_id,
      screens: [...variants.keys()].join(","),
    });
    window.history.replaceState(null, "", `?${q}`);
  }, [result, variants]);

  function reset() {
    if (file && previewUrl) URL.revokeObjectURL(previewUrl);
    setResult(null);
    setVariants(new Map());
    setRefusals(new Map());
    setSourceSize(null);
    setSourceDuration(null);
    setError(null);
    setJob(null);
    setActiveTargets([]);
    window.history.replaceState(null, "", window.location.pathname);
  }

  function pick(picked: File) {
    reset();
    setCreativeId(null);
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  }

  function clear() {
    reset();
    setCreativeId(null);
    setFile(null);
    setPreviewUrl(null);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedSpecs = useMemo(
    () => screens.filter((s) => selected.has(s.id)),
    [screens, selected],
  );

  const pending = useMemo(
    () =>
      selectedSpecs.filter((s) => !variants.has(targetOf(s)) && !refusals.has(targetOf(s))),
    [selectedSpecs, variants, refusals],
  );

  /** Poll a job's status with backoff 2s -> 5s -> 10s, skipping entirely
   * while the tab is hidden. percent/eta_seconds are read straight off each
   * response and handed to JobProgress unmodified. */
  async function pollJob(jobId: string) {
    const delays = [2000, 5000, 10000];
    let i = 0;
    for (;;) {
      if (document.visibilityState !== "hidden") {
        let status: VideoJobStatus;
        try {
          status = await getVideoJob(jobId);
        } catch (err) {
          setError(err instanceof VideoApiError ? err.message : "Lost contact with the job.");
          setBusy(false);
          return;
        }
        setJob(status);

        if (status.status === "done" || status.status === "error" || status.status === "cancelled") {
          if (status.status === "done" && status.result) {
            const r = status.result as VideoFitResult;
            setResult(r);
            setVariants((prev) => {
              const next = new Map(prev);
              r.variants.forEach((v) => next.set(`${v.width}x${v.height}`, v));
              return next;
            });
            setRefusals((prev) => {
              const next = new Map(prev);
              r.refusals.forEach((rf) => next.set(`${rf.width}x${rf.height}`, rf));
              return next;
            });
            setSourceSize({ width: r.probe.width, height: r.probe.height });
            setSourceDuration(r.probe.duration_seconds);
          } else if (status.status === "error") {
            setError(status.error ?? "The video job failed.");
          }
          setBusy(false);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delays[Math.min(i, delays.length - 1)]));
      i++;
    }
  }

  async function fit() {
    if ((!file && !result && !creativeId) || pending.length === 0) return;
    setBusy(true);
    setError(null);
    const targetList = pending.map(targetOf);

    try {
      let cid = creativeId;
      if (!cid) {
        if (!file) {
          setBusy(false);
          return;
        }
        const ingested = await ingestVideo(file);
        cid = ingested.creative_id;
        setCreativeId(cid);
        setSourceSize({ width: ingested.probe.width, height: ingested.probe.height });
        setSourceDuration(ingested.probe.duration_seconds);
      }

      const accepted = await fitVideo(cid, targetList);
      const start = Date.now();
      setActiveTargets(targetList);
      setJobStartedAt(start);
      setJob({
        job_id: accepted.job_id,
        kind: "fit",
        status: (accepted.status as VideoJobState) ?? "queued",
        percent: 0,
        eta_seconds: null,
        created_at: start / 1000,
        updated_at: start / 1000,
        error: null,
        result: null,
      });
      await pollJob(accepted.job_id);
    } catch (err) {
      setError(err instanceof VideoApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  const busyIds = useMemo(
    () => (busy ? new Set(pending.map((s) => s.id)) : new Set<string>()),
    [busy, pending],
  );

  const notYet = result?.refusals.length ?? 0;

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-12 md:px-10 md:py-16">
      <header>
        <FitModeToggle current="video" />
        <p className="eyebrow">Mark AI · Creative Fit — Video</p>
        <h1 className="mt-3 max-w-[19ch] font-[family-name:var(--font-space-grotesk)] text-[34px] font-medium leading-[1.12] tracking-[-0.02em] text-fg md:text-[46px]">
          One ad. Every screen it has to play on.
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-fg-muted">
          Drop a finished video ad and pick the screens. A near-identical shape resizes or
          crops in one pass; a much narrower or wider panel needs a reframe or compose
          rebuild — not rendered yet, so those screens show a not-yet state instead of
          spending minutes to fail.
        </p>
        <div className="hero-rule mt-8 w-[104px]" />
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[400px_1fr] lg:gap-16">
        <section>
          <h2 className="eyebrow mb-4">The creative</h2>
          <VideoDrop
            previewUrl={previewUrl}
            name={file?.name ?? (result ? "Shared creative" : null)}
            caption={
              sourceSize
                ? `${sourceSize.width}×${sourceSize.height}` +
                  (sourceDuration ? ` · ${sourceDuration.toFixed(1)}s` : "") +
                  (file ? ` · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "")
                : null
            }
            onPick={pick}
            onClear={clear}
            onMeta={({ width, height, duration }) => {
              // Only trusted before anything server-side has spoken — once a
              // probe or job result has reported real dimensions, those win.
              if (!sourceSize) setSourceSize({ width, height });
              if (!sourceDuration) setSourceDuration(duration);
            }}
            disabled={busy}
          />
        </section>

        <section>
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="eyebrow">The screens</h2>
            <span className="dim text-[11px] text-fg-subtle">{selected.size} selected</span>
          </div>

          <VideoRack
            screens={screens}
            selected={selected}
            onToggle={toggle}
            onAdd={(spec) => {
              setScreens((prev) => [...prev, spec]);
              setSelected((prev) => new Set(prev).add(spec.id));
            }}
            onRemove={(id) => {
              setScreens((prev) => prev.filter((s) => s.id !== id));
              setSelected((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }}
            variants={variants}
            refusals={refusals}
            source={sourceSize}
            busyIds={busyIds}
          />
        </section>
      </div>

      <div className="mt-14 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-8">
        <button
          type="button"
          onClick={fit}
          disabled={(!file && !result && !creativeId) || pending.length === 0 || busy}
          className="cursor-pointer rounded-[8px] bg-teal px-5 py-2.5 text-[14px] font-medium text-[#04231f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy
            ? "Fitting…"
            : pending.length === 0 && selected.size > 0 && result
              ? "All selected screens fitted"
              : `Fit to ${pending.length || selected.size} screen${(pending.length || selected.size) === 1 ? "" : "s"}`}
        </button>

        {!file && !result && !creativeId && (
          <span className="text-[13px] text-fg-subtle">Drop a video to start.</span>
        )}

        {result && !busy && (
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
            className="cursor-pointer rounded-[8px] border border-line-strong px-3.5 py-2 text-[13px] text-fg-muted transition-colors hover:border-teal hover:text-fg"
          >
            Copy link to this result
          </button>
        )}

        {result && !busy && (
          <span className="text-[13px] text-fg-muted">
            {notYet > 0
              ? `${notYet} screen${notYet === 1 ? "" : "s"} need${notYet === 1 ? "s" : ""} a reframe or compose rebuild — not rendered yet.`
              : "Every selected screen was close enough in shape to fit directly."}
          </span>
        )}
      </div>

      {busy && job && <JobProgress targets={activeTargets} job={job} startedAt={jobStartedAt} />}

      {error && (
        <p className="mt-4 max-w-[70ch] rounded-[8px] border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] leading-relaxed text-danger">
          {error}
        </p>
      )}
    </main>
  );
}
