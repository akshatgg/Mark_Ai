/** Mirrors app/api/schemas.py in markai-creative-fit. */

/** What the service did to get from the creative's shape to the screen's. */
export type FitMode = "stretch" | "crop" | "relayout" | "letterbox";

export interface Variant {
  width: number;
  height: number;
  mode: FitMode;
  aspect_shift: number;
  url: string;
}

export interface ElementSummary {
  role: string;
  text: string | null;
  font_family: string | null;
  font_confidence: number | null;
  color_hex: string | null;
}

export interface FitResponse {
  creative_id: string;
  source_width: number;
  source_height: number;
  elements: ElementSummary[];
  /** Elements whose font match came back weak — worth a closer look. */
  low_confidence: string[];
  variants: Variant[];
}

/**
 * How each mode is presented. `done` is what happened; `forecast` is what will
 * happen — two separate strings because "will resized" is not a sentence.
 */
export const MODE_COPY: Record<
  FitMode,
  { done: string; forecast: string; note: string; tone: string }
> = {
  relayout: {
    done: "Rebuilt",
    forecast: "Will rebuild",
    note: "Shape gap was too large to resize. Text re-rendered, logo re-placed.",
    tone: "var(--brand-teal)",
  },
  crop: {
    done: "Cropped",
    forecast: "Will crop",
    note: "Close enough to keep the original design. Scaled and centre-cropped.",
    tone: "var(--brand-green)",
  },
  stretch: {
    done: "Resized",
    forecast: "Will resize",
    note: "Near-identical shape. Resized to fit — nothing cropped, nothing lost.",
    tone: "var(--brand-green)",
  },
  letterbox: {
    done: "Letterboxed",
    forecast: "Will letterbox",
    note: "Fallback. Original centred on a blurred backdrop of itself.",
    tone: "var(--status-warn)",
  },
};
