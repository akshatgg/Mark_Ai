"use client";

import { useCallback, useRef, useState } from "react";

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

interface Props {
  previewUrl: string | null;
  /** Name of the creative, or null when restored from a shared link. */
  name: string | null;
  /** Everything under the name: dimensions, weight. Already formatted. */
  caption: string | null;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function CreativeDrop({ previewUrl, name, caption, onPick, onClear, disabled }: Props) {
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (picked: File | undefined) => {
      if (!picked) return;
      if (!ACCEPT.includes(picked.type)) {
        setRejected(`${picked.type || "That file"} isn't supported. Use a JPEG, PNG or WebP.`);
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={name ?? "The creative"}
            className="block max-h-[260px] w-full object-contain"
          />
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
        <span className="text-[15px] text-fg">Drop a creative</span>
        <span className="max-w-[34ch] text-[13px] leading-relaxed text-fg-muted">
          A finished ad — the one with the headline and logo already in it.
        </span>
        <span className="dim mt-1 text-[11px] text-fg-subtle">JPEG · PNG · WEBP</span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT.join(",")}
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>
      {rejected && <p className="mt-2 text-[12px] text-danger">{rejected}</p>}
    </div>
  );
}
