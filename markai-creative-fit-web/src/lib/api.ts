import type { FitResponse } from "./types";

/** Same-origin: next.config.ts rewrites /api/fit/* to the creative-fit service. */

export class ApiError extends Error {}

async function detail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) return body.detail.map((d: { msg?: string }) => d.msg).join(", ");
  } catch {
    /* not JSON — fall through to the status text */
  }
  return `The service returned ${res.status}.`;
}

/** Upload a creative and rebuild it for each target ("1080x2400"). */
export async function fitCreative(file: File, targets: string[]): Promise<FitResponse> {
  const form = new FormData();
  form.append("file", file);
  targets.forEach((t) => form.append("targets", t));

  let res: Response;
  try {
    res = await fetch("/api/fit", { method: "POST", body: form });
  } catch {
    throw new ApiError(
      "Can't reach the creative-fit service. Start it with: poetry run uvicorn app.main:app --port 8097",
    );
  }
  if (!res.ok) throw new ApiError(await detail(res));
  return res.json();
}

/** Render more screens from a creative that has already been analysed. */
export async function renderMore(creativeId: string, targets: string[]): Promise<FitResponse> {
  const res = await fetch(`/api/fit/${creativeId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targets }),
  });
  if (!res.ok) throw new ApiError(await detail(res));
  return res.json();
}
