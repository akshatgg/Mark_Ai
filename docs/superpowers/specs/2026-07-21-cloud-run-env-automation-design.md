# Cloud Run env/secret automation (`envctl`) — design

**Date:** 2026-07-21
**Status:** approved, pending implementation plan

## Problem

All four Cloud Run services are configured by hand through the GCP console. Changing a
value means clicking through *Edit & Deploy New Revision*. There is no record of what a
service's config is *supposed* to be — the only source of truth is live GCP state.

Two distinct pains, which the same tool solves:

1. **No declarative config.** Adding a var, editing a value, or seeing what changed and
   when is all manual and unlogged.
2. **Secrets stored as plaintext.** `markai-backend` keeps five production credentials as
   plaintext env vars in its service config, readable by anyone with `run.viewer` and
   preserved permanently in revision history.

## Current state (verified 2026-07-21, project `markai-499512`, region `us-central1`)

| Cloud Run service | Repo folder | Plain vars | Secret refs | Runtime SA | Last deploy |
|---|---|---|---|---|---|
| `cms` | `markai-Web-cms` | 2 | 1 | default compute | Jul 20 (CI) |
| `cms-back` | `markai-signage-api` | 7 | 11 | `cms-runtime@` | Jul 20 (CI) |
| `markai-backend` | `markai-backend` (legacy Mongo) | 20 | 0 | default compute | Jun 22 (manual) |
| `markai-frontend` | `markai-frontend` (legacy site) | 4 | 0 | default compute | Jun 22 (manual) |

All four serve 100% traffic. `cms-back` is already the reference implementation: its 11
sensitive values are Secret Manager refs pinned to `:latest`.

### Secrets currently exposed as plaintext

In `markai-backend`:

- `MONGO_CONNECTION_STRING` — database URI including credentials
- `SECRET_KEY`, `JWT_SECRET_KEY` — auth token signing keys
- `SMTP_PASSWORD` — mail account password
- `RAZORPAY_KEY_SECRET` — payment credentials
- `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — `cms-back` already treats both of these
  as Secret Manager refs, so leaving them plaintext here is inconsistent with our own
  established practice

`RAZORPAY_KEY_ID` is flagged by the importer's heuristic but is a publishable identifier,
not a credential; it can stay plaintext.

The remaining 15 vars on that service (`SMTP_SERVER`, `GCS_BUCKET_NAME`, `FRONTEND_URL`,
`CLOUDINARY_CLOUD_NAME`, etc.) are configuration, not secrets, and stay plaintext.

`markai-frontend`'s 4 vars are all `NEXT_PUBLIC_*` — browser-exposed by definition, so
plaintext is correct and they must **not** be migrated.

## Approach

A small tool, `gcp-env/envctl`, plus one YAML per service committed to this repo. Chosen
over Terraform (which would want to own image tags and fight the CI that deploys
`cms`/`cms-back`) and over a bare Makefile (no source of truth).

### Layout

```
gcp-env/
  envctl
  services/
    cms.yaml  cms-back.yaml  markai-backend.yaml  markai-frontend.yaml
```

### Config file shape

```yaml
service: markai-backend
region: us-central1
project: markai-499512

env:                          # plaintext — values live here, in git
  SMTP_SERVER: smtp.gmail.com
  GCS_BUCKET_NAME: markai-storage

secrets:                      # names only — values live in Secret Manager
  MONGO_CONNECTION_STRING: MONGO_CONNECTION_STRING:latest
  SMTP_PASSWORD: SMTP_PASSWORD:latest
```

The invariant that makes this safe to commit: **`env:` holds values, `secrets:` holds only
names.** A secret value never enters the repo.

### Commands

| Command | Does |
|---|---|
| `envctl diff <svc>` | Show declared-vs-live differences. Read-only. |
| `envctl apply <svc>` | Sync YAML → Cloud Run. Prints diff, requires confirmation. |
| `envctl set <svc> K=V` | Add/edit a plaintext var: updates YAML, then applies. |
| `envctl secret set <NAME>` | Add a new Secret Manager version. Prompts for value (never an argv, so it stays out of shell history). |
| `envctl migrate <svc> <KEY>` | Move a plaintext var into Secret Manager: create secret, copy current value, grant SA access, swap to ref, drop plaintext. |

`diff` is the primitive — `apply` calls it and refuses to proceed silently.

## Safety requirements

These are requirements, not nice-to-haves:

1. ~~**Verify `--set-env-vars` vs `--update-env-vars` semantics against a live service
   before wiring `apply`.**~~ **RESOLVED 2026-07-21.** Tested on a throwaway `envctl-canary`
   service (since deleted). The gcloud docs say `--set-env-vars` removes "all existing
   environment variables", which is ambiguous about secret-backed ones. Empirically the two
   flag families are **independent**:

   - `--set-env-vars` replaced all plaintext vars and left the secret ref intact
   - `--set-secrets` replaced all secret refs and left plaintext vars intact
   - both together in one command produced an exact declarative sync

   So `apply` must always send **both** flags: sending only one silently wipes the other
   category. This is the single most important invariant in the tool.
2. **`apply` always shows a diff and requires confirmation.** Env changes create a new
   revision; a typo must not silently roll a live service.
3. **`apply` touches only `env` and `secrets`.** It must never send image, scaling, or
   concurrency flags, so it cannot fight the CI that deploys `cms`/`cms-back`.
4. **`migrate` verifies the new value reads back correctly before removing the
   plaintext.** Never delete the only copy of a credential on an unverified write.
5. **Refs use `:latest`.** Rotation propagates as instances restart; `envctl secret set`
   tells the user this and offers to force a new revision.

## Sequencing

1. Build `envctl`; confirm flag semantics (safety req. 1) on a scratch service.
2. Import `markai-frontend` (4 vars, no secrets, lowest blast radius). Prove
   `diff`/`apply`/`set`.
3. Import the remaining three as YAML. `diff` must come back clean against live state —
   this proves the importer is faithful before anything is written.
4. Migrate `markai-backend`'s five plaintext secrets, one at a time, verifying between each.

Step 3 is the real gate: a clean `diff` on all four services means the tool understands
existing config, including `cms-back`'s 11 secret refs.

## Out of scope

- Terraform / full IaC.
- Changing `markai-backend`'s over-privileged default compute service account. Worth doing
  (`cms-back` correctly uses a dedicated `cms-runtime@`), but it is an IAM change with a
  different blast radius and belongs in its own change.
- Migrating `NEXT_PUBLIC_*` vars — they are public by design.
- Secret rotation *scheduling*. `envctl` makes rotation one command; deciding when to
  rotate stays manual.
