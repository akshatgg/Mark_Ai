# Mark AI — Creative Fit (web)

The operator front end for [`markai-creative-fit`](../markai-creative-fit). Two inputs:
**upload a creative**, **pick the screens**. It shows what the ad will look like on each one.

## Run it

The API has to be up first — this app is a thin client over it.

```bash
# terminal 1 — the service
cd ../markai-creative-fit
poetry run uvicorn app.main:app --port 8097

# terminal 2 — this app
npm install
npm run dev            # http://localhost:5130
```

`next.config.ts` proxies `/api/fit/*` to `http://localhost:8097`. That is deliberate: the
service returns variant URLs as site-relative paths, so proxying lets them be used verbatim
in `<img src>`, keeps the app same-origin (no CORS), and keeps the API host out of the
client bundle. Override with `CREATIVE_FIT_API_URL`.

## The screen rack

The resolution picker is not a dropdown. Target screens are drawn as **bezels at their true
aspect ratio**, standing on a shelf — you pick a screen by recognising its shape. After
fitting, the rebuilt ad appears *inside that same bezel*, so the control and the preview are
the same object. Unlit panels carry a scanline texture so they read as switched-off hardware.

Presets are the shapes in the fleet plus the two common DOOH panels; any other size can be
typed in. Before you fit, each panel forecasts what will happen to it — the same rule the
service uses, so a screen that needs a rebuild is visible before you spend a minute on it.

Every panel carries an honest badge:

| Badge | Meaning |
|---|---|
| **Resized** | Shape gap under 1.08×. Resized to fit — nothing cropped, nothing lost |
| **Cropped** | Under 1.25×. Scaled and centre-cropped, original design kept |
| **Rebuilt** | Over 1.25×. Taken apart and re-laid-out — the one worth reviewing |

## Shareable results

A fitted creative is addressable:

```
/?creative=<creative_id>&screens=1080x2400,1920x1080
```

Opening that rebuilds the whole view from the service — no re-upload. The analysis is already
cached server-side, so it costs a render and nothing else. "Copy link to this result" puts it
on the clipboard.

## Layout

```
src/
  app/          page.tsx (all state), layout.tsx (fonts), globals.css
  components/   creative-drop · screen-rack · panel · blueprint-readout
  lib/          api.ts (fetch) · screens.ts (presets + the fit rule) · types.ts
  styles/       theme.css — the CMS token palette, copied not invented
```

`lib/screens.ts` mirrors `app/layout/rules.py` in the service so the forecast matches the
result. **If the thresholds move in the service, move them here too.**

## Verifying

No test runner here. The gates are:

```bash
npm run typecheck
npm run build
```

Then look at it. Headless Chrome screenshots work:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --window-size=1440,1600 --virtual-time-budget=14000 --screenshot=/tmp/shot.png \
  "http://localhost:5130/?creative=<id>&screens=1080x2400,1920x1080"
```

Two traps worth knowing: headless Chrome **clamps its layout viewport to 500px minimum**, so
`--window-size=390` renders a 500px page and crops it — that looks exactly like a mobile
overflow bug and isn't one. And running `npm run build` while `npm run dev` is live corrupts
the shared `.next` directory, which surfaces as
`__webpack_modules__[moduleId] is not a function`. Stop the dev server first, or delete
`.next` and restart.
