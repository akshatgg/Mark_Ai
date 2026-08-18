export interface ScreenSpec {
  id: string;
  width: number;
  height: number;
  /** What this panel is in the real world, not what its numbers are. */
  label: string;
}

/**
 * The presets are the shapes actually in the fleet, plus the two common DOOH
 * panels operators ask for. Named by where they hang, because that is how an
 * operator recognises a screen — the numbers are the detail, not the identity.
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

/**
 * Same rule the service uses (app/layout/rules.py). Shown before fitting so the
 * operator knows which screens will be rebuilt and which are a simple resize —
 * a rebuild is the one that needs looking at.
 */
export function predictMode(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { shift: number; mode: "stretch" | "crop" | "relayout" } {
  const ratio = dstW / dstH / (srcW / srcH);
  const shift = Math.max(ratio, 1 / ratio);
  if (shift <= 1.08) return { shift, mode: "stretch" };
  if (shift <= 1.25) return { shift, mode: "crop" };
  return { shift, mode: "relayout" };
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
