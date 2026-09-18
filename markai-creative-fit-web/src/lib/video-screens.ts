/**
 * DUPLICATED from lib/screens.ts for the video path — see that file's own
 * role in the image flow and CLAUDE.md #2. This is not a re-export: the
 * video path gets a fourth tier (reframe/compose split the image path's
 * single "relayout" bucket in two), so the forecast function has genuinely
 * different logic, not just a different name. Do NOT extend lib/screens.ts
 * to cover video — the image forecast must keep returning exactly
 * "stretch" | "crop" | "relayout", untouched.
 */
import type { VideoFitMode } from "./video-types";

export interface ScreenSpec {
  id: string;
  width: number;
  height: number;
  /** What this panel is in the real world, not what its numbers are. */
  label: string;
}

/**
 * Same presets as lib/screens.ts's PRESETS. Kept as a literal copy rather
 * than an import so this file has no dependency on the image path at all.
 */
export const PRESETS: ScreenSpec[] = [
  { id: "1080x2400", width: 1080, height: 2400, label: "Café portrait" },
  { id: "1080x1920", width: 1080, height: 1920, label: "Portrait FHD" },
  { id: "1920x1080", width: 1920, height: 1080, label: "Counter landscape" },
  { id: "3840x2160", width: 3840, height: 2160, label: "Landscape 4K" },
];

export const targetOf = (s: ScreenSpec) => `${s.width}x${s.height}`;

export const aspectOf = (s: ScreenSpec) => s.width / s.height;

/** Reduce w:h to its simplest whole-number ratio, e.g. 1920x1080 -> "16:9". */
export function ratioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

/** Accepts "1080x2400" or "1080 × 2400". Returns null if it isn't a size. */
export function parseCustom(raw: string): { width: number; height: number } | null {
  const m = raw.trim().toLowerCase().replace(/\s|×/g, (c) => (c === "×" ? "x" : ""));
  const parts = m.split("x");
  if (parts.length !== 2) return null;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 64 || height < 64 || width > 10000 || height > 10000) return null;
  return { width, height };
}

//: THIRD copy of these thresholds (image: app/layout/rules.py + lib/screens.ts's
//: predictMode). Mirrors app/video/render.py::fit_mode for the stretch/crop split
//: — STRETCH_TOLERANCE/ASPECT_TOLERANCE are 1.08/1.25 there too, unchanged from the
//: image path. Past that, app/api/video_router.py::_planned_mode (REFRAME_MAX_UPSCALE)
//: decides reframe vs compose from the effective upscale a moving crop window would
//: need — a narrower target's window is capped at the source's full height/width, so
//: that upscale is fixed by geometry alone. If any of these three numbers move in
//: either service file, move them here too.
const STRETCH_TOLERANCE_VIDEO = 1.08;
const ASPECT_TOLERANCE_VIDEO = 1.25;
const REFRAME_MAX_UPSCALE_VIDEO = 1.5;

/**
 * Shown before fitting so the operator knows which screens are a simple
 * resize/crop and which ones the service cannot render yet — a reframe or
 * compose rebuild, neither of which is wired into the render path today
 * (every such target currently comes back as a refusal). Forecasting this
 * BEFORE the click is what lets a portrait panel show its "not yet" state
 * immediately instead of after minutes of processing.
 */
export function predictVideoMode(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { shift: number; mode: VideoFitMode; upscale: number } {
  const ratio = dstW / dstH / (srcW / srcH);
  const shift = Math.max(ratio, 1 / ratio);

  // Same rule as app/api/video_router.py::_effective_upscale: the window a
  // moving reframe crop would need is capped at the source's full height or
  // full width, whichever the target's aspect constrains.
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  const upscale = dstAspect >= srcAspect ? dstW / srcW : dstH / srcH;

  if (shift <= STRETCH_TOLERANCE_VIDEO) return { shift, mode: "stretch", upscale };
  if (shift <= ASPECT_TOLERANCE_VIDEO) return { shift, mode: "crop", upscale };
  return {
    shift,
    mode: upscale > REFRAME_MAX_UPSCALE_VIDEO ? "compose" : "reframe",
    upscale,
  };
}
