import type { IngestResponse, JobAccepted, VideoJobStatus } from "./video-types";

/**
 * Sibling of lib/api.ts for the video routes. Same-origin: next.config.ts
 * rewrites /api/video/* to the creative-fit service, for the same reason
 * /api/fit/* is rewritten — see that file's header comment.
 */

export class VideoApiError extends Error {}

async function detail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail))
      return body.detail.map((d: { msg?: string }) => d.msg).join(", ");
  } catch {
    /* not JSON — fall through to the status text */
  }
  return `The service returned ${res.status}.`;
}

/** Upload a video and probe it. Synchronous — no model call, no rendering. */
export async function ingestVideo(file: File): Promise<IngestResponse> {
  const form = new FormData();
  form.append("file", file);

  let res: Response;
  try {
    res = await fetch("/api/video/ingest", { method: "POST", body: form });
  } catch {
    throw new VideoApiError(
      "Can't reach the creative-fit service. Start it with: poetry run uvicorn app.main:app --port 8097",
    );
  }
  if (!res.ok) throw new VideoApiError(await detail(res));
  return res.json();
}

/**
 * Schedule a fit job against an already-ingested creative. Returns as soon
 * as the job is accepted (202) — poll `getVideoJob` for progress and the
 * eventual result. Also how a shared link "renders more": the source is
 * read back off disk server-side, no re-upload needed.
 */
export async function fitVideo(
  creativeId: string,
  targets: string[],
  force = false,
): Promise<JobAccepted> {
  const res = await fetch(`/api/video/${creativeId}/fit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targets, force }),
  });
  if (!res.ok) throw new VideoApiError(await detail(res));
  return res.json();
}

/** One poll of a running or finished job. */
export async function getVideoJob(jobId: string): Promise<VideoJobStatus> {
  const res = await fetch(`/api/video/jobs/${jobId}`);
  if (!res.ok) throw new VideoApiError(await detail(res));
  return res.json();
}

export async function cancelVideoJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/video/jobs/${jobId}/cancel`, { method: "POST" });
  if (!res.ok) throw new VideoApiError(await detail(res));
}
