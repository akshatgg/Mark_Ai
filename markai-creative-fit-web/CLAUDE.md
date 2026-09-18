# markai-creative-fit-web — guide for Claude sessions

Read the root `CLAUDE.md`, then `../markai-creative-fit/CLAUDE.md`. This is the
operator UI for that service and has no logic of its own beyond layout and copy.

## What it is
Two inputs — **upload a creative**, **pick screens** — and a preview of what the ad
becomes on each. Still images only, because the service is images only.

## Stack
Next.js 15 App Router + React 19 + Tailwind 4, matching `markai-Web-cms`. Port **5130**
(3100 = frontend-new, 5120 = CMS, 8097 = the fit service). All state lives in
`src/app/page.tsx`; components are presentational.

## Things that are load-bearing

1. **`next.config.ts` proxies `/api/fit/*`.** The service returns variant URLs as
   site-relative paths (`/api/fit/<id>/file/x.jpg`). Proxying is what makes those work
   verbatim in `<img src>` and keeps the app same-origin. Do not switch to calling the
   service directly from the browser without rewriting every URL the API hands back.
2. **`lib/screens.ts::predictMode` duplicates `app/layout/rules.py::fit_mode`.** The
   1.08 / 1.25 thresholds appear in both repos. If they change in the service, change
   them here or the forecast will disagree with the result.
3. **The panel is a grid cell with a `flex-1` spacer above the bezel.** That is what
   makes panels rest on a shared shelf while letting each grid row size to its own
   content. A fixed-height box was tried first: it left ~150px of dead space above a
   short landscape panel that wrapped onto a row alone.
4. **The blueprint table is wrapped in `overflow-x-auto` with a `min-w`.** A table will
   not shrink below its min-content width, so unwrapped it widens the whole document on
   a narrow screen and clips every other section.
5. **`MODE_COPY` has separate `done` and `forecast` strings.** Deriving one from the
   other produced "will resized".

## Verifying
No test runner. `npm run typecheck` and `npm run build`, then **look at it** with a
headless screenshot (command in the README).

Two environment traps that both look like app bugs and aren't:
- Headless Chrome **clamps its layout viewport to 500px**; `--window-size=390` renders a
  500px page cropped to 390 and looks exactly like a mobile overflow. Verified with a
  probe page reporting `window.innerWidth`.
- `npm run build` while `npm run dev` is running corrupts the shared `.next` and throws
  `__webpack_modules__[moduleId] is not a function`. Stop dev, `rm -rf .next`, restart.

## Design
Palette and fonts are **copied from `markai-Web-cms`** (`src/styles/theme.css`), not
invented — this should look like part of Mark AI. Dark only: the job is judging how a
bright ad reads on a panel in a dim café, and light chrome would fight the thing being
looked at. The one live accent is the signal gradient on the hero rule; spend boldness
on the screen rack and keep everything else quiet.
