# Video Creative Fit — Plan C (CMS Image|Video toggle and the video flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator opens `/creative-fit`, flips the toggle to **Video**, uploads or picks a video, picks a screen, scans it, resizes it, watches progress, sees the result play, and saves it to Content — and the **Image** side looks and behaves *exactly* as it does today.

**Architecture:** The toggle is a **route**, not a state flag. `src/app/(dashboard)/creative-fit/layout.tsx` is created to own the one `<PageHeader>` for both routes and to hang the Image|Video segmented control in the header's existing `actions` slot. `page.tsx` (image) loses only its own `<PageHeader>` block — nothing else. `video/page.tsx` is a structural mirror of `page.tsx` driven by the *same* `fitStage()` machine from `lib/creative-fit.ts`. Every media-specific component is **duplicated** into `src/components/creative-fit/video/`, never generalised with a `kind` prop — this is a standing instruction from the shared contract, and it is what keeps the image page provably untouched. `TargetPicker` and all of `lib/creative-fit.ts` are imported by both pages unchanged. `ResizeControls` is **not** shared: the video side gets its own duplicate offering Cover and Stretch only, because `contain` + `pad_fill` is letterboxing and the user has ruled bars out on the video path (see Task 6).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS v4 (`@theme` tokens, no config file), lucide-react, vitest.

## Global Constraints

- **The image path is FROZEN.** The only edit permitted anywhere under `src/app/(dashboard)/creative-fit/page.tsx` is deleting its `<PageHeader>` JSX block and the now-unused import. The only edits permitted to `src/lib/api.ts` and `src/lib/types.ts` are **additive** (new methods, new fields, new interfaces) plus the one back-compatible `jobs()` signature widening in Task 3. `src/components/creative-fit/SourcePicker.tsx`, `ResultPreview.tsx`, `SaveToContentModal.tsx`, `JobHistory.tsx`, `VerdictCard.tsx`, `ScanCard.tsx`, `TargetPicker.tsx`, `ResizeControls.tsx`, `src/lib/creative-fit.ts` and `src/lib/creative-fit.test.ts` are **not modified by any task in this plan.**
- **`src/lib/creative-fit.ts` is reused unchanged and is provably media-agnostic.** Verified by reading it end to end: `fitStage`/`isFitBusy`/`isFitLocked`/`canRunFit` (lines 289–338) key only off `hasSource`/`hasTarget`/`scanning`/`submitting`/`hasAnalysis`/`jobStatus`; `analyzeFit`, `previewBox`, `ratioLabel`, `orientationOf`, `formatBytes`, `formatElapsed`, `elapsedSince`, `bandTone`, `formatPct`, `RESOLUTION_PRESETS` are pure geometry/format helpers with no image assumption anywhere. `src/lib/creative-fit.test.ts` therefore needs no change either. **Do not touch either file.**
- **No new whitespace or layout shift on the Image side.** `PageHeader` already carries `mb-6`; the page's root is `<div className="space-y-5">` and `PageHeader` was its *first* child, so it never received a `space-y` margin. Moving it into the layout keeps the exact same DOM order in the same flow, so the 24px gap below the title is byte-for-byte the same. Verify visually before claiming the task done.
- **Match the existing design exactly.** Reuse the real class strings quoted in each step. No new colours, no new radii, no new spacing scale. Tones come from `Badge`'s `Tone` union (`green | gray | blue | amber | red | teal`) and nothing else.
- **⚠️ AMENDED AFTER PLAN B SHIPPED — the video page has NO fit-mode picker.**
  Plan B's implementation revealed that `app/video/pipeline.py::fit_video` chooses the
  render tier itself, purely from the aspect shift (`render.fit_mode()`: stretch ≤ 1.08×,
  crop ≤ 1.25×, else reframe/compose). An operator-supplied `fit_mode` was silently
  overridden — a control that does nothing. The user's decision: **the engine keeps
  choosing the tier; the operator keeps the anchor.** So:
  - `VideoResizeControls` renders the **3×3 anchor grid only** — no Cover/Stretch tiles,
    no pad fill, no colour input. The anchor IS honoured: it was wired through
    `render_fast` → `render` → `fit_video` → `execute_video_job` and pixel-proven.
  - Above the grid, show the chosen tier read-only, e.g. *"Mark chose: CROP (shape gap
    1.19×)"*, sourced from `variants[0].mode` once the job is done, or from the analyze
    verdict before it runs.
  - The create-job payload sends **`anchor` only** — never `fit_mode`, `pad_fill` or
    `pad_color`.
  This supersedes every mention of Cover/Stretch tiles for video below.
- **No bars, anywhere, ever — on the panel or in the preview.** The user has said twice and emphatically that they do not want whitespace: *"I don't want to create a white space. We have to make it as it is."* `fit_mode: "contain"` **is** letterboxing, so the video path does not offer it: `VideoResizeControls` exposes only `cover` (with the anchor grid) and `stretch`, and the backend 422s a `contain` on a video job. A shape gap too big to crop is what **Rebuild with AI** is for — it routes to the compose tier, which fills the panel with a flat brand-coloured card and re-typeset copy rather than bars. The image path keeps `contain`; it is frozen and is not the user's complaint.
- **The video result must FILL its preview panel — never letterboxed.** A `<video>` element defaults to `object-fit: contain`, which paints black bars whenever the element box and the video's aspect disagree. Every result `<video>` is sized by `previewBox()` to the result's exact aspect *and* given `object-cover`, exactly as the image `Frame` does at `ResultPreview.tsx:231-236`.
- **A 500 MB video can never go through `requestMultipart`.** Cloud Run caps request bodies at 32 MiB. Source video bytes go browser → signed resumable PUT → GCS, using the `putToUploadSession` XHR helper that already exists at `src/lib/api.ts:312-337` (it is the only way to get upload progress; `fetch()` does not report it).
- **There is NO eslint config in this repo.** `npm run lint` is a stale script — do not add a lint gate, do not add eslint. Verification is `npm run typecheck`, `npm test`, `npm run build`.
- **Do not run `git commit`.** The user works uncommitted.
- **Tell the user before anything makes a real Gemini API call.** Clicking "Scan this video" on a live backend does exactly that.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/app/(dashboard)/creative-fit/layout.tsx` | **CREATE** | The one `<PageHeader>` for both routes + the Image\|Video control in its `actions` slot |
| `src/app/(dashboard)/creative-fit/page.tsx` | **MODIFY** | Delete its own `<PageHeader>` block + the unused import. Nothing else |
| `src/app/(dashboard)/creative-fit/video/page.tsx` | **CREATE** | The video flow — structural mirror of `page.tsx` |
| `src/components/creative-fit/MediaKindTabs.tsx` | **CREATE** | The route-based segmented control (client island) |
| `src/components/creative-fit/video/VideoSourcePicker.tsx` | **CREATE** | Step 1 for video — library filtered to `type: "video"`, direct-to-GCS upload with a progress bar |
| `src/components/creative-fit/video/VideoScanCard.tsx` | **CREATE** | Step 3 gate — "Scan this video" |
| `src/components/creative-fit/video/VideoVerdictCard.tsx` | **CREATE** | The verdict + Resize / Rebuild / Stop |
| `src/components/creative-fit/video/VideoResizeControls.tsx` | **CREATE** | Cover + Stretch only — no `contain`, no pad fill, no bars |
| `src/components/creative-fit/video/VideoResultPreview.tsx` | **CREATE** | Before/after as `<video>`, determinate progress, `.mp4` download |
| `src/components/creative-fit/video/VideoSaveToContentModal.tsx` | **CREATE** | "Add media" for a finished video fit |
| `src/components/creative-fit/video/VideoJobHistory.tsx` | **CREATE** | The video-only recent-fits strip |
| `src/lib/video-fit.ts` | **CREATE** | Pure video presentation helpers (`formatDuration`, `videoStageLabel`, `videoProgressPct`) |
| `src/lib/video-fit.test.ts` | **CREATE** | vitest cover for the above |
| `src/lib/types.ts` | **MODIFY (additive)** | `FitMediaKind`, video fields on `FitJob`/`CreativeFitStatus`, the four new video interfaces |
| `src/lib/api.ts` | **MODIFY (additive)** | `jobs(limit?, kind?)`, `videoAnalyze`, `videoUploadSession`, `videoUpload` |

**Reused unchanged by both routes:** `TargetPicker.tsx`, `lib/creative-fit.ts`, `lib/creative-fit.test.ts`, `components/ui/*`, `components/patterns/PageHeader.tsx`, `lib/media.ts` (`probeMediaFile`).

**Frozen and now image-only:** `ResizeControls.tsx` — still imported by the image page exactly as today, **not** modified, and **not** imported by anything under `video/`.

---

### Task 1: The route-based Image|Video toggle

This is the single riskiest edit in the plan: the image page must not move by one pixel. Do this task first and verify it visually before anything else is built.

**`PageHeader` already has a right-hand slot** — `actions?: ReactNode`, rendered as `{actions && <div className="flex items-center gap-2">{actions}</div>}` inside a `flex flex-wrap items-end justify-between gap-4` row (`src/components/patterns/PageHeader.tsx:4-24`). The toggle goes there. It occupies horizontal space that is empty today and adds **zero** vertical height on desktop; on a narrow viewport the header row wraps, which is the same behaviour every other page with actions already has.

**Files:**
- Create: `src/app/(dashboard)/creative-fit/layout.tsx`
- Create: `src/components/creative-fit/MediaKindTabs.tsx`
- Modify: `src/app/(dashboard)/creative-fit/page.tsx` — delete line 16 (import) and lines 314–318 (the `<PageHeader>` block plus its trailing blank line)

**Interfaces:**
- Consumes: `PageHeader({ title: string; subtitle?: string; actions?: ReactNode })` from `@/components/patterns/PageHeader`; `cn(...classes: Array<string | false | null | undefined>): string` from `@/lib/utils`
- Produces: `MediaKindTabs(): JSX.Element` (no props — it reads `usePathname()`); default-exported `CreativeFitLayout({ children }: { children: ReactNode })`

- [ ] **Step 1: Create the segmented control**

There is **no** segmented-control primitive in `src/components/ui/` — the barrel at `src/components/ui/index.ts` exports Button, Card, form fields, Badge, Table, DateTimePicker, Modal, feedback, data-viz and MobileDetails, and nothing else. The design system's segmented control is the `TabButton` pattern used by `SourcePicker` (`SourcePicker.tsx:394-422`) and `TargetPicker` (`TargetPicker.tsx:108-125`): a `role="tablist"` container with `bg-panel-raised p-1` holding buttons that flip between `bg-panel text-fg shadow-[var(--elev-1)]` and `text-fg-muted hover:text-fg`.

`TabButton` is a `<button>`, and this toggle navigates — so it needs `<Link>` (prefetch, middle-click, real href). The class strings below are **copied verbatim** from `TabButton` so the two controls are visually identical; only the sizing (`min-w-[92px] px-3` instead of a `grid-cols-2` full-width stretch) differs, because this instance sits in a header actions slot rather than spanning a card.

Create `src/components/creative-fit/MediaKindTabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ImageIcon, Video } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Image | Video — the one toggle on the Creative Fit workbench.
 *
 * It is a ROUTE, not a state flag. Two pipelines that share nothing but a
 * screen picker do not belong in one component tree governed by a boolean: an
 * operator who is mid-video-upload and clicks "Image" should get a clean page,
 * not a half-torn-down one, and each side should be able to change without
 * the other's tests being the thing that catches it.
 *
 * Styling is deliberately the same control the two pickers below already use
 * (SourcePicker's TabButton) — the page must not grow a second visual language
 * for "pick one of two". It renders <Link> rather than <button> because it
 * navigates: that buys prefetch, middle-click and a real href for free.
 */
export function MediaKindTabs() {
  const pathname = usePathname();
  // Any deeper /creative-fit/video/* route still counts as the video side.
  const onVideo = pathname.startsWith("/creative-fit/video");

  return (
    <div
      role="tablist"
      aria-label="Creative kind"
      className="inline-grid grid-cols-2 gap-1 rounded-[var(--radius-md)] bg-panel-raised p-1"
    >
      <Link
        href="/creative-fit"
        role="tab"
        aria-selected={!onVideo}
        className={cn(
          "flex h-9 min-w-[92px] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-xs font-medium transition-colors",
          !onVideo
            ? "bg-panel text-fg shadow-[var(--elev-1)]"
            : "text-fg-muted hover:text-fg",
        )}
      >
        <ImageIcon className="h-4 w-4" />
        Image
      </Link>
      <Link
        href="/creative-fit/video"
        role="tab"
        aria-selected={onVideo}
        className={cn(
          "flex h-9 min-w-[92px] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-xs font-medium transition-colors",
          onVideo
            ? "bg-panel text-fg shadow-[var(--elev-1)]"
            : "text-fg-muted hover:text-fg",
        )}
      >
        <Video className="h-4 w-4" />
        Video
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Create the shared layout that owns the header**

Create `src/app/(dashboard)/creative-fit/layout.tsx`. It is a **server** component — only the tabs need `usePathname`, and they are their own client island, so the header itself ships no JS:

```tsx
import type { ReactNode } from "react";

import { PageHeader } from "@/components/patterns/PageHeader";
import { MediaKindTabs } from "@/components/creative-fit/MediaKindTabs";

/**
 * The Creative Fit workbench header, shared by the image and video routes.
 *
 * The title lives here rather than in each page for one reason: switching
 * pipelines must not redraw the heading. Next keeps a layout mounted across a
 * navigation between its own children, so the header — and the toggle inside
 * it — stay put while only the workbench underneath swaps.
 *
 * The fragment is load-bearing. PageHeader carries its own `mb-6`, and each
 * page's root is a `space-y-5` stack whose first child never takes a space-y
 * margin; wrapping these two in a spacing container would change the gap under
 * the title on the image page, which is exactly what this plan must not do.
 */
export default function CreativeFitLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title="Creative Fit"
        subtitle="Make any ad fit any screen — resize it, or have the AI rebuild it for a different shape."
        actions={<MediaKindTabs />}
      />
      {children}
    </>
  );
}
```

- [ ] **Step 3: Delete the image page's own header — and nothing else**

Two deletions in `src/app/(dashboard)/creative-fit/page.tsx`.

**Deletion A — the import at line 16.**

Before (lines 15–17):

```tsx
import { useToast } from "@/components/Toast";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Card, Textarea } from "@/components/ui";
```

After:

```tsx
import { useToast } from "@/components/Toast";
import { Card, Textarea } from "@/components/ui";
```

**Deletion B — the JSX block at lines 312–319.**

Before (lines 312–319 exactly as they stand today):

```tsx
  return (
    <div className="space-y-5">
      <PageHeader
        title="Creative Fit"
        subtitle="Make any ad fit any screen — resize it, or have the AI rebuild it for a different shape."
      />

      {status && !status.ai_enabled && (
```

After:

```tsx
  return (
    <div className="space-y-5">
      {status && !status.ai_enabled && (
```

Delete the five lines `<PageHeader … />` **and** the single blank line that followed it. Do not reindent, do not reflow, do not touch the `{status && !status.ai_enabled && (` line, and do not touch anything else in the file. Everything from `{status && !status.ai_enabled && (` to the end of the file stays byte-identical.

- [ ] **Step 4: Prove the image page did not move**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
git diff --stat "src/app/(dashboard)/creative-fit/page.tsx"
git diff "src/app/(dashboard)/creative-fit/page.tsx"
```

The diff must show exactly **6 deleted lines and 0 added lines** in that file (1 import + 5 JSX/blank). If it shows anything else — a reindent, a reordered import, a reformatted line — revert the file and redo the deletion by hand.

- [ ] **Step 5: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
```

`npm run build` is the one that matters here: a route group gaining a `layout.tsx` changes the render tree, and a build is what proves both `/creative-fit` and (once it exists) `/creative-fit/video` still compile as client pages under the dashboard shell. The sidebar's active check is `pathname.startsWith(href)` (`src/components/layout/Sidebar.tsx:80-82`), so `/creative-fit/video` keeps the "Creative Fit" nav item highlighted with no change needed there.

---

### Task 2: Types and the pure video presentation helpers

**Files:**
- Modify: `src/lib/types.ts` — add after the `FitJobStatus` union (ends line 978), extend `CreativeFitStatus` (lines 982–991), extend `CreateFitJobPayload` (lines 1079–1088), extend `FitJob` (lines 1090–1119)
- Create: `src/lib/video-fit.ts`
- Create: `src/lib/video-fit.test.ts`

**Interfaces:**
- Produces: `FitMediaKind = "image" | "video"`; `FitVideoVariant`, `FitVideoFacts`, `FitVideoAnalyzeResponse`, `FitVideoUploadSession`, `FitVideoSourceUpload`
- Produces: `formatDuration(seconds: number | null | undefined): string`, `videoStageLabel(stage: string | null | undefined, status: FitJobStatus): string`, `videoProgressPct(progress: number | null | undefined): number | null`
- Consumes: `FitAnalysis`, `FitJobStatus`, `FitSourceUpload` (existing, unchanged)

- [ ] **Step 1: Add the media-kind union and the video interfaces to `types.ts`**

Insert immediately after the `FitJobStatus` union (which currently ends at line 978 with `  | "cancelled";`) and before the `CreativeFitStatus` doc comment:

```ts
/** Which pipeline a fit runs through. Mirrors MEDIA_KIND_IMAGE / MEDIA_KIND_VIDEO
 *  in app/creative_fit/models.py. The column has a server default of "image", so
 *  every row that predates video reads back as an image job. */
export type FitMediaKind = "image" | "video";

/** One rendered output of a video fit. Mirrors VideoVariantOut in
 *  app/creative_fit/video_schemas.py. `mode` is the tier the renderer chose:
 *  stretch | crop | reframe | compose. */
export interface FitVideoVariant {
  width: number;
  height: number;
  mode: string;
  url: string;
  duration_seconds: number;
  warnings: string[];
}

/** What ffprobe + the shot detector measured about the source video. Mirrors
 *  VideoFacts in app/creative_fit/video_schemas.py. */
export interface FitVideoFacts {
  width: number;
  height: number;
  duration_seconds: number;
  fps: number;
  shot_count: number;
  has_audio: boolean;
  /** True when the source carried no colour tags and they had to be inferred —
   *  worth surfacing, because it is the usual cause of a shifted-looking result. */
  color_inferred: boolean;
}

/**
 * The video scan's answer.
 *
 * FLAT, not nested under a `reading` object, and the human-readable `reason`
 * lives inside `analysis` — both exactly as the image path's FitAnalyzeResponse
 * does, because the requirement is the same UI and the same flow. The geometry
 * block IS the same FitAnalysis: the shape gap is measured identically whatever
 * is inside the file. Everything beside it is what only a video has.
 */
export interface FitVideoAnalyzeResponse {
  analysis: FitAnalysis;
  facts: FitVideoFacts;
  /** True when the AI read the keyframes; false when it is the geometry-only
   *  verdict (AI off, or the call failed). Badged in the UI either way. */
  ai_reviewed: boolean;
  confidence?: number;
  text_content?: string[];
  brand_colors?: string[];
  logo_present?: boolean;
  /** e.g. "the logo animates in at 0:02 and holds" — why a crop would hurt. */
  motion_note?: string;
  layout_plan?: string;
  /** Seconds this ad actually gets on the glass, from the target screen's slot.
   *  Null for a typed W×H target — there is no screen to ask. */
  slot_seconds?: number | null;
  rebuild_available: boolean;
  /** False when the source is longer than the backend's max duration, or the
   *  bucket isn't configured. Both action buttons go dead. */
  fit_available: boolean;
}

/** A signed resumable PUT target for a source video. The bytes never touch the
 *  API: Cloud Run rejects request bodies over 32 MiB and a source video is
 *  routinely hundreds of megabytes. */
export interface FitVideoUploadSession {
  /** PUT the file here, with no Authorization header. */
  upload_url: string;
  /** What the job payload refers to the finished object by. */
  source_url: string;
  source_name: string;
}

/** What the browser knows about a freshly uploaded source video: the storage
 *  reference from the session, plus the dimensions and duration read locally. */
export interface FitVideoSourceUpload extends FitSourceUpload {
  duration_seconds: number | null;
}
```

- [ ] **Step 2: Extend `CreativeFitStatus`**

Before (lines 982–991):

```ts
export interface CreativeFitStatus {
  ai_enabled: boolean;
  rebuild_available: boolean;
  image_model: string;
  workers: number;
  max_upload_mb: number;
  /** Hours an unsaved fit survives before it's swept away with its files.
   *  Saving a result to Content takes it out of scope permanently. */
  retention_hours: number;
}
```

After:

```ts
export interface CreativeFitStatus {
  ai_enabled: boolean;
  rebuild_available: boolean;
  image_model: string;
  workers: number;
  max_upload_mb: number;
  /** Hours an unsaved fit survives before it's swept away with its files.
   *  Saving a result to Content takes it out of scope permanently. */
  retention_hours: number;
  /** False when this deployment has no video lane (CREATIVE_FIT_VIDEO_WORKERS=0,
   *  or ffmpeg/torch missing). The video page reads it before offering anything. */
  video_enabled: boolean;
  /** Separate from max_upload_mb — a source video is allowed hundreds of MB. */
  video_max_upload_mb: number;
  video_max_duration_seconds: number;
}
```

- [ ] **Step 3: Extend `CreateFitJobPayload` and `FitJob`**

`CreateFitJobPayload` — add one field (before was lines 1079–1088):

```ts
export type CreateFitJobPayload = FitSourceRef &
  FitTargetRef & {
    mode: FitJobMode;
    /** Omit on the image path: the backend defaults to "image", and sending it
     *  explicitly from the frozen image page would be an edit to that page. */
    media_kind?: FitMediaKind;
    fit_mode?: FitMode;
    anchor?: FitAnchor;
    pad_fill?: PadFill;
    pad_color?: string;
    user_note?: string;
    auto_save?: boolean;
  };
```

`FitJob` — add five fields immediately after `result_bytes?: number | null;` (line 1116) and before `created_at`:

```ts
  result_bytes?: number | null;
  /** Which pipeline produced this row. Server default "image". */
  media_kind: FitMediaKind;
  /** 0–100 while a video job runs. Null on the image path, which finishes too
   *  fast for a bar to mean anything. */
  progress?: number | null;
  /** The worker's coarse phase. Exactly seven values, frozen in the shared
   *  contract and emitted by app/creative_fit/video_service.py:
   *  "downloading" | "probing" | "segmenting" | "reading" | "rendering" |
   *  "uploading" | "done". Rendered through videoStageLabel(), which still
   *  tolerates a value it has never seen. */
  stage?: string | null;
  /** Length of the finished video, seconds. */
  duration_seconds?: number | null;
  /** Every rendered output. The video path can emit more than one. */
  variants?: FitVideoVariant[] | null;
  created_at: string;
```

- [ ] **Step 4: Create the pure helpers**

`lib/creative-fit.ts` is frozen, so video-only presentation lives in its own module — pure, so it is tested rather than clicked through.

Create `src/lib/video-fit.ts`:

```ts
// Video Creative Fit — presentation helpers.
//
// Deliberately a separate module from lib/creative-fit.ts, which is shared with
// the image page and must not change. Everything here is pure and covered by
// video-fit.test.ts; nothing here talks to the network.

import type { FitJobStatus } from "./types";

/** "0:07" · "1:24" · "12:03" — a video length or position. Mirrors
 *  formatElapsed's shape so a duration and a timer read the same way. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * What the worker is doing, in the operator's language.
 *
 * A video fit takes minutes, not seconds, so "Working…" for fifteen minutes
 * reads as a hang. The backend's stage slug is mapped here; anything unknown
 * falls back to a de-slugged version of itself rather than to a lie, so a stage
 * added on the server later still renders sensibly without a CMS release.
 *
 * These seven cases are the WHOLE vocabulary the worker emits, in order, with
 * the progress each carries:
 *   downloading 5 · probing 12 · segmenting 20 · reading 28 · rendering 40 ·
 *   uploading 85 · done 100
 * They are frozen in the shared contract. Do not invent an eighth here — add it
 * on the server first, and this function will de-slug it until we catch up.
 */
export function videoStageLabel(
  stage: string | null | undefined,
  status: FitJobStatus,
): string {
  if (status === "queued") return "Waiting for a worker…";
  switch (stage) {
    case "downloading":
      return "Fetching the video…";
    case "probing":
      return "Reading the video…";
    case "segmenting":
      return "Finding the cuts…";
    case "reading":
      return "Reading the artwork…";
    case "rendering":
      return "Laying it out again…";
    case "uploading":
      return "Storing the result…";
    case "done":
      return "Finishing up…";
    default:
      break;
  }
  if (!stage) return "Working…";
  const words = stage.replace(/[_-]+/g, " ").trim();
  if (!words) return "Working…";
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}…`;
}

/**
 * The progress bar's width, or null when there is nothing honest to draw.
 *
 * Clamped, because a worker that reports 103% would push the bar out of its
 * own track — and a bar that goes backwards or overshoots destroys the only
 * thing it is there for, which is trust in the number.
 */
export function videoProgressPct(
  progress: number | null | undefined,
): number | null {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.min(100, Math.max(0, Math.round(progress)));
}
```

- [ ] **Step 5: Cover the helpers**

Create `src/lib/video-fit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatDuration, videoProgressPct, videoStageLabel } from "./video-fit";

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(84)).toBe("1:24");
    expect(formatDuration(723)).toBe("12:03");
  });

  it("rounds rather than truncating", () => {
    expect(formatDuration(29.6)).toBe("0:30");
  });

  it("returns a dash for nothing usable", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-4)).toBe("—");
  });
});

describe("videoStageLabel", () => {
  it("says queued before it says anything else", () => {
    // A queued job has no worker, so no stage the server sent can be true yet.
    expect(videoStageLabel("rendering", "queued")).toBe("Waiting for a worker…");
  });

  it("maps every stage the worker actually emits", () => {
    // The whole frozen vocabulary — if the server adds an eighth, this test is
    // where the omission shows up first.
    expect(videoStageLabel("downloading", "running")).toBe(
      "Fetching the video…",
    );
    expect(videoStageLabel("probing", "running")).toBe("Reading the video…");
    expect(videoStageLabel("segmenting", "running")).toBe("Finding the cuts…");
    expect(videoStageLabel("reading", "running")).toBe("Reading the artwork…");
    expect(videoStageLabel("rendering", "running")).toBe(
      "Laying it out again…",
    );
    expect(videoStageLabel("uploading", "running")).toBe("Storing the result…");
    expect(videoStageLabel("done", "running")).toBe("Finishing up…");
  });

  it("de-slugs a stage it has never seen instead of lying", () => {
    expect(videoStageLabel("colour_matching", "running")).toBe(
      "Colour matching…",
    );
  });

  it("falls back when there is no stage at all", () => {
    expect(videoStageLabel(null, "running")).toBe("Working…");
    expect(videoStageLabel("", "running")).toBe("Working…");
  });
});

describe("videoProgressPct", () => {
  it("rounds to a whole percent", () => {
    expect(videoProgressPct(41.4)).toBe(41);
  });

  it("clamps both ends", () => {
    expect(videoProgressPct(-3)).toBe(0);
    expect(videoProgressPct(103)).toBe(100);
  });

  it("returns null when there is no number to draw", () => {
    expect(videoProgressPct(null)).toBeNull();
    expect(videoProgressPct(undefined)).toBeNull();
    expect(videoProgressPct(Number.NaN)).toBeNull();
  });
});
```

- [ ] **Step 6: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
```

`npm test` must now report the new `video-fit` suite alongside the existing ones, and `creative-fit.test.ts` must still pass untouched.

---

### Task 3: `api.ts` — the video routes and the large-file upload path

**Files:**
- Modify: `src/lib/api.ts` — the `creativeFit` block at lines 992–1043, plus the type imports at lines 40–46

**Interfaces:**
- Consumes: `putToUploadSession(sessionUri: string, file: File, onProgress?: (percent: number) => void): Promise<void>` — already defined at `src/lib/api.ts:312-337`, module-private and in scope; `probeMediaFile(file: File): Promise<MediaProbe>` from `./media`, already imported at line 6
- Produces: `api.creativeFit.jobs(limit?: number, kind?: FitMediaKind): Promise<FitJobListResponse>`; `api.creativeFit.videoAnalyze(payload: FitAnalyzePayload): Promise<FitVideoAnalyzeResponse>`; `api.creativeFit.videoUploadSession(name: string, sizeBytes: number, contentType: string): Promise<FitVideoUploadSession>`; `api.creativeFit.videoUpload(file: File, onProgress?: (percent: number) => void): Promise<FitVideoSourceUpload>`

- [ ] **Step 1: Import the new types**

In the `import type { … } from "./types";` block (lines 9–76), add these names in place — the list is alphabetical-ish but not strictly, so add them beside the existing `Fit*` entries at lines 41–46:

```ts
  FitAnalyzePayload,
  FitAnalyzeResponse,
  FitJob,
  FitJobListResponse,
  FitMediaKind,
  FitScreenTargetsResponse,
  FitSourceUpload,
  FitVideoAnalyzeResponse,
  FitVideoSourceUpload,
  FitVideoUploadSession,
```

- [ ] **Step 2: Widen `jobs()` without changing what the image page sends**

Before (`src/lib/api.ts:1024-1028`):

```ts
    /** This user's fit history, newest first. */
    jobs: (limit?: number) =>
      request<FitJobListResponse>(
        `/cms/creative-fit/jobs${limit ? `?limit=${limit}` : ""}`,
      ),
```

After:

```ts
    /** This user's fit history, newest first.
     *
     *  `kind` picks the pipeline. It is deliberately optional and deliberately
     *  NOT defaulted here: the backend defaults `kind` to "image", so the image
     *  page's existing `jobs()` call produces the byte-identical request it
     *  produces today — no query string at all — and keeps getting image rows
     *  only. The video page passes "video" and gets its own history. Neither
     *  strip ever shows the other's jobs. */
    jobs: (limit?: number, kind?: FitMediaKind) => {
      const qs = new URLSearchParams();
      if (limit != null) qs.set("limit", String(limit));
      if (kind) qs.set("kind", kind);
      const suffix = qs.toString();
      return request<FitJobListResponse>(
        `/cms/creative-fit/jobs${suffix ? `?${suffix}` : ""}`,
      );
    },
```

The image page at `page.tsx:116` calls `api.creativeFit.jobs()` with no arguments, so `suffix` is `""` and the path is `/cms/creative-fit/jobs` — exactly what it is today. **Do not** edit `page.tsx` to pass `"image"`.

- [ ] **Step 3: Add the three video methods**

Insert these immediately after the `save:` method (which currently ends at line 1042 with `      ),`) and before the closing `  },` of the `creativeFit` object:

```ts
    /** Measure a video against a screen and recommend resize or rebuild.
     *  Creates no job — but it DOES spend an AI call, which is why the video
     *  page puts it behind a button exactly as the image page does. */
    videoAnalyze: (payload: FitAnalyzePayload) =>
      request<FitVideoAnalyzeResponse>("/cms/creative-fit/video/analyze", {
        method: "POST",
        body: payload,
      }),

    /** Authorize a resumable PUT straight to storage for one source video. */
    videoUploadSession: (
      name: string,
      sizeBytes: number,
      contentType: string,
    ) =>
      request<FitVideoUploadSession>("/cms/creative-fit/video/upload-session", {
        method: "POST",
        body: {
          filename: name,
          size_bytes: sizeBytes,
          content_type: contentType,
        },
      }),

    /**
     * Park a source video for fitting.
     *
     * The bytes bypass the API entirely. `creativeFit.upload` proxies the file
     * through `POST /cms/creative-fit/upload` as multipart, which is fine for a
     * 25 MB still and impossible for a 500 MB video: Cloud Run rejects request
     * bodies over 32 MiB, so that path could never carry one however patient
     * the operator was. So: ask the backend for a signed session, PUT the file
     * to storage over XHR (the only transport that reports upload progress),
     * and hand back the storage reference the job payload will quote.
     *
     * Resolution and duration are read off the file locally with the same
     * probe the Content uploader uses — the session response carries no
     * geometry, and the picker needs it to draw the shape and to scan.
     */
    videoUpload: async (
      file: File,
      onProgress?: (percent: number) => void,
    ): Promise<FitVideoSourceUpload> => {
      const probe = await probeMediaFile(file);
      const session = await api.creativeFit.videoUploadSession(
        file.name,
        file.size,
        file.type,
      );
      await putToUploadSession(session.upload_url, file, onProgress);
      return {
        source_url: session.source_url,
        source_name: session.source_name,
        width: probe.width ?? 0,
        height: probe.height ?? 0,
        duration_seconds: probe.durationSeconds,
        mime_type: file.type,
        size_bytes: file.size,
      };
    },
```

Two things not to "fix":

- `putToUploadSession` sends **no** Authorization header and sets `Content-Type: file.type` — the signed URL is itself the capability, and adding a Bearer token would break the signature. It is already written that way; do not change it.
- `videoUpload` referencing `api.creativeFit.videoUploadSession` from inside the `api` object literal **does** compile under `strict` (verified with `tsc --strict` on a reduced case): `videoUpload` carries an explicit return-type annotation, so `api`'s type resolves from the member signatures without inspecting that body, and no circularity arises. Keep it — it means the route string `/cms/creative-fit/video/upload-session` exists in exactly one place. If you ever drop the `: Promise<FitVideoSourceUpload>` annotation this becomes TS7022, so don't.

- [ ] **Step 4: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
git diff "src/lib/api.ts" | grep -E "^-" | grep -v "^---"
```

The last command lists every removed line in `api.ts`: it must show **only** the five lines of the old `jobs:` method and the three replaced type-import lines. Anything else means a non-additive edit slipped in.

---

### Task 4: `VideoSourcePicker` — step 1 for video

**Files:**
- Create: `src/components/creative-fit/video/VideoSourcePicker.tsx`

**Interfaces:**
- Consumes: `api.contentPage({ q, type: "video", limit, offset })`, `api.creativeFit.videoUpload(file, onProgress)`; `createRequestGuard()`, `SEARCH_DEBOUNCE_MS` from `@/lib/use-server-page`; `StepHeader`, `TabButton` from `../SourcePicker` (imported, **not** modified — `TargetPicker.tsx:14` already imports the same two symbols, so this is the established pattern); `orientationOf`, `ratioLabel` from `@/lib/creative-fit`; `formatDuration` from `@/lib/video-fit`
- Produces: `interface ChosenVideoSource { mediaId?: string; url?: string; name: string; width: number; height: number; durationSeconds: number | null; previewUrl: string }`; `VideoSourcePicker(props: { value: ChosenVideoSource | null; onChange: (s: ChosenVideoSource | null) => void; maxUploadMb: number; maxDurationSeconds: number; disabled?: boolean })`

- [ ] **Step 1: Write the component**

Structurally this is `SourcePicker.tsx` with four changes: the library filter is `type: "video"`, the file guard is `video/`, the accept is `video/*`, and every `<img>` is a `<video>`. It gains one thing the image picker has no use for: a progress bar, because a 500 MB upload with no feedback is indistinguishable from a hang.

Create `src/components/creative-fit/video/VideoSourcePicker.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Library, Search, Upload, Video, X } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import type { FitVideoSourceUpload, Media } from "@/lib/types";
import { orientationOf, ratioLabel } from "@/lib/creative-fit";
import { formatDuration } from "@/lib/video-fit";
import { createRequestGuard, SEARCH_DEBOUNCE_MS } from "@/lib/use-server-page";
import { Badge, Button, Input, Spinner } from "@/components/ui";
import { StepHeader, TabButton } from "../SourcePicker";
import { cn } from "@/lib/utils";

/** Thumbnails fetched per request in the Library tab ("Load more" adds a page). */
const LIBRARY_PAGE = 24;

/**
 * A media fragment that makes a browser paint the first frame as a still.
 *
 * There is no poster image anywhere in this system — the API stores a video and
 * nothing else — so the poster IS the first frame, requested by asking for a
 * position slightly past zero. Appended after any signed-URL query string,
 * which is valid: a fragment is always last.
 */
const FIRST_FRAME = "#t=0.1";

/** What the page needs to describe the chosen video to the backend. */
export interface ChosenVideoSource {
  /** Set when picked from the library. */
  mediaId?: string;
  /** Set when freshly uploaded. */
  url?: string;
  name: string;
  width: number;
  height: number;
  /** Null when the browser could not decode the file's metadata. */
  durationSeconds: number | null;
  /** Something the browser can play in the preview. */
  previewUrl: string;
}

type Tab = "upload" | "library";

/**
 * Step 1 — choose the video to refit.
 *
 * Same two routes as the image picker, for the same two real situations: the
 * client's video is already sitting in Content in the wrong shape, or it
 * arrived by email and has never been in the system.
 *
 * The upload half is not the image half with a different accept attribute. A
 * source video is hundreds of megabytes, so it goes straight to storage over a
 * signed PUT with a real progress bar, and the length is checked HERE, before
 * a single byte leaves the browser — discovering at the end of a four-minute
 * upload that the file is twice the duration limit is the worst version of
 * this screen.
 */
export function VideoSourcePicker({
  value,
  onChange,
  maxUploadMb,
  maxDurationSeconds,
  disabled,
}: {
  value: ChosenVideoSource | null;
  onChange: (source: ChosenVideoSource | null) => void;
  maxUploadMb: number;
  maxDurationSeconds: number;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("library");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Library
  const [media, setMedia] = useState<Media[] | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);

  // Server-side search + "load more", scoped to videos — the DB does the type
  // filter, so a library of thousands of stills costs nothing here.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [total, setTotal] = useState(0);
  const guard = useMemo(() => createRequestGuard(), []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  /** Fetch one page. `append` keeps what's on screen (the Load more button). */
  const loadPage = useCallback(
    (offset: number, append: boolean) => {
      const reqId = guard.next();
      setLoadingMedia(true);
      api
        .contentPage({
          q: debouncedQuery,
          type: "video",
          limit: LIBRARY_PAGE,
          offset,
        })
        .then((r) => {
          if (!guard.isCurrent(reqId)) return; // superseded by a newer keystroke
          setMedia((prev) => (append ? [...(prev ?? []), ...r.content] : r.content));
          setTotal(r.total ?? 0);
        })
        .catch((e) => {
          if (!guard.isCurrent(reqId)) return;
          setError(e instanceof ApiError ? e.message : "Could not load your videos.");
        })
        .finally(() => {
          if (guard.isCurrent(reqId)) setLoadingMedia(false);
        });
    },
    [debouncedQuery, guard, setError],
  );

  useEffect(() => {
    if (tab !== "library") return;
    loadPage(0, false);
  }, [tab, loadPage]);

  const visible = media ?? [];
  const hasMore = visible.length < total;

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("video/")) {
      setError("This is the video side — switch to Image for a still.");
      return;
    }
    if (file.size > maxUploadMb * 1024 * 1024) {
      setError(`That video is larger than the ${maxUploadMb}MB limit.`);
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const up: FitVideoSourceUpload = await api.creativeFit.videoUpload(
        file,
        setProgress,
      );
      // The length limit is the backend's, but it is checked here too — after
      // the probe, which is the first moment the browser knows the duration.
      if (
        up.duration_seconds != null &&
        up.duration_seconds > maxDurationSeconds
      ) {
        setError(
          `That video is ${formatDuration(up.duration_seconds)} long — the limit ` +
            `is ${formatDuration(maxDurationSeconds)}. Trim it and try again.`,
        );
        return;
      }
      onChange({
        url: up.source_url,
        name: up.source_name,
        width: up.width,
        height: up.height,
        durationSeconds: up.duration_seconds,
        // The local file plays instantly and needs no signed-URL round trip.
        previewUrl: URL.createObjectURL(file),
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const pickMedia = (m: Media) => {
    if (!m.width || !m.height) {
      setError(
        `“${m.name ?? "That video"}” has no stored dimensions, so it can't be ` +
          "measured. Upload the file directly instead.",
      );
      return;
    }
    setError(null);
    onChange({
      mediaId: m.id,
      name: m.name ?? "Video",
      width: m.width,
      height: m.height,
      durationSeconds: m.duration_seconds ?? null,
      previewUrl: m.file_url,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <StepHeader step={1} title="Choose the video" />

      <div
        role="tablist"
        aria-label="Video source"
        className="mb-3 grid grid-cols-2 gap-1 rounded-[var(--radius-md)] bg-panel-raised p-1"
      >
        <TabButton
          active={tab === "library"}
          onClick={() => setTab("library")}
          icon={<Library className="h-4 w-4" />}
          label="From library"
        />
        <TabButton
          active={tab === "upload"}
          onClick={() => setTab("upload")}
          icon={<Upload className="h-4 w-4" />}
          label="Upload new"
        />
      </div>

      {value ? (
        <ChosenCard source={value} onClear={() => onChange(null)} disabled={disabled} />
      ) : tab === "upload" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border border-dashed px-4 py-10 text-center transition-colors",
            dragging
              ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]"
              : "border-line-strong",
          )}
        >
          {uploading ? (
            // A determinate bar, not a spinner: this upload is measured in
            // minutes and the operator needs to know it is moving.
            <div className="w-full max-w-xs">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200"
                  style={{ width: `${progress ?? 0}%` }}
                />
              </div>
              <p className="mt-1 font-data text-xs text-fg-muted">
                {(progress ?? 0) < 100
                  ? `Uploading… ${progress ?? 0}%`
                  : "Finishing up…"}
              </p>
            </div>
          ) : (
            <>
              <Video className="h-7 w-7 text-fg-subtle" />
              <div>
                <p className="text-sm font-medium text-fg">Drop a video here</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  MP4 or MOV, up to {maxUploadMb}MB and{" "}
                  {formatDuration(maxDurationSeconds)}. Any resolution.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
              >
                Choose file
              </Button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your videos…"
              className="pl-9"
              aria-label="Search videos"
            />
          </div>

          {loadingMedia && visible.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Spinner />
            </div>
          ) : visible.length === 0 ? (
            <p className="flex flex-1 items-center justify-center px-4 py-10 text-center text-sm text-fg-muted">
              {query
                ? `Nothing matches “${query}”.`
                : "No videos in your library yet — upload one instead."}
            </p>
          ) : (
            <div className="thin-scroll -mx-1 max-h-[280px] flex-1 overflow-y-auto px-1">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visible.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => pickMedia(m)}
                    className="group overflow-hidden rounded-[var(--radius-md)] border border-line bg-panel-raised text-left transition-colors hover:border-line-strong focus-visible:border-[var(--primary)]"
                  >
                    <div className="relative aspect-video bg-canvas-subtle">
                      <video
                        src={`${m.file_url}${FIRST_FRAME}`}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-contain"
                      />
                      {m.duration_seconds != null && (
                        <span className="absolute bottom-1 right-1 rounded-[2px] bg-[color-mix(in_oklab,var(--canvas)_75%,transparent)] px-1 font-data text-[10px] text-fg">
                          {formatDuration(m.duration_seconds)}
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="truncate text-xs font-medium text-fg">
                        {m.name ?? "Untitled"}
                      </p>
                      <p className="font-data text-[11px] text-fg-subtle">
                        {m.width && m.height
                          ? `${m.width}×${m.height}`
                          : "size unknown"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {hasMore && (
                <div className="mt-2 flex flex-col items-center gap-1 pb-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={loadingMedia}
                    onClick={() => loadPage(visible.length, true)}
                  >
                    Load more
                  </Button>
                  <p className="text-[11px] text-fg-subtle">
                    Showing {visible.length} of {total}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ChosenCard({
  source,
  onClear,
  disabled,
}: {
  source: ChosenVideoSource;
  onClear: () => void;
  disabled?: boolean;
}) {
  const orientation = orientationOf(source.width, source.height);
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-panel-raised p-3">
      <div className="relative flex min-h-[120px] flex-1 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-canvas-subtle">
        {/* Controls, because the operator's first question about a video is
            "which video is this" and scrubbing answers it in a second. */}
        <video
          src={source.previewUrl}
          controls
          muted
          loop
          playsInline
          preload="metadata"
          className="max-h-[180px] w-full object-contain"
        />
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-fg">
            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--status-online)]" />
            {source.name}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-data text-xs text-fg-muted">
              {source.width}×{source.height}
            </span>
            <Badge tone="gray">{orientation}</Badge>
            <Badge tone="gray">{ratioLabel(source.width, source.height)}</Badge>
            {source.durationSeconds != null && (
              <Badge tone="gray">{formatDuration(source.durationSeconds)}</Badge>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onClear}
          disabled={disabled}
          aria-label="Choose a different video"
          className="shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
```

---

### Task 5: `VideoScanCard` and `VideoVerdictCard`

**Files:**
- Create: `src/components/creative-fit/video/VideoScanCard.tsx`
- Create: `src/components/creative-fit/video/VideoVerdictCard.tsx`

**Interfaces:**
- Consumes: `FitVideoAnalyzeResponse`, `FitJobMode` from `@/lib/types`; `bandTone`, `canRunFit`, `formatPct`, `isFitBusy`, `previewBox`, `ratioLabel`, `type FitStage` from `@/lib/creative-fit`; `formatDuration` from `@/lib/video-fit`
- Produces: `VideoScanCard(props: { ready: boolean; scanning: boolean; error: string | null; onScan: () => void })`; `VideoVerdictCard(props: { result: FitVideoAnalyzeResponse; stage: FitStage; runningMode: FitJobMode | null; elapsed: string | null; stopping: boolean; onResize: () => void; onRebuild: () => void; onStop: () => void; rebuildAvailable: boolean })`

- [ ] **Step 1: The scan gate**

Create `src/components/creative-fit/video/VideoScanCard.tsx`:

```tsx
"use client";

import { ScanLine } from "lucide-react";

import { Button, Card } from "@/components/ui";

/**
 * Step 3 — the scan gate, video side.
 *
 * Explicitly a button and not an effect, for the same reason as the image
 * page: scanning spends an AI call, and firing one the instant a screen is
 * chosen spends one per screen the operator tries. It costs more here — the
 * scan pulls keyframes out of the file first — so it stays a button.
 *
 * This card holds all three pre-verdict faces so the layout never jumps, and
 * is replaced wholesale by the verdict, which is what makes the button
 * "disappear" once it has done its job.
 */
export function VideoScanCard({
  ready,
  scanning,
  error,
  onScan,
}: {
  /** Both a video and a screen are chosen. */
  ready: boolean;
  scanning: boolean;
  error: string | null;
  onScan: () => void;
}) {
  if (!ready) {
    return (
      <Card className="px-4 py-8 text-center sm:px-5">
        <p className="text-sm text-fg-muted">
          Pick a video and a screen size, and we&apos;ll tell you whether it
          needs a resize or a rebuild.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center gap-3 px-4 py-8 text-center sm:px-5">
      <Button
        size="lg"
        onClick={onScan}
        loading={scanning}
        leftIcon={<ScanLine className="h-4 w-4" />}
        className="w-full sm:w-auto"
      >
        {scanning ? "Scanning…" : "Scan this video"}
      </Button>
      <p className="max-w-md text-xs leading-relaxed text-fg-muted">
        {scanning
          ? "Measuring the shape gap and reading a few frames — this takes longer than a still."
          : "We'll measure how much a crop would cost you and have the AI read a few frames, then recommend a resize or a rebuild. Nothing is rendered yet."}
      </p>
      {error && !scanning && (
        <p className="text-xs leading-relaxed text-danger">{error}</p>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: The verdict**

Create `src/components/creative-fit/video/VideoVerdictCard.tsx`. Same card, same two buttons, same lock behaviour; it adds one row of video facts (length, fps, cuts) and the AI's motion note, because on a video "a crop keeps 32%" is not the whole story — *what moves* through that 32% is:

```tsx
"use client";

import { AlertTriangle, Crop, Sparkles, Square, Wand2 } from "lucide-react";

import type { FitJobMode, FitVideoAnalyzeResponse } from "@/lib/types";
import {
  bandTone,
  canRunFit,
  formatPct,
  isFitBusy,
  previewBox,
  ratioLabel,
  type FitStage,
} from "@/lib/creative-fit";
import { formatDuration } from "@/lib/video-fit";
import { Badge, Button } from "@/components/ui";

/**
 * The verdict — video side.
 *
 * Leads with the same number the image page leads with, because it settles the
 * same argument: how much of the ad a crop would keep. What is added is the
 * part that is only true of video — how long it is, how many cuts it has, and
 * whatever the AI noticed about the motion. A 45-second film with nine cuts is
 * a different rebuild proposition from a 6-second static end-card, and the
 * operator deserves to see that before spending fifteen minutes of worker time.
 *
 * While a job runs, neither button moves or disappears: the clicked one stays
 * where it is wearing the timer, the other greys out beside it.
 */
export function VideoVerdictCard({
  result,
  stage,
  runningMode,
  elapsed,
  stopping,
  onResize,
  onRebuild,
  onStop,
  rebuildAvailable,
}: {
  result: FitVideoAnalyzeResponse;
  stage: FitStage;
  /** Which button owns the running job, so only that one shows the timer. */
  runningMode: FitJobMode | null;
  /** Pre-formatted "m:ss"; null unless a job is on the clock. */
  elapsed: string | null;
  stopping: boolean;
  onResize: () => void;
  onRebuild: () => void;
  onStop: () => void;
  rebuildAvailable: boolean;
}) {
  const a = result.analysis;
  const f = result.facts;
  const wantsRebuild = a.recommendation === "rebuild";
  const noLoss = a.band === "identical";

  const busy = isFitBusy(stage);
  const canRun = canRunFit(stage);
  const waiting = stage === "queued";

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-panel">
      {/* ── Header: the two shapes, and the verdict badge ──────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-4 py-3 sm:px-5">
        <ShapePair
          sw={a.source_width}
          sh={a.source_height}
          tw={a.target_width}
          th={a.target_height}
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <Badge tone={bandTone(a.band)}>
              {noLoss ? "Same shape" : `Keeps ${formatPct(a.content_kept_pct)}`}
            </Badge>
            {a.orientation_flipped && <Badge tone="red">Orientation flips</Badge>}
            {result.ai_reviewed ? (
              <Badge tone="blue">
                <Sparkles className="h-3 w-3" /> AI reviewed
              </Badge>
            ) : (
              <Badge tone="gray">Measured</Badge>
            )}
          </p>
          <p className="mt-1.5 font-data text-xs text-fg-muted">
            {a.source_width}×{a.source_height} {ratioLabel(a.source_width, a.source_height)}
            <span className="mx-1.5 text-fg-subtle">→</span>
            {a.target_width}×{a.target_height} {ratioLabel(a.target_width, a.target_height)}
          </p>
        </div>
      </div>

      {/* ── What the file actually is ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5 sm:px-5">
        <Badge tone="gray">{formatDuration(f.duration_seconds)}</Badge>
        <Badge tone="gray">{Math.round(f.fps)} fps</Badge>
        <Badge tone="gray">
          {/* 0 means "not segmented yet" — /video/analyze cannot count shots
              without a full decode pass, so it reports 0 and the worker fills
              in the real number. Never render the digit 0 here; it would read
              as "this film has no cuts", which is a different claim. */}
          {f.shot_count > 0
            ? `${f.shot_count} ${f.shot_count === 1 ? "shot" : "shots"}`
            : "—"}
        </Badge>
        {f.has_audio && <Badge tone="gray">Has audio</Badge>}
        {f.color_inferred && (
          // Untagged colour is the usual cause of a result that "looks washed
          // out" — say so up front rather than fielding it afterwards.
          <Badge tone="amber">Colour inferred</Badge>
        )}
      </div>

      {/* ── The reason, in the client's language ───────────────────────── */}
      <div className="px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-fg">{a.reason}</p>

        {result.motion_note && (
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            {result.motion_note}
          </p>
        )}

        {a.warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {a.warnings.map((w, i) => (
              <li
                key={i}
                className="flex gap-2 text-xs leading-relaxed text-fg-muted"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-warn)]" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── The two ways forward ───────────────────────────────────────── */}
      <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-xs text-fg-subtle">
          {busy
            ? "You can stop this at any time."
            : wantsRebuild
              ? "Resizing is still available if you'd rather crop."
              : "Rebuilding is still available if the crop clips something."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant={wantsRebuild ? "secondary" : "primary"}
            onClick={onResize}
            disabled={!canRun}
            loading={busy && runningMode === "resize"}
            leftIcon={<Crop className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            {busy && runningMode === "resize" ? (
              <BusyLabel
                label={waiting ? "Waiting for a worker…" : "Resizing…"}
                elapsed={elapsed}
              />
            ) : (
              <>
                {noLoss ? "Resize to fit" : "Resize anyway"}
                {!wantsRebuild && !busy && (
                  <span className="ml-1 text-[10px] opacity-70">recommended</span>
                )}
              </>
            )}
          </Button>
          <Button
            variant={wantsRebuild ? "primary" : "secondary"}
            onClick={onRebuild}
            disabled={!canRun || !rebuildAvailable}
            loading={busy && runningMode === "rebuild"}
            title={
              rebuildAvailable
                ? undefined
                : "AI rebuild isn't configured on this server."
            }
            leftIcon={<Wand2 className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            {busy && runningMode === "rebuild" ? (
              <BusyLabel
                label={waiting ? "Waiting for a worker…" : "Rebuilding…"}
                elapsed={elapsed}
              />
            ) : (
              <>
                Rebuild with AI
                {wantsRebuild && !busy && (
                  <span className="ml-1 text-[10px] opacity-70">recommended</span>
                )}
              </>
            )}
          </Button>
          {busy && (
            <Button
              variant="ghost"
              onClick={onStop}
              loading={stopping}
              leftIcon={<Square className="h-3.5 w-3.5" />}
              className="w-full sm:w-auto"
              title={
                waiting
                  ? "Stops it before any work starts."
                  : "Stops it now. Anything already rendered is thrown away."
              }
            >
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The label on a locked button: the real stage, then the clock.
 *
 * `tabular-nums` matters — proportional digits change width as the seconds
 * tick, and a video job runs for minutes, so the button would twitch a
 * thousand times.
 */
function BusyLabel({
  label,
  elapsed,
}: {
  label: string;
  elapsed: string | null;
}) {
  return (
    <span className="flex items-center gap-2">
      {label}
      {elapsed && (
        <span className="font-data text-[11px] tabular-nums opacity-70">
          {elapsed}
        </span>
      )}
    </span>
  );
}

/** The source frame with the cover-crop window drawn inside it. A percentage
 *  is abstract; seeing two thirds of the frame greyed out is not. */
function ShapePair({
  sw,
  sh,
  tw,
  th,
}: {
  sw: number;
  sh: number;
  tw: number;
  th: number;
}) {
  const box = previewBox(sw, sh, 76, 52);
  const sourceRatio = sw / sh;
  const targetRatio = tw / th;
  // Cover crop keeps the full short axis and trims the long one.
  const keptW = sourceRatio > targetRatio ? targetRatio / sourceRatio : 1;
  const keptH = sourceRatio > targetRatio ? 1 : sourceRatio / targetRatio;

  return (
    <div
      aria-hidden
      className="relative shrink-0 rounded-[3px] border border-line-strong bg-canvas-subtle"
      style={{ width: box.width, height: box.height }}
    >
      <span
        className="absolute rounded-[2px] border-2"
        style={{
          width: `${keptW * 100}%`,
          height: `${keptH * 100}%`,
          left: `${((1 - keptW) / 2) * 100}%`,
          top: `${((1 - keptH) / 2) * 100}%`,
          borderColor: "var(--primary)",
          backgroundColor:
            "color-mix(in oklab, var(--primary) 18%, transparent)",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
```

---

### Task 6: `VideoResultPreview` — the result that plays

**Files:**
- Create: `src/components/creative-fit/video/VideoResultPreview.tsx`

**Interfaces:**
- Consumes: `FitJob` from `@/lib/types`; `elapsedSince`, `formatBytes`, `formatElapsed`, `previewBox` from `@/lib/creative-fit`; `formatDuration`, `videoProgressPct`, `videoStageLabel` from `@/lib/video-fit`
- Produces: `VideoResultPreview(props: { job: FitJob; sourcePreviewUrl?: string | null; saving: boolean; savedMediaId?: string | null; retentionHours?: number; onSave: () => void; onRedo: () => void })`

- [ ] **Step 1: Write the component**

Two departures from the image version, both deliberate. **One:** `RunningState` is a determinate bar with a stage label, because an image fit takes 20–60 seconds and a video fit takes minutes — a bare spinner for that long reads as a hang. **Two:** each `Frame` renders a `<video controls muted loop playsInline>` sized by `previewBox` to the result's exact aspect and given `object-cover`, so the picture **fills** its frame edge to edge. A `<video>` left to its own devices letterboxes itself, and the whole point of this panel is showing the operator the new shape full-bleed.

Create `src/components/creative-fit/video/VideoResultPreview.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Download,
  Library,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";

import type { FitJob } from "@/lib/types";
import {
  elapsedSince,
  formatBytes,
  formatElapsed,
  previewBox,
} from "@/lib/creative-fit";
import {
  formatDuration,
  videoProgressPct,
  videoStageLabel,
} from "@/lib/video-fit";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A media fragment that makes a browser paint the first frame as a still.
 * There is no poster asset in this system — the poster IS the first frame.
 */
const FIRST_FRAME = "#t=0.1";

/**
 * Step 4 — what came back.
 *
 * Before and after, side by side, each drawn in its own real aspect box and
 * each playable, because a video fit cannot be judged from a still: the whole
 * question is whether the motion still works in the new shape. Nothing is
 * saved to the Content library automatically — it has been re-rendered, so a
 * human watches it before it can be booked onto a public screen.
 */
export function VideoResultPreview({
  job,
  sourcePreviewUrl,
  saving,
  savedMediaId,
  retentionHours,
  onSave,
  onRedo,
}: {
  job: FitJob;
  sourcePreviewUrl?: string | null;
  saving: boolean;
  savedMediaId?: string | null;
  retentionHours?: number;
  onSave: () => void;
  onRedo: () => void;
}) {
  const running = job.status === "queued" || job.status === "running";
  const failed = job.status === "failed";
  const cancelled = job.status === "cancelled";
  const rebuild = job.mode === "rebuild";

  if (running) return <RunningState job={job} />;

  if (cancelled) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-line bg-panel px-4 py-5 sm:px-5">
        <p className="flex items-start gap-2 text-sm text-fg">
          <Square className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
          <span>
            <span className="font-medium">Stopped.</span> Nothing was rendered
            or saved — pick the other option, or run it again.
          </span>
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            onClick={onRedo}
            leftIcon={<RotateCcw className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            Start over
          </Button>
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--status-danger)_35%,transparent)] bg-panel px-4 py-5 sm:px-5">
        <p className="flex items-start gap-2 text-sm text-fg">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>
            <span className="font-medium">That didn&apos;t work.</span>{" "}
            {job.error ?? "The fit could not be completed."}
          </span>
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            onClick={onRedo}
            leftIcon={<RotateCcw className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const exact =
    job.result_width === job.target_width &&
    job.result_height === job.target_height;

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Check className="h-4 w-4 text-[var(--status-online)]" />
          {rebuild ? "Rebuilt for this screen" : "Resized for this screen"}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {rebuild && (
            <Badge tone="blue">
              <Sparkles className="h-3 w-3" /> AI
            </Badge>
          )}
          <Badge tone={exact ? "green" : "amber"}>
            {job.result_width}×{job.result_height}
            {exact ? "" : " (off target)"}
          </Badge>
          {job.duration_seconds != null && (
            <Badge tone="gray">{formatDuration(job.duration_seconds)}</Badge>
          )}
          <Badge tone="gray">{formatBytes(job.result_bytes)}</Badge>
        </div>
      </div>

      {/* Before / after. Stacks on mobile — side by side from sm up. */}
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
        <Frame
          label="Before"
          sublabel={`${job.source_width}×${job.source_height}`}
          url={sourcePreviewUrl ?? job.source_url}
          width={job.source_width}
          height={job.source_height}
        />
        <Frame
          label="After"
          sublabel={`${job.result_width}×${job.result_height}`}
          url={job.result_url}
          width={job.result_width ?? job.target_width}
          height={job.result_height ?? job.target_height}
          highlight
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-xs text-fg-subtle">
          {savedMediaId ? (
            "Saved — it's in Content and ready to book."
          ) : (
            <>
              {rebuild
                ? "Watch it through, then keep it: "
                : "Keep it: "}
              <span className="text-fg-muted">
                this fit is cleared after {retentionHours ?? 48} hours unless you
                download it or save it to Content.
              </span>
            </>
          )}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="ghost"
            onClick={onRedo}
            leftIcon={<RotateCcw className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            Redo
          </Button>
          <DownloadButton
            url={job.result_url}
            filename={`${job.source_name ?? "creative"}-${job.target_width}x${job.target_height}`}
          />
          <Button
            onClick={onSave}
            loading={saving}
            disabled={!!savedMediaId}
            leftIcon={<Library className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            {savedMediaId ? "Saved to Content" : "Save to Content"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One labelled frame, playable, drawn at its true aspect ratio.
 *
 * The `<video>` element is sized by previewBox to the clip's exact aspect and
 * then told `object-cover`. Both halves matter: a `<video>` defaults to
 * `object-fit: contain`, so an element box that disagreed with the clip by even
 * a pixel would paint black bars inside a frame whose entire job is to show the
 * operator the new shape filled edge to edge.
 */
function Frame({
  label,
  sublabel,
  url,
  width,
  height,
  highlight,
}: {
  label: string;
  sublabel: string;
  url?: string | null;
  width: number;
  height: number;
  highlight?: boolean;
}) {
  // A fixed 240px stage: a portrait result renders tall and narrow inside it,
  // a landscape one short and wide, so the reshape reads at a glance.
  const box = previewBox(width, height, 240, 240);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {label}
        </span>
        <span className="font-data text-[11px] text-fg-muted">{sublabel}</span>
      </div>
      <div
        className={cn(
          "flex h-[248px] items-center justify-center rounded-[var(--radius-md)] border bg-canvas-subtle p-2",
          highlight ? "border-[var(--primary)]" : "border-line",
        )}
      >
        {url ? (
          <video
            src={`${url}${FIRST_FRAME}`}
            controls
            muted
            loop
            playsInline
            preload="metadata"
            style={{ width: box.width, height: box.height }}
            className="rounded-[2px] object-cover shadow-[var(--elev-1)]"
          />
        ) : (
          <span className="text-xs text-fg-subtle">No preview</span>
        )}
      </div>
    </div>
  );
}

/**
 * Progress while a worker has it.
 *
 * A determinate bar, unlike the image path's spinner, because this runs for
 * minutes: the operator needs to see both that it is moving and what it is
 * doing. The elapsed clock is measured from the job's own created_at, so
 * reopening a running job from the history strip shows its real age instead of
 * restarting from zero.
 */
function RunningState({ job }: { job: FitJob }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pct = videoProgressPct(job.progress);
  const label = videoStageLabel(job.stage, job.status);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-line bg-panel px-4 py-10 text-center">
      <div className="w-full max-w-sm">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          {pct === null ? (
            // No number yet: a pulsing full-width track says "alive, no
            // estimate", which is honest. A bar parked at 0% says "stuck".
            <div className="h-full w-full animate-pulse rounded-full bg-[color-mix(in_oklab,var(--primary)_35%,transparent)]" />
          ) : (
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <p className="mt-2 text-sm font-medium text-fg">{label}</p>
        <p className="mt-1 text-xs text-fg-muted">
          Re-rendering every frame at full resolution. A video fit usually takes
          several minutes.
        </p>
      </div>
      <p className="font-data text-[11px] tabular-nums text-fg-subtle">
        {pct !== null && `${pct}% · `}
        {formatElapsed(elapsedSince(job.created_at, now))}
      </p>
    </div>
  );
}

/**
 * Download the finished file.
 *
 * Fetches to a blob first so the browser saves it with a sensible name. Storage
 * URLs are cross-origin, and if CORS blocks the fetch the `download` attribute
 * would be ignored anyway — so the fallback opens it in a new tab, where the
 * operator can still save it. Never leaves them with a dead button.
 */
function DownloadButton({
  url,
  filename,
}: {
  url?: string | null;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!url) return;
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      // The encoder emits H.264 in MP4; webm is only ever a hand-supplied
      // source that came back through untouched.
      const ext = blob.type === "video/webm" ? "webm" : "mp4";
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${filename}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      onClick={download}
      loading={busy}
      disabled={!url}
      leftIcon={<Download className="h-4 w-4" />}
      className="w-full sm:w-auto"
    >
      Download
    </Button>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
```

---

### Task 7: `VideoSaveToContentModal`, `VideoJobHistory` and `VideoResizeControls`

**Files:**
- Create: `src/components/creative-fit/video/VideoSaveToContentModal.tsx`
- Create: `src/components/creative-fit/video/VideoJobHistory.tsx`
- Create: `src/components/creative-fit/video/VideoResizeControls.tsx`

**Interfaces:**
- Consumes: `FitJob` from `@/lib/types`; `formatBytes`, `previewBox` from `@/lib/creative-fit`; `formatDuration` from `@/lib/video-fit`; `formatDateTime`, `cn` from `@/lib/utils`; `Button`, `FormField`, `Input`, `Modal`, `Spinner` from `@/components/ui`; `FitAnchor`, `FitMode` from `@/lib/types`
- Produces: `VideoSaveToContentModal(props: { job: FitJob | null; open: boolean; saving: boolean; onClose: () => void; onSave: (name: string) => void })`; `VideoJobHistory(props: { jobs: FitJob[]; activeId?: string | null; retentionHours?: number; onOpen: (job: FitJob) => void })`; `VideoResizeOptions { mode: "cover" | "stretch"; anchor: FitAnchor }`, `DEFAULT_VIDEO_RESIZE_OPTIONS`, `VideoResizeControls(props: { value: VideoResizeOptions; onChange: (next: VideoResizeOptions) => void; disabled?: boolean })`

- [ ] **Step 1: The save modal**

One substantive copy change from the image version: the line at `SaveToContentModal.tsx:98` reads `Image · plays for the screen's slot duration`. That is false for a video — a video plays its full length, and the slot is sized around it — so the video modal states the real rule and the real length.

Create `src/components/creative-fit/video/VideoSaveToContentModal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import type { FitJob } from "@/lib/types";
import { formatBytes, previewBox } from "@/lib/creative-fit";
import { formatDuration } from "@/lib/video-fit";
import { Button, FormField, Input, Modal } from "@/components/ui";

const FIRST_FRAME = "#t=0.1";

/**
 * "Add media" for a finished video fit — the same modal the Content page uses
 * to add a creative, minus the file picker.
 *
 * The file is already rendered and already in storage, so the only thing left
 * to decide is what it's called. That matters more than it looks: the library
 * ends up holding several shapes of the same campaign, and "Diwali film —
 * 1080×1920" versus "Diwali film — 1920×1080" is how an operator picks the
 * right one when they're booking a screen weeks later.
 */
export function VideoSaveToContentModal({
  job,
  open,
  saving,
  onClose,
  onSave,
}: {
  job: FitJob | null;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");

  // Prefill with the same label the backend would generate, so accepting the
  // default and typing your own are both one action.
  useEffect(() => {
    if (!open || !job) return;
    setName(
      `${job.source_name || "Video"} — ${job.target_width}×${job.target_height}`,
    );
  }, [open, job]);

  if (!job) return null;

  const width = job.result_width ?? job.target_width;
  const height = job.result_height ?? job.target_height;
  const box = previewBox(width, height, 150, 150);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    onSave(name.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add media"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => submit()} loading={saving}>
            Add
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormField
          label="File"
          hint={`Already ${job.mode === "rebuild" ? "rebuilt" : "resized"} for this screen — nothing to upload.`}
        >
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-line bg-panel-raised p-3">
            <span className="flex h-[150px] w-[150px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-canvas-subtle">
              {job.result_url ? (
                <video
                  src={`${job.result_url}${FIRST_FRAME}`}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  style={{ width: box.width, height: box.height }}
                  className="rounded-[2px] object-cover shadow-[var(--elev-1)]"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block font-data text-xs text-fg">
                {width}×{height}
              </span>
              <span className="block font-data text-xs text-fg-muted">
                {formatDuration(job.duration_seconds)} ·{" "}
                {formatBytes(job.result_bytes)}
              </span>
              <span className="block text-xs text-fg-subtle">
                Video · plays for its full length
              </span>
            </span>
          </div>
        </FormField>

        <FormField
          label="Name"
          hint="A label for this video. The screen size is included by default so you can tell the shapes apart later."
        >
          <Input
            type="text"
            autoFocus
            placeholder="Name this content"
            value={name}
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: The history strip**

Create `src/components/creative-fit/video/VideoJobHistory.tsx`:

```tsx
"use client";

import { Check, Clock, Library, Sparkles, Square, X } from "lucide-react";

import type { FitJob } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { previewBox } from "@/lib/creative-fit";
import { formatDuration } from "@/lib/video-fit";
import { Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const FIRST_FRAME = "#t=0.1";

/**
 * Past video fits — a horizontal strip under the workbench.
 *
 * Fed by `api.creativeFit.jobs(limit, "video")`, so it shows video jobs and
 * nothing else; the image page's strip stays image-only for the mirror-image
 * reason (its call passes no `kind`, and the backend defaults to "image").
 *
 * This is scratch space, not storage: an unsaved fit is deleted with its files
 * after the retention window. The deadline is stated here rather than left to
 * be discovered, because the two ways to keep something are one click away
 * right up until they aren't.
 */
export function VideoJobHistory({
  jobs,
  activeId,
  retentionHours,
  onOpen,
}: {
  jobs: FitJob[];
  activeId?: string | null;
  retentionHours?: number;
  onOpen: (job: FitJob) => void;
}) {
  if (jobs.length === 0) return null;

  const hours = retentionHours ?? 48;
  return (
    <section aria-label="Recent video fits">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Recent video fits
        </h2>
        <p className="text-[11px] text-fg-muted">
          Cleared after {hours} hours — download a fit or save it to Content to
          keep it. Anything already saved to Content stays.
        </p>
      </div>
      <div className="thin-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {jobs.map((job) => (
          <HistoryCard
            key={job.id}
            job={job}
            active={job.id === activeId}
            hours={hours}
            onOpen={() => onOpen(job)}
          />
        ))}
      </div>
    </section>
  );
}

/** Hours left before this fit is swept, or null once it's been saved. */
function hoursLeft(job: FitJob, hours: number): number | null {
  if (job.result_media_id) return null; // saved — it belongs to Content now
  const created = new Date(job.created_at).getTime();
  if (Number.isNaN(created)) return null;
  const left = (created + hours * 3600_000 - Date.now()) / 3600_000;
  return Math.max(0, left);
}

function HistoryCard({
  job,
  active,
  hours,
  onOpen,
}: {
  job: FitJob;
  active: boolean;
  hours: number;
  onOpen: () => void;
}) {
  const box = previewBox(job.target_width, job.target_height, 44, 44);
  const running = job.status === "queued" || job.status === "running";
  const saved = !!job.result_media_id;
  const left = hoursLeft(job, hours);
  // Only nag near the end — a fresh fit showing "expires in 47h" is noise.
  const expiringSoon = left !== null && left < 12 && job.status === "done";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-[212px] shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-2.5 py-2 text-left transition-colors",
        active
          ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]"
          : "border-line bg-panel hover:border-line-strong",
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-canvas-subtle">
        {job.result_url ? (
          <video
            src={`${job.result_url}${FIRST_FRAME}`}
            muted
            playsInline
            preload="metadata"
            style={{ width: box.width, height: box.height }}
            className="rounded-[2px] object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="block rounded-[2px] border border-line-strong"
            style={{ width: box.width, height: box.height }}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate text-xs font-medium text-fg">
          {job.mode === "rebuild" && (
            <Sparkles className="h-3 w-3 shrink-0 text-[var(--primary)]" />
          )}
          {job.source_name ?? "Video"}
        </span>
        <span className="block font-data text-[11px] text-fg-muted">
          {job.target_width}×{job.target_height}
          {job.duration_seconds != null &&
            ` · ${formatDuration(job.duration_seconds)}`}
        </span>
        {saved ? (
          <span className="flex items-center gap-1 text-[10px] text-[var(--status-online)]">
            <Library className="h-2.5 w-2.5" /> In Content
          </span>
        ) : expiringSoon ? (
          <span className="block text-[10px] text-[var(--status-warn)]">
            {left! < 1
              ? "Clears within the hour"
              : `Clears in ${Math.round(left!)}h`}
          </span>
        ) : (
          <span className="block truncate text-[10px] text-fg-subtle">
            {formatDateTime(job.created_at)}
          </span>
        )}
      </span>

      <span
        className="shrink-0"
        title={
          job.status === "cancelled"
            ? "Stopped by you"
            : (job.error ?? job.status)
        }
      >
        {running ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : job.status === "done" ? (
          <Check className="h-3.5 w-3.5 text-[var(--status-online)]" />
        ) : job.status === "failed" ? (
          <X className="h-3.5 w-3.5 text-danger" />
        ) : job.status === "cancelled" ? (
          // Muted, not red: stopping was intentional, not a failure.
          <Square className="h-3 w-3 text-fg-subtle" />
        ) : (
          <Clock className="h-3.5 w-3.5 text-fg-subtle" />
        )}
      </span>
    </button>
  );
}
```

- [ ] **Step 3: The resize controls, minus the letterbox**

This is the one component where the video version deliberately offers the operator **less** than the image version, and the reason is a direct user instruction: *"I don't want to create a white space. We have to make it as it is."*

`ResizeControls.tsx` offers three modes. `contain` scales the whole ad down until it fits and then fills the leftover with a blurred or solid backdrop — that is letterboxing, and on the video path it is ruled out. So this duplicate drops the `contain` tile, the whole `FILLS` pill row, and the colour input with it. What remains is `cover` (with the same 3×3 anchor grid) and `stretch`.

Everything else is copied class-for-class from `ResizeControls.tsx` so the two controls are visually the same control with one option fewer — same `grid gap-1.5`, same border and `color-mix` active treatment, same anchor grid, same warning panel on stretch. The grid drops to `sm:grid-cols-2` because there are two tiles, not three.

Create `src/components/creative-fit/video/VideoResizeControls.tsx`:

```tsx
"use client";

import { Crop, Move } from "lucide-react";

import type { FitAnchor } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The video path's fit options.
 *
 * Deliberately NOT `ResizeOptions` from the image control: there is no
 * `padFill`/`padColor` here because there are never bars to fill, and `mode` is
 * narrowed to two values so a `contain` cannot be constructed at all. The
 * backend 422s a `contain` on a video job; this type means the CMS can never
 * send one in the first place.
 */
export interface VideoResizeOptions {
  mode: "cover" | "stretch";
  anchor: FitAnchor;
}

export const DEFAULT_VIDEO_RESIZE_OPTIONS: VideoResizeOptions = {
  mode: "cover",
  anchor: "center",
};

const MODES: {
  key: VideoResizeOptions["mode"];
  label: string;
  hint: string;
  icon: typeof Crop;
}[] = [
  {
    key: "cover",
    label: "Crop to fill",
    hint: "Fills the panel edge to edge. Trims whatever overflows.",
    icon: Crop,
  },
  {
    key: "stretch",
    label: "Stretch",
    hint: "Fills the panel by distorting the picture. Rarely what you want.",
    icon: Move,
  },
];

const ANCHORS: FitAnchor[][] = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
];

/**
 * Resize options for video — the no-AI path's controls.
 *
 * The image control has a third mode, "Fit whole ad", which pads the leftover
 * space with a blurred or solid backdrop. It is absent here on purpose: bars on
 * a physical panel are the one outcome the operator has ruled out. A shape gap
 * too wide to crop is what "Rebuild with AI" is for — it re-composes the film
 * onto a full-bleed brand-coloured card instead of framing it in black.
 */
export function VideoResizeControls({
  value,
  onChange,
  disabled,
}: {
  value: VideoResizeOptions;
  onChange: (next: VideoResizeOptions) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<VideoResizeOptions>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          How to fit it
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {MODES.map((m) => {
            const active = value.mode === m.key;
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                type="button"
                disabled={disabled}
                onClick={() => set({ mode: m.key })}
                aria-pressed={active}
                className={cn(
                  "rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]"
                    : "border-line bg-panel-raised hover:border-line-strong",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {m.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-fg-muted">
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {value.mode === "cover" && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            Keep this part
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Crop anchor"
              className="grid w-fit grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-line bg-panel-raised p-1"
            >
              {ANCHORS.flat().map((a) => {
                const active = value.anchor === a;
                return (
                  <button
                    key={a}
                    type="button"
                    disabled={disabled}
                    onClick={() => set({ anchor: a })}
                    aria-label={a.replace("-", " ")}
                    aria-pressed={active}
                    className={cn(
                      "h-7 w-7 rounded-[var(--radius-sm)] transition-colors",
                      active ? "bg-accent" : "bg-canvas-subtle hover:bg-panel",
                    )}
                  >
                    <span
                      className={cn(
                        "mx-auto block h-1.5 w-1.5 rounded-full",
                        active ? "bg-[var(--primary-ink)]" : "bg-fg-subtle",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <p className="max-w-[220px] text-[11px] leading-snug text-fg-muted">
              Move this if the crop would clip your logo or your call-to-action.
            </p>
          </div>
        </div>
      )}

      {value.mode === "stretch" && (
        <p className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--status-warn)_35%,transparent)] bg-[color-mix(in_oklab,var(--status-warn)_8%,transparent)] px-3 py-2 text-xs leading-relaxed text-fg-muted">
          Stretching distorts faces, logos and type. It only looks acceptable
          when the two shapes are already very close.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
```

Then confirm the image control was not touched and the video one never offers a bar:

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
git diff --stat src/components/creative-fit/ResizeControls.tsx
grep -c "contain\|padFill\|padColor" src/components/creative-fit/video/VideoResizeControls.tsx
```

Expected: the first prints nothing (the image control is unmodified), the second prints `0`.

---

### Task 8: `video/page.tsx` — the video flow

**Files:**
- Create: `src/app/(dashboard)/creative-fit/video/page.tsx`

**Interfaces:**
- Consumes: every component from Tasks 4–7; `TargetPicker`, `type ChosenTarget` from `@/components/creative-fit/TargetPicker` **unchanged**; `DEFAULT_VIDEO_RESIZE_OPTIONS`, `VideoResizeControls`, `type VideoResizeOptions` from `@/components/creative-fit/video/VideoResizeControls` (Task 7 — **not** the image path's `ResizeControls`, which this page must never import); `canRunFit`, `elapsedSince`, `fitStage`, `formatElapsed`, `isFitBusy`, `isFitLocked` from `@/lib/creative-fit` **unchanged**; `api.creativeFit.{status, videoAnalyze, createJob, job, cancelJob, save, jobs}`
- Produces: default-exported `VideoCreativeFitPage()`

- [ ] **Step 1: Write the page**

The state machine is *the same one*: `fitStage()` is fed the same six inputs and returns the same nine stages, so exactly one thing is clickable at a time on this page for the same reason it is on the image page. The three differences are `media_kind: "video"` on the create payload, `videoAnalyze` instead of `analyze`, and `jobs(undefined, "video")` for the history.

Create `src/app/(dashboard)/creative-fit/video/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Settings2, Sparkles, Wand2 } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import type {
  CreateFitJobPayload,
  CreativeFitStatus,
  FitAnalyzePayload,
  FitJob,
  FitJobMode,
  FitVideoAnalyzeResponse,
} from "@/lib/types";
import { useToast } from "@/components/Toast";
import { Card, Textarea } from "@/components/ui";
import {
  canRunFit,
  elapsedSince,
  fitStage,
  formatElapsed,
  isFitBusy,
  isFitLocked,
} from "@/lib/creative-fit";
import {
  VideoSourcePicker,
  type ChosenVideoSource,
} from "@/components/creative-fit/video/VideoSourcePicker";
import { TargetPicker, type ChosenTarget } from "@/components/creative-fit/TargetPicker";
import { VideoScanCard } from "@/components/creative-fit/video/VideoScanCard";
import { VideoVerdictCard } from "@/components/creative-fit/video/VideoVerdictCard";
import {
  DEFAULT_VIDEO_RESIZE_OPTIONS,
  VideoResizeControls,
  type VideoResizeOptions,
} from "@/components/creative-fit/video/VideoResizeControls";
import { VideoResultPreview } from "@/components/creative-fit/video/VideoResultPreview";
import { VideoSaveToContentModal } from "@/components/creative-fit/video/VideoSaveToContentModal";
import { VideoJobHistory } from "@/components/creative-fit/video/VideoJobHistory";
import { cn } from "@/lib/utils";

/** How often a running job is polled. Same cadence as the image page — a video
 *  job reports a progress percentage, and a bar that only moves every ten
 *  seconds looks stuck even when it isn't. */
const POLL_MS = 2000;

/**
 * Creative Fit — video.
 *
 * Same workbench, same three deliberate steps (**scan → fit → result**), same
 * derived `fitStage` governing what is clickable, because the operator's
 * problem is identical: a finished ad built for one shape has to play on a
 * panel of another shape. What differs is underneath — the source is hundreds
 * of megabytes and goes straight to storage, the scan reads keyframes, and the
 * render takes minutes rather than seconds, so the result panel counts up with
 * a real percentage instead of spinning.
 *
 * Deliberately a separate route and a separate component tree from the image
 * page rather than one page with a `kind` flag: the two pipelines share a
 * screen picker and nothing else, and the image path is frozen.
 */
export default function VideoCreativeFitPage() {
  const { toast } = useToast();

  const [status, setStatus] = useState<CreativeFitStatus | null>(null);
  const [source, setSource] = useState<ChosenVideoSource | null>(null);
  const [target, setTarget] = useState<ChosenTarget | null>(null);

  const [analysis, setAnalysis] = useState<FitVideoAnalyzeResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [resizeOptions, setResizeOptions] = useState<VideoResizeOptions>(
    DEFAULT_VIDEO_RESIZE_OPTIONS,
  );
  const [showResizeOptions, setShowResizeOptions] = useState(false);
  const [userNote, setUserNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const [job, setJob] = useState<FitJob | null>(null);
  // Which job (if any) the pickers above actually produced. Only that job may
  // borrow the picker's local preview for its "Before" frame.
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMediaId, setSavedMediaId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const [history, setHistory] = useState<FitJob[]>([]);

  // Guards a stale analyze response from overwriting a newer one when the
  // operator changes screen mid-flight.
  const analyzeSeq = useRef(0);

  const refreshHistory = useCallback(async () => {
    try {
      // "video" is what keeps this strip and the image page's strip disjoint.
      const r = await api.creativeFit.jobs(undefined, "video");
      setHistory(r.jobs);
    } catch {
      /* the strip is a convenience — never block the page on it */
    }
  }, []);

  useEffect(() => {
    api.creativeFit
      .status()
      .then(setStatus)
      .catch(() => setStatus(null));
    void refreshHistory();
  }, [refreshHistory]);

  // ── Any input change discards the verdict ──────────────────────────────
  // A scan measures one specific video against one specific screen. The moment
  // either changes the old reading is not stale, it is wrong.
  useEffect(() => {
    analyzeSeq.current++; // strand any scan still in flight
    setAnalysis(null);
    setAnalyzeError(null);
    setJob(null);
    setLiveJobId(null);
    setSavedMediaId(null);
    setScanning(false);
  }, [source, target]);

  const scan = async () => {
    if (!source || !target || scanning) return;
    const seq = ++analyzeSeq.current;
    setScanning(true);
    setAnalyzeError(null);

    const payload: FitAnalyzePayload = {
      ...sourceRef(source),
      ...targetRef(target),
    };
    try {
      const r = await api.creativeFit.videoAnalyze(payload);
      if (seq !== analyzeSeq.current) return; // superseded by an input change
      setAnalysis(r);
    } catch (e) {
      if (seq !== analyzeSeq.current) return;
      setAnalysis(null);
      setAnalyzeError(
        e instanceof ApiError ? e.message : "Could not analyse this video.",
      );
    } finally {
      if (seq === analyzeSeq.current) setScanning(false);
    }
  };

  // ── Poll a running job ─────────────────────────────────────────────────
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const fresh = await api.creativeFit.job(job.id);
        if (cancelled) return;
        setJob(fresh);
        if (fresh.status !== "queued" && fresh.status !== "running") {
          void refreshHistory();
          if (fresh.status === "failed") {
            toast(fresh.error ?? "That fit failed.", "error");
          }
        }
      } catch {
        /* keep polling — a blip shouldn't abandon a running job */
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [job, refreshHistory, toast]);

  // ── The clock behind the elapsed timer ─────────────────────────────────
  const jobLive = job?.status === "queued" || job?.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!jobLive) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [jobLive]);

  const stage = fitStage({
    hasSource: !!source,
    hasTarget: !!target,
    scanning,
    submitting,
    hasAnalysis: !!analysis,
    jobStatus: job?.status ?? null,
  });
  const busy = isFitBusy(stage);
  const locked = isFitLocked(stage);
  const elapsed =
    busy && job ? formatElapsed(elapsedSince(job.created_at, now)) : null;

  const run = async (mode: FitJobMode) => {
    // Belt and braces on top of the disabled attribute: two clicks dispatched
    // inside one frame would both pass the button's own guard, and each POST
    // buys a separate multi-minute render.
    if (!source || !target || !canRunFit(stage)) return;
    setSubmitting(true);
    setSavedMediaId(null);
    try {
      const payload: CreateFitJobPayload = {
        ...sourceRef(source),
        ...targetRef(target),
        mode,
        media_kind: "video",
        ...(mode === "resize"
          ? {
              // No pad_fill / pad_color: a video is never letterboxed, so
              // there is no leftover space to fill. The backend 422s a
              // `contain` here, and VideoResizeOptions cannot express one.
              fit_mode: resizeOptions.mode,
              anchor: resizeOptions.anchor,
            }
          : { user_note: userNote.trim() || undefined }),
      };
      const created = await api.creativeFit.createJob(payload);
      setJob(created);
      setLiveJobId(created.id);
      void refreshHistory();
    } catch (e) {
      toast(
        e instanceof ApiError ? e.message : "Could not start that fit.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Stop a queued or running fit.
   *
   * A queued job dies outright — no worker can see a cancelled row. A running
   * one is stopped cooperatively: the worker notices at its next checkpoint and
   * throws the partial render away. The operator gets the page back now, which
   * is what they asked for.
   */
  const stop = async () => {
    if (!job || !isFitBusy(stage) || stopping) return;
    setStopping(true);
    try {
      const stopped = await api.creativeFit.cancelJob(job.id);
      setJob(stopped);
      void refreshHistory();
      toast("Stopped.");
    } catch (e) {
      // A 409 means it finished in the moment between the click and the call.
      if (e instanceof ApiError && e.status === 409) {
        try {
          setJob(await api.creativeFit.job(job.id));
        } catch {
          /* the poller will catch up */
        }
        toast("That fit had already finished.", "error");
      } else {
        toast(
          e instanceof ApiError ? e.message : "Could not stop that fit.",
          "error",
        );
      }
    } finally {
      setStopping(false);
    }
  };

  const save = async (name: string) => {
    if (!job) return;
    setSaving(true);
    try {
      const media = await api.creativeFit.save(job.id, name);
      setSavedMediaId(media.id);
      setSaveOpen(false);
      toast(`Saved “${media.name}” to Content.`);
      void refreshHistory();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save it.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Reopen a past fit: restore its result, ready to redo. */
  const openHistory = (past: FitJob) => {
    setJob(past);
    setSavedMediaId(past.result_media_id ?? null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const ready = !!source && !!target;
  const videoEnabled = status?.video_enabled ?? false;
  const rebuildAvailable = (status?.rebuild_available ?? false) && videoEnabled;

  return (
    <div className="space-y-5">
      {status && !videoEnabled && (
        <p className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--status-warn)_35%,transparent)] bg-[color-mix(in_oklab,var(--status-warn)_8%,transparent)] px-3 py-2 text-xs leading-relaxed text-fg-muted">
          Video fitting isn&apos;t turned on for this server, so a fit will queue
          and wait. Set{" "}
          <span className="font-data">CREATIVE_FIT_VIDEO_WORKERS</span> on a
          worker that has ffmpeg to turn it on.
        </p>
      )}

      {/* Steps 1 + 2 — side by side on desktop, stacked on a phone. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col p-4 sm:p-5">
          <VideoSourcePicker
            value={source}
            onChange={setSource}
            maxUploadMb={status?.video_max_upload_mb ?? 500}
            maxDurationSeconds={status?.video_max_duration_seconds ?? 120}
            disabled={locked}
          />
        </Card>
        <Card className="flex flex-col p-4 sm:p-5">
          <TargetPicker value={target} onChange={setTarget} disabled={locked} />
        </Card>
      </div>

      {/* Step 3 — the scan gate. Replaced wholesale by the verdict below. */}
      {!analysis && (
        <VideoScanCard
          ready={ready}
          scanning={stage === "scanning"}
          error={analyzeError}
          onScan={() => void scan()}
        />
      )}

      {analysis && (
        <>
          <VideoVerdictCard
            result={analysis}
            stage={stage}
            runningMode={job && busy ? job.mode : null}
            elapsed={elapsed}
            stopping={stopping}
            rebuildAvailable={rebuildAvailable}
            onResize={() => void run("resize")}
            onRebuild={() => void run("rebuild")}
            onStop={() => void stop()}
          />

          {/* Options for both paths, collapsed by default so the page stays
              calm — but visible, so an operator adjusts the crop instead of
              paying for a rebuild they didn't need. */}
          <div className="grid gap-3 lg:grid-cols-2">
            <OptionPanel
              open={showResizeOptions}
              onToggle={() => setShowResizeOptions((v) => !v)}
              icon={<Settings2 className="h-3.5 w-3.5" />}
              title="Resize options"
              summary={resizeSummary(resizeOptions)}
            >
              <VideoResizeControls
                value={resizeOptions}
                onChange={setResizeOptions}
                disabled={locked}
              />
            </OptionPanel>

            {rebuildAvailable && (
              <OptionPanel
                open={showNote}
                onToggle={() => setShowNote((v) => !v)}
                icon={<Wand2 className="h-3.5 w-3.5" />}
                title="Instruction for the AI"
                summary={userNote.trim() ? "1 instruction" : "None"}
              >
                <Textarea
                  value={userNote}
                  onChange={(e) => setUserNote(e.target.value)}
                  maxLength={2000}
                  disabled={locked}
                  placeholder="e.g. keep the end-card logo large, and don't crop the price"
                  aria-label="Extra instruction for the AI rebuild"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-fg-subtle">
                  Applied on top of the rules that protect your text, logo and
                  colours — it can guide the layout, never override those.
                </p>
              </OptionPanel>
            )}
          </div>
        </>
      )}

      {/* Step 4 — the result. */}
      {job && (
        <VideoResultPreview
          job={job}
          // ONLY for the job these pickers just made — otherwise reopening a
          // past fit would show the currently-loaded video as its "Before".
          sourcePreviewUrl={job.id === liveJobId ? source?.previewUrl : null}
          saving={saving}
          savedMediaId={savedMediaId}
          retentionHours={status?.retention_hours}
          onSave={() => setSaveOpen(true)}
          onRedo={() => {
            setJob(null);
            setSavedMediaId(null);
          }}
        />
      )}

      <VideoSaveToContentModal
        job={job}
        open={saveOpen}
        saving={saving}
        onClose={() => setSaveOpen(false)}
        onSave={(name) => void save(name)}
      />

      <VideoJobHistory
        jobs={history}
        activeId={job?.id}
        retentionHours={status?.retention_hours}
        onOpen={openHistory}
      />

      {status && status.workers === 0 && (
        <p className="text-[11px] text-fg-subtle">
          <Sparkles className="mr-1 inline h-3 w-3" />
          No fit workers are running on this server — queued jobs will wait.
        </p>
      )}
    </div>
  );
}

/** A collapsible options panel. Native button + region, no dependency. */
function OptionPanel({
  open,
  onToggle,
  icon,
  title,
  summary,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-panel-raised"
      >
        <span className="text-fg-subtle">{icon}</span>
        <span className="flex-1 text-sm font-medium text-fg">{title}</span>
        <span className="truncate text-xs text-fg-muted">{summary}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="border-t border-line px-4 py-4">{children}</div>}
    </Card>
  );
}

function resizeSummary(o: VideoResizeOptions): string {
  if (o.mode === "stretch") return "Stretch";
  return `Crop to fill · ${o.anchor}`;
}

function sourceRef(s: ChosenVideoSource) {
  return s.mediaId
    ? { source_media_id: s.mediaId }
    : { source_url: s.url, source_name: s.name };
}

function targetRef(t: ChosenTarget) {
  return t.screenId
    ? { target_screen_id: t.screenId }
    : { target_width: t.width, target_height: t.height };
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
```

`npm run build` must list **both** `/creative-fit` and `/creative-fit/video` in its route table.

---

### Task 9: End-to-end verification and the freeze check

**Files:** none created or modified. This task only reads and runs.

**Interfaces:**
- Consumes: the whole feature
- Produces: evidence, not code

- [ ] **Step 1: Prove the image side did not change**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
git status --short src/components/creative-fit
git diff --stat src/lib/creative-fit.ts src/lib/creative-fit.test.ts
git diff --stat "src/app/(dashboard)/creative-fit/page.tsx"
```

Required results, and every one of them is a hard gate:
- `git status --short src/components/creative-fit` lists **only** the new `video/` directory and `MediaKindTabs.tsx` as untracked. No `M` beside any of the eight existing components.
- `git diff --stat` on `lib/creative-fit.ts` and `lib/creative-fit.test.ts` is **empty**.
- `git diff --stat` on the image `page.tsx` shows `6 -` and `0 +`.

If any of these fails, stop and revert that file — the freeze is the whole reason this plan duplicates rather than parameterises.

- [ ] **Step 2: Run the gates**

```bash
cd /Users/akshat/projects/MarkAi/markai-Web-cms
npm run typecheck
npm test
npm run build
```

All three must pass clean. Do **not** run `npm run lint` — there is no eslint config in this repo and the script is vestigial.

- [ ] **Step 3: Walk the flow in a browser**

Ask the user before this step: scanning calls Gemini for real. Then, with the backend on `:8095` and `npm run dev` on `:5120`, signed in as `admin@mark-ai.tech`:

1. `/creative-fit` — the header, the toggle on its right, the two picker cards. **Compare against a screenshot taken before Task 1**: the title, the subtitle and the gap beneath them must be pixel-identical, and the pickers must start at exactly the same y-offset.
2. Click **Video** — the URL becomes `/creative-fit/video`, the header does not redraw or move, the "Creative Fit" sidebar item stays highlighted.
3. Upload a large video — the progress bar advances, and the network panel shows the bytes going to `storage.googleapis.com`, **not** to `/api/cms/creative-fit/upload`.
4. Pick a screen with a different orientation, press **Scan this video** — a verdict card with the shape pair, the keeps-% badge, and the duration/fps/shots row.
5. Press **Resize** — the buttons lock, the progress bar and stage label move, **Stop** appears. Press Stop once to confirm the cancel path, then run it again and let it finish.
6. The result panel plays, and the "After" frame is **filled edge to edge** — no black bars inside the frame border. Check both a portrait and a landscape target.
7. **Save to Content** — the modal says "Video · plays for its full length", the save succeeds, and the item appears on `/content`.
8. The **Recent video fits** strip shows the job. Click **Image** in the toggle: its **Recent fits** strip must contain **no** video rows.

- [ ] **Step 4: Confirm the two histories stay disjoint**

In the browser devtools network panel:
- On `/creative-fit`, the history call is `GET /api/cms/creative-fit/jobs` — **no query string**.
- On `/creative-fit/video`, it is `GET /api/cms/creative-fit/jobs?kind=video`.

If the image page's request grew a `kind=image` parameter, something edited the frozen page — revert it.

---

## What this plan deliberately does NOT do

- **No shared "kind" prop.** Every media-specific component is duplicated. This is the shared contract's instruction and it is what makes Task 9 Step 1 a one-line proof rather than a review.
- **No change to `lib/creative-fit.ts`.** Video presentation helpers live in the new `lib/video-fit.ts`.
- **No eslint.** There is no config in this repo; adding one would gate every existing file on rules nobody has agreed.
- **No client-side re-derivation of `video_enabled` or the duration/size limits.** They come from `GET /cms/creative-fit/status`; the page renders what the server says.
- **No second nav item.** "Creative Fit" stays one sidebar entry; the toggle is inside the page.
