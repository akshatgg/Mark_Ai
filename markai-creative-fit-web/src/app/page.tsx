"use client";

import { useEffect, useMemo, useState } from "react";

import { BlueprintReadout } from "@/components/blueprint-readout";
import { CreativeDrop } from "@/components/creative-drop";
import { FitModeToggle } from "@/components/fit-mode-toggle";
import { ScreenRack } from "@/components/screen-rack";
import { ApiError, fitCreative, renderMore } from "@/lib/api";
import { PRESETS, targetOf, type ScreenSpec } from "@/lib/screens";
import type { FitResponse, Variant } from "@/lib/types";

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);

  const [screens, setScreens] = useState<ScreenSpec[]>(PRESETS);
  // The two shapes actually in the fleet are on by default.
  const [selected, setSelected] = useState<Set<string>>(new Set(["1080x2400", "1920x1080"]));

  const [result, setResult] = useState<FitResponse | null>(null);
  const [variants, setVariants] = useState<Map<string, Variant>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the creative's real pixel size so the rack can forecast each screen.
  useEffect(() => {
    if (!file || !previewUrl) return;
    const img = new Image();
    img.onload = () => setSourceSize({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = previewUrl;
  }, [file, previewUrl]);

  // Object URLs leak unless revoked when replaced. Only ours are object URLs —
  // a restored preview is a plain API path.
  useEffect(
    () => () => {
      if (file && previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [file, previewUrl],
  );

  // A fitted creative is shareable: ?creative=<id>&screens=1080x2400,1920x1080
  // rebuilds the whole view from the service, no re-upload. The analysis is
  // already cached server-side, so this costs a render and nothing else.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const creativeId = params.get("creative");
    if (!creativeId) return;

    const targets = (params.get("screens") ?? "1080x2400,1920x1080")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    setBusy(true);
    renderMore(creativeId, targets)
      .then((res) => {
        setResult(res);
        setVariants(new Map(res.variants.map((v) => [`${v.width}x${v.height}`, v])));
        setSourceSize({ width: res.source_width, height: res.source_height });
        setPreviewUrl(`/api/fit/${creativeId}/file/source.png`);
        setScreens((prev) => {
          const known = new Set(prev.map((s) => s.id));
          const extra = res.variants
            .filter((v) => !known.has(`${v.width}x${v.height}`))
            .map((v) => ({
              id: `${v.width}x${v.height}`,
              width: v.width,
              height: v.height,
              label: "Shared screen",
            }));
          return [...prev, ...extra];
        });
        setSelected(new Set(res.variants.map((v) => `${v.width}x${v.height}`)));
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "That shared link could not be opened."),
      )
      .finally(() => setBusy(false));
  }, []);

  function reset() {
    if (file && previewUrl) URL.revokeObjectURL(previewUrl);
    setResult(null);
    setVariants(new Map());
    setSourceSize(null);
    setError(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  function pick(picked: File) {
    reset();
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  }

  function clear() {
    reset();
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
    () => selectedSpecs.filter((s) => !variants.has(targetOf(s))),
    [selectedSpecs, variants],
  );

  async function fit() {
    if ((!file && !result) || pending.length === 0) return;
    setBusy(true);
    setError(null);
    const targets = pending.map(targetOf);
    try {
      // Once a creative is analysed, extra screens are a render — no model calls.
      const res =
        result || !file
          ? await renderMore(result!.creative_id, targets)
          : await fitCreative(file, targets);

      const merged = new Map(variants);
      res.variants.forEach((v) => merged.set(`${v.width}x${v.height}`, v));
      setResult(res);
      setVariants(merged);

      // Make the result addressable so it can be handed to someone else.
      const q = new URLSearchParams({
        creative: res.creative_id,
        screens: [...merged.keys()].join(","),
      });
      window.history.replaceState(null, "", `?${q}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const busyIds = useMemo(
    () => (busy ? new Set(pending.map((s) => s.id)) : new Set<string>()),
    [busy, pending],
  );

  const rebuilt = result?.variants.filter((v) => v.mode === "relayout").length ?? 0;

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-12 md:px-10 md:py-16">
      <header>
        <FitModeToggle current="image" />
        <p className="eyebrow">Mark AI · Creative Fit</p>
        <h1 className="mt-3 max-w-[19ch] font-[family-name:var(--font-space-grotesk)] text-[34px] font-medium leading-[1.12] tracking-[-0.02em] text-fg md:text-[46px]">
          One ad. Every screen it has to play on.
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-fg-muted">
          Scale a 4000-pixel banner down to a café panel and the headline lands at 76 pixels —
          unreadable from three metres. Drop the finished ad below and pick the screens; anything
          too far off shape gets taken apart and rebuilt instead of squashed.
        </p>
        <div className="hero-rule mt-8 w-[104px]" />
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[400px_1fr] lg:gap-16">
        <section>
          <h2 className="eyebrow mb-4">The creative</h2>
          <CreativeDrop
            previewUrl={previewUrl}
            name={file?.name ?? (result ? "Shared creative" : null)}
            caption={
              sourceSize
                ? `${sourceSize.width}×${sourceSize.height}${
                    file ? ` · ${(file.size / 1024).toFixed(0)} KB` : ""
                  }`
                : null
            }
            onPick={pick}
            onClear={clear}
            disabled={busy}
          />
        </section>

        <section>
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="eyebrow">The screens</h2>
            <span className="dim text-[11px] text-fg-subtle">
              {selected.size} selected
            </span>
          </div>

          <ScreenRack
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
            source={sourceSize}
            busyIds={busyIds}
          />
        </section>
      </div>

      <div className="mt-14 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-8">
        <button
          type="button"
          onClick={fit}
          disabled={(!file && !result) || pending.length === 0 || busy}
          className="cursor-pointer rounded-[8px] bg-teal px-5 py-2.5 text-[14px] font-medium text-[#04231f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy
            ? "Fitting…"
            : pending.length === 0 && selected.size > 0 && result
              ? "All selected screens fitted"
              : `Fit to ${pending.length || selected.size} screen${(pending.length || selected.size) === 1 ? "" : "s"}`}
        </button>

        {!file && !result && (
          <span className="text-[13px] text-fg-subtle">Drop a creative to start.</span>
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

        {busy && (
          <span className="text-[13px] text-fg-muted">
            Reading the ad, erasing the type, rebuilding. First creative takes about a minute.
          </span>
        )}

        {result && !busy && (
          <span className="text-[13px] text-fg-muted">
            {rebuilt > 0
              ? `${rebuilt} screen${rebuilt === 1 ? "" : "s"} needed a rebuild — worth a look before these go live.`
              : "Every screen was close enough in shape to keep the original design."}
          </span>
        )}
      </div>

      {error && (
        <p className="mt-4 max-w-[70ch] rounded-[8px] border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      {result && (
        <section className="mt-16">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="eyebrow">What we found in the ad</h2>
            {result.low_confidence.length > 0 && (
              <span className="text-[12px] text-warn">
                {result.low_confidence.length} font match{result.low_confidence.length === 1 ? "" : "es"} uncertain
              </span>
            )}
          </div>
          <BlueprintReadout elements={result.elements} />
        </section>
      )}
    </main>
  );
}
