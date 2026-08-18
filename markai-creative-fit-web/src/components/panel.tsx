"use client";

import { ratioLabel, type ScreenSpec } from "@/lib/screens";
import { MODE_COPY, type Variant } from "@/lib/types";

/** Bounding box every panel is drawn inside, preserving its true aspect. */
const BOX_W = 168;
const BOX_H = 214;

interface Props {
  spec: ScreenSpec;
  selected: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  variant?: Variant;
  prediction?: { shift: number; mode: "stretch" | "crop" | "relayout" };
  busy?: boolean;
}

export function Panel({ spec, selected, onToggle, onRemove, variant, prediction, busy }: Props) {
  // True aspect is the whole point: a portrait café panel should look tall and
  // narrow next to a landscape one, so the operator picks by shape.
  const scale = Math.min(BOX_W / spec.width, BOX_H / spec.height);
  const w = Math.round(spec.width * scale);
  const h = Math.round(spec.height * scale);

  const mode = variant?.mode ?? prediction?.mode;
  const copy = mode ? MODE_COPY[mode] : null;
  const shift = variant?.aspect_shift ?? prediction?.shift;

  return (
    // A spacer above the bezel pushes it to the bottom of its grid cell, so every
    // panel in a row rests on the same shelf. A fixed-height box would work too
    // until a short landscape panel wraps onto a row alone — then it leaves a
    // void above itself. Grid rows size to their own content instead.
    <div className="flex h-full w-[168px] flex-col items-center">
      <div className="flex-1" />
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={`${spec.label}, ${spec.width} by ${spec.height}`}
        className="bezel cursor-pointer"
        data-selected={selected}
        style={{ width: w + 12, height: h + 12 }}
      >
        <div className="screen" data-lit={Boolean(variant)}>
          {variant ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={variant.url} alt={`Fitted for ${spec.label}`} />
          ) : busy ? (
            <div className="flex h-full items-center justify-center">
              <span className="spin block h-4 w-4 rounded-full border border-white/15 border-t-[var(--brand-teal)]" />
            </div>
          ) : null}
        </div>
      </button>

      <div className="mt-2.5 flex min-h-[76px] w-full flex-col items-center gap-1 text-center">
        <span className="text-[13px] leading-tight text-fg">{spec.label}</span>
        <span className="dim text-[11px] text-fg-subtle">
          {spec.width}×{spec.height} · {ratioLabel(spec.width, spec.height)}
        </span>

        {copy && shift !== undefined && (
          <span
            className="dim mt-0.5 rounded-full px-2 py-[3px] text-[10px] leading-none"
            style={{
              color: copy.tone,
              background: `color-mix(in srgb, ${copy.tone} 13%, transparent)`,
              // Before fitting this is a forecast, so it is stated quietly.
              opacity: variant ? 1 : 0.62,
            }}
            title={copy.note}
          >
            {variant ? copy.done : copy.forecast} · {shift.toFixed(2)}×
          </span>
        )}

        {variant && (
          <a
            href={variant.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 text-[11px] text-fg-muted underline decoration-dotted underline-offset-2 hover:text-teal"
          >
            Open full size
          </a>
        )}

        {onRemove && !variant && (
          <button
            type="button"
            onClick={onRemove}
            className="mt-0.5 cursor-pointer text-[11px] text-fg-subtle hover:text-danger"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
