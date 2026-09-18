# Mark AI — 3D Studio (photo/prompt → AR product) — Design

**Date:** 2026-07-12
**Status:** Approved (Approach A), local-first implementation
**Folder:** `markai-3d-studio/` (new, self-contained sibling of `markai-ar-mvp`)

## Goal
A self-contained web app where an operator uploads a **product photo** or types a
**prompt**, an AI model generates a **textured 3D model**, and it becomes viewable in
**AR on Android + iPhone** (spin, View in AR, QR share). Mirrors the "just like the
Hunyuan3D Space" idea, but as Mark AI's own app.

## Scope decisions (locked with user)
- **New folder**, not inside `markai-ar-mvp`.
- **Local-first**: runs on the user's Mac now; **no GCP deploy in this pass**.
- **Inputs**: photo **and** prompt.
- **No auth gate** in v1 (a clean seam is left to add it later). The real GPU service,
  when deployed, is kept private so the open internet can't call it directly.
- **AR platforms**: Android **and** iPhone → GLB **and** USDZ.
- **Approach A**: one Cloud Run GPU service (later) + Next.js orchestrator/UI (now).

## The hard constraint that shapes local dev
Hunyuan3D needs a **CUDA GPU**; macOS has none. So generation is a **pluggable backend**
behind one interface, selected by env:
- `mock` (default, zero setup) — returns a bundled sample GLB + USDZ so the entire
  flow (upload/prompt → progress → View in AR → QR) works locally with no GPU/keys/cost.
- `fal` — calls fal.ai's hosted Hunyuan3D (image-to-3d and text-to-3d) for **real**
  models locally (~$0.05/gen). Needs `FAL_KEY`.
- `cloudrun` — later: calls the self-hosted GCP Cloud Run GPU worker. Deploy-ready
  skeleton is scaffolded now but not run.

Switching backends is one env var: `GENERATOR=mock|fal|cloudrun`.

## Architecture
```
markai-3d-studio/
├── web/ (this pass)         Next.js 15 / React 19, TS strict — UI + orchestrator
│   ├── app/page.tsx         studio UI: photo/prompt form → progress → model-viewer AR + QR
│   ├── app/api/generate/route.ts        POST: create job, kick off generator, return {jobId}
│   ├── app/api/generate/[id]/route.ts   GET: poll → pending | done{glbUrl,usdzUrl} | failed
│   ├── lib/jobStore.ts      job state (in-memory singleton for local; Firestore later)
│   ├── lib/generator/       Generator interface + mock/fal/cloudrun adapters + factory
│   └── public/models/       bundled sample.glb / sample.usdz (mock output)
├── gpu-service/ (skeleton)  FastAPI + Dockerfile: Hunyuan3D → GLB → USDZ → GCS (deploy later)
└── infra/                   gcloud deploy scripts + GPU-quota notes (for later)
```

Note: for the local pass the web app is a single Next.js project at the folder root
(not a `web/` subdir) to keep `npm run dev` trivial; `gpu-service/` and `infra/` are
sibling dirs holding the deploy-later code. (Simplification over the diagram above.)

## Data flow (async job — robust for ~60–120s generations)
```
browser → POST /api/generate  (multipart photo | JSON prompt)
        → validate input; create job {id, status:'pending'} in jobStore
        → run generator in background (do not block the response)
        → 202 { jobId }
browser → GET /api/generate/:id  every ~2s
        → pending | done { glbUrl, usdzUrl, name } | failed { message }
        → on done, <model-viewer src=glbUrl ios-src=usdzUrl> → View in AR + QR
```
- **jobStore**: module-level `Map` pinned on `globalThis` (survives Next HMR) for local.
  Interface allows swapping to Firestore when cloud-deployed.
- **mock generator**: after a short simulated delay, returns URLs to bundled
  `/models/sample.glb` + `/models/sample.usdz`.
- **fal generator**: uploads the photo (or sends the prompt) to fal.ai Hunyuan3D, polls
  fal, returns the resulting GLB URL. USDZ: for local `fal`, if conversion isn't
  available we serve GLB for both and note iPhone AR needs the cloud USDZ step; the
  cloud `gpu-service` produces real USDZ via `usd_from_gltf`.

## Error handling
- Missing/empty/oversized upload or empty prompt → `400` before any generator call.
- Unknown/failed job id → `404`.
- Generator throws / times out → job set to `failed` with a human-readable message; UI
  shows the message + a Retry button. No partial/blank model is ever shown.

## Testing (built-then-verified)
- **Unit (vitest)**: jobStore lifecycle (create → running → done/failed, unknown id);
  `POST /api/generate` validation; factory returns the right adapter per env.
- Generator is **mocked** in tests — no GPU, no network, runs in CI.
- **Manual verify**: `npm run dev`, submit the sample flow, confirm a model renders and
  "View in AR" is offered; on a phone via tunnel, confirm AR launches on Android + iPhone.

## Out of scope (this pass)
GCP deployment, Firestore, real USDZ conversion pipeline, auth, Razorpay buy flow
(portable from `markai-ar-mvp` later), multi-product catalog/persistence.
