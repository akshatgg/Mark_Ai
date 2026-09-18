"use client";

import { useCallback, useRef, useState } from "react";

/**
 * DUPLICATED from creative-drop.tsx for the video path — not a shared
 * component taking a `kind` prop. See CLAUDE.md / the phase C/D/E plan's
 * Task 10: parameterising the tested image dropzone is exactly what would
 * risk breaking it.
 */

const ACCEPT_EXT = [".mp4", ".mov", ".webm", ".mkv"];
const ACCEPT_ATTR = "video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv";

interface Props {
  previewUrl: string | null;
  /** Name of the creative, or null when restored from a shared link. */
  name: string | null;
  /** Everything under the name: dimensions, duration, weight. Already formatted. */
  caption: string | null;
  onPick: (file: File) => void;
  onClear: () => void;
  /** Intrinsic size + duration, read off a hidden probe <video> so the rack
   * can forecast before any upload happens — mirrors the Image() read the
   * image workbench does in page.tsx, just for video's own metadata event. */
  onMeta?: (meta: { width: number; height: number; duration: number }) => void;
  disabled?: boolean;
}

export function VideoDrop({ previewUrl, name, caption, onPick, onClear, onMeta, disabled }: Props) {
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (picked: File | undefined) => {
      if (!picked) return;
      const lower = picked.name.toLowerCase();
      if (!ACCEPT_EXT.some((ext) => lower.endsWith(ext))) {
        setRejected(`${picked.name || "That file"} isn't supported. Use MP4, MOV, WEBM or MKV.`);
        return;
      }
      setRejected(null);
      onPick(picked);
    },
    [onPick],
  );

  if (previewUrl) {
    return (
      <div className="rounded-[10px] border border-line bg-panel p-3">
        <div className="overflow-hidden rounded-md bg-[#05070b]">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={previewUrl}
            controls
            muted
            playsInline
            preload="metadata"
            className="block max-h-[260px] w-full"
          />
          {/* Hidden probe: reads intrinsic size + duration off the raw file
              so the rack can forecast before any upload happens. Kept
              separate from the visible preview above so the forecast never
              depends on the user's own controls/scrub state. */}
          {onMeta && (
            <video
              src={previewUrl}
              muted
              preload="metadata"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                onMeta({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
              }}
            />
          )}
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-fg" title={name ?? undefined}>
              {name ?? "Shared creative"}
            </p>
            {caption && <p className="dim mt-0.5 text-[11px] text-fg-subtle">{caption}</p>}
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="shrink-0 cursor-pointer text-[12px] text-fg-muted underline decoration-dotted underline-offset-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Replace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="dropzone flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 px-6 py-10 text-center"
        data-over={over}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          accept(e.dataTransfer.files[0]);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
      >
        <span className="text-[15px] text-fg">Drop a video</span>
        <span className="max-w-[34ch] text-[13px] leading-relaxed text-fg-muted">
          A finished ad — the one with the type already baked into the frame.
        </span>
        <span className="dim mt-1 text-[11px] text-fg-subtle">MP4 · MOV · WEBM · MKV</span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>
      {rejected && <p className="mt-2 text-[12px] text-danger">{rejected}</p>}
    </div>
  );
}
