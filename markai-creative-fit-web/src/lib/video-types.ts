/** Mirrors app/api/video_schemas.py and app/video/schemas.py in markai-creative-fit.
 *
 * This is a sibling of lib/types.ts, not an extension of it — the video API has a
 * different shape (a probe, a job envelope, refusals) and its own mode vocabulary.
 * See lib/types.ts's own header comment and CLAUDE.md #2/#5: duplicating here is
 * what keeps a change to one path from silently reaching into the other.
 */

/** How the service fit the source shape onto the target shape. */
export type VideoFitMode = "stretch" | "crop" | "reframe" | "compose";

export interface VideoProbe {
  width: number;
  height: number;
  fps: number;
  duration_seconds: number;
  codec: string;
  pix_fmt: string;
  has_audio: boolean;
  size_bytes: number | null;
  color_space: string;
  color_transfer: string;
  color_primaries: string;
  color_range: string;
  color_inferred: boolean;
  rotation: number;
  is_vfr: boolean;
}

export interface IngestResponse {
  creative_id: string;
  probe: VideoProbe;
}

export interface VideoVariant {
  width: number;
  height: number;
  mode: VideoFitMode;
  aspect_shift: number;
  url: string;
  duration_seconds: number | null;
  warnings: string[];
}

/** A target the fast path could not render yet — a "not yet", never a failure. */
export interface VideoRefusal {
  width: number;
  height: number;
  planned_mode: VideoFitMode;
  reason: string;
}

export interface VideoFitResult {
  creative_id: string;
  probe: VideoProbe;
  variants: VideoVariant[];
  refusals: VideoRefusal[];
}

export type VideoJobKind = "fit" | "analyse";
export type VideoJobState = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobAccepted {
  job_id: string;
  status: string;
  poll_url: string;
}

export interface CancelResponse {
  job_id: string;
  status: string;
}

/**
 * Polled repeatedly until `status` is terminal. `result` is a plain JSON dict
 * server-side (a FitJobResult, once `kind === "fit"`) — cast it at the call
 * site rather than widening this type into a union, matching how the service
 * itself describes it (see JobStatusResponse's docstring).
 */
export interface VideoJobStatus {
  job_id: string;
  kind: VideoJobKind;
  status: VideoJobState;
  percent: number;
  eta_seconds: number | null;
  created_at: number;
  updated_at: number;
  error: string | null;
  result: VideoFitResult | Record<string, unknown> | null;
}

/**
 * How each mode is presented. Its OWN map with separate `done`/`forecast`
 * strings — see lib/types.ts's MODE_COPY comment: deriving one from the
 * other produced "will resized". Five keys: the four the service can
 * produce (stretch/crop/reframe/compose) plus `unknown`, a defensive
 * fallback for a mode string this build doesn't recognise — the video
 * render tiers are still growing (today the fast path only ever ships
 * `stretch`/`crop` as a rendered variant's mode; `reframe`/`compose` appear
 * only as a refusal's `planned_mode`, since neither renders yet).
 */
export const VIDEO_MODE_COPY: Record<
  VideoFitMode | "unknown",
  { done: string; forecast: string; note: string; tone: string }
> = {
  stretch: {
    done: "Resized",
    forecast: "Will resize",
    note: "Near-identical shape. Resized to fit — nothing cropped, nothing lost.",
    tone: "var(--brand-green)",
  },
  crop: {
    done: "Cropped",
    forecast: "Will crop",
    note: "Close enough to keep the original design. Scaled and centre-cropped.",
    tone: "var(--brand-green)",
  },
  reframe: {
    done: "Reframed",
    forecast: "Not yet — will reframe",
    note: "Shape gap needs a moving crop window tracking the subject. Not rendered yet.",
    tone: "var(--status-warn)",
  },
  compose: {
    done: "Composed",
    forecast: "Not yet — will compose",
    note: "Shape gap is too large for any crop window. Needs a rebuilt stage around the footage. Not rendered yet.",
    tone: "var(--status-warn)",
  },
  unknown: {
    done: "Rendered",
    forecast: "Not yet",
    note: "This shape isn't classified by this build of the front end.",
    tone: "var(--status-warn)",
  },
};
