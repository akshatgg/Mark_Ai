"use client";

import { useState } from "react";

import { VideoPanel } from "@/components/video-panel";
import { parseCustom, predictVideoMode, targetOf, type ScreenSpec } from "@/lib/video-screens";
import type { VideoRefusal, VideoVariant } from "@/lib/video-types";

/**
 * DUPLICATED from screen-rack.tsx for the video path — not screen-rack.tsx
 * taking a `kind` prop. See CLAUDE.md / the phase C/D/E plan's Task 10.
 */

interface Props {
  screens: ScreenSpec[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAdd: (spec: ScreenSpec) => void;
  onRemove: (id: string) => void;
  variants: Map<string, VideoVariant>;
  refusals: Map<string, VideoRefusal>;
  source: { width: number; height: number } | null;
  busyIds: Set<string>;
}

export function VideoRack({
  screens,
  selected,
  onToggle,
  onAdd,
  onRemove,
  variants,
  refusals,
  source,
  busyIds,
}: Props) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  function addCustom() {
    const parsed = parseCustom(raw);
    if (!parsed) {
      setError("Give a size like 1080x2400.");
      return;
    }
    const id = `${parsed.width}x${parsed.height}`;
    if (screens.some((s) => s.id === id)) {
      setError("That screen is already on the rack.");
      return;
    }
    onAdd({ id, width: parsed.width, height: parsed.height, label: "Custom screen" });
    setRaw("");
    setError(null);
  }

  return (
    <div>
      {/* Panels stand on a shelf. Grid rather than flex-wrap so each row sizes to
          its own tallest panel — a wrapped landscape panel shouldn't inherit a
          portrait row's height and float in dead space. */}
      <div className="grid grid-cols-[repeat(auto-fill,168px)] items-stretch gap-x-7 gap-y-6">
        {screens.map((spec) => (
          <VideoPanel
            key={spec.id}
            spec={spec}
            selected={selected.has(spec.id)}
            onToggle={() => onToggle(spec.id)}
            onRemove={spec.label === "Custom screen" ? () => onRemove(spec.id) : undefined}
            variant={variants.get(targetOf(spec))}
            refusal={refusals.get(targetOf(spec))}
            prediction={
              source && !variants.has(targetOf(spec)) && !refusals.has(targetOf(spec))
                ? predictVideoMode(source.width, source.height, spec.width, spec.height)
                : undefined
            }
            busy={busyIds.has(spec.id)}
          />
        ))}
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-2">
        <label htmlFor="custom-size-video" className="eyebrow">
          Add a screen
        </label>
        <input
          id="custom-size-video"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && addCustom()}
          placeholder="1080x2400"
          className="dim w-[132px] rounded-[8px] border border-line-strong bg-canvas-subtle px-3 py-1.5 text-[12px] text-fg placeholder:text-fg-subtle"
        />
        <button
          type="button"
          onClick={addCustom}
          className="cursor-pointer rounded-[8px] border border-line-strong px-3 py-1.5 text-[12px] text-fg-muted transition-colors hover:border-teal hover:text-fg"
        >
          Add
        </button>
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    </div>
  );
}
