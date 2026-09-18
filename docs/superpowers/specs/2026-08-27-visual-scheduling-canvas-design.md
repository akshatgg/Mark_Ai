# Simple media scheduling — place an ad on the screen, then schedule it

**Date:** 2026-08-27
**Status:** DESIGN. Nothing implemented.
**Repos:** `markai-Web-cms` (the page), `markai-signage-api` (the render + booking).
**Player:** no APK release required.

---

## 1. The problem

An operator books an ad and cannot see what it will look like until it is on the glass.
The shapes rarely agree — a 4320×3072 poster on a 1920×1080 panel, or a 1080×2400 tower —
and today the answer is decided for them, differently depending on the media type:

| | Today |
|---|---|
| Image, fullscreen | `scaleType="fitCenter"` — black bars |
| Image, in a zone | `ScaleType.FIT_CENTER` — black bars |
| Video, fullscreen | `app:resize_mode="fill"` — **already stretched**, aspect distorted |

Videos have been silently stretching while images get letterboxed. Neither is a choice
anyone made, and there is no way to make a different one.

What is missing is not a setting. It is **seeing it**: the panel as a rectangle, the ad
inside it, and a corner you can pull.

## 2. What we are building

One new page, reached from **Scheduling → Simple media scheduling**. The panel is drawn at
its true shape; the creative sits inside it; you drag a corner to stretch it; the schedule
controls sit down the side. Placing the ad and saying when it runs are the same act.

```
┌──────────────────────────────────────────┬──────────────────────┐
│  Phoenix Marketcity LED — 1920 × 1080    │  SCREEN              │
│  ┌────────────────────────────────────┐  │  [Phoenix Market ▾]  │
│  │┌──────────────────────────────────┐│  │                      │
│  ││                                  ││  │  MEDIA               │
│  ││        your creative             ││  │  [ E20 poster    ]   │
│  ││                                  ││  │  4320×3072 · image   │
│  │└──────────────────────────────────┘│  │                      │
│  └────────────────────────────────────┘  │  FIT                 │
│                                          │  Stretched 1.2×  ✓   │
│  [↔ width] [↕ height] [✥ fill]  100% ⊕⊖ │  [ Rebuild with AI ] │
│                                          │                      │
│  drag a corner · Shift keeps the shape   │  WHEN                │
│  · it stops at the panel edge            │  From 27 Aug         │
│                                          │  Until 30 Sep        │
│                                          │  Daily 09:00–17:00   │
│                                          │  Days M T W T F S S  │
│                                          │  [ Schedule it ]     │
└──────────────────────────────────────────┴──────────────────────┘
```

A full page, not a dialog. The existing `ScheduleModal` in `bookings/page.tsx` caps at
`70dvh` and scrolls inside itself — dragging corners in a scrollbox is miserable, and the
canvas needs the width.

## 3. The flow

```
1. PICK A SCREEN     the canvas unlocks at THAT screen's exact pixel size
                     nothing else is enabled until this is answered
2. PICK THE MEDIA    it lands on the canvas at its natural scale, centred
3. PLACE IT          drag corners/edges; clamped to the panel
                     ↔ ↕ ✥ for the common cases
                     a live readout says how distorted it is
4. (OPTIONAL) REBUILD when the stretch looks wrong, hand it to Creative Fit;
                     the rebuilt version comes BACK to the canvas
5. SCHEDULE          dates, daily window, days — down the side
6. SCHEDULE IT       render at the panel's native size → book it
```

**Screen first is a rule, not a preference.** A creative placed before the target is known
has nothing to be correct against — the same "resolution lock" the co-pilot master plan
already states. Steps 2–6 stay disabled until step 1 is answered.

## 4. The canvas

**Coordinates.** `x, y, w, h` as **percentages of the panel**, which is exactly what
`bookings.layout.zones[]` already stores and what the APK's `ZoneData` already reads.
Nothing new is invented.

**Clamping.** The creative can never leave the rectangle. Drag past an edge and it stops:
no overflow, no cropping, nothing hidden. Every value stays inside 0–100, so there are no
negative offsets and no crop maths. What the canvas shows is what the panel shows.

**Handles.** Four corners, four edges. Free drag stretches (and distorts). `Shift` keeps
the original shape. Three buttons cover the common cases: **↔ fill width**, **↕ fill
height**, **✥ fill the screen**.

**Uncovered area is black**, drawn as black, because that is what the panel does.

**Any shape.** Portrait towers (1080×2400) and 4K landscape both scale to fit the browser.
The canvas is responsive; the *coordinates* are not — they are percentages of the panel.

## 5. The distortion readout, and the way out

As the operator drags, the side panel says plainly how far the artwork has been pushed:

```
Stretched 1.2× — looks fine              ✓
Stretched 1.8× — noticeably squashed     ⚠  [ Rebuild with AI ]
Stretched 2.6× — badly distorted         ⚠  [ Rebuild with AI ]
```

The factor is `max(w_scale, h_scale) / min(w_scale, h_scale)` — how much more one axis was
stretched than the other. `1.0` is undistorted. `app/video/layout/geometry.py` on the
`video/resize` branch already has `aspect_shift` doing exactly this; the same rule serves
both media types.

Thresholds: **≤1.15** silent, **≤1.5** a gentle note, **above 1.5** an explicit warning
with the rebuild offered. Suggested — never forced. An operator who wants the stretch gets
the stretch; they are told what they are agreeing to.

**Rebuild with AI** (images only) hands the creative to the existing Creative Fit pipeline
(`POST /cms/creative-fit/analyze` then `/jobs`, poll `/jobs/{id}`). The result comes back
**onto the canvas** as the new creative, correctly shaped, where it can still be nudged
before booking. The button is hidden when `GEMINI_API_KEY` is unset — `AnalyzeResponse`
already reports that.

This is the honest division of labour:

| | Stretch | Rebuild with AI |
|---|---|---|
| Speed | instant | ~a minute |
| Cost | free | a Gemini call |
| Result | the same artwork, distorted | the artwork re-laid-out for the shape |
| When | shapes are close | shapes are far apart |
| Media | image **and** video | **image only** |

**The rebuild is offered for IMAGES ONLY.** Creative Fit re-lays-out artwork — it reads
the scene, the text and the brand colours and composes a new still. There is no
equivalent for a video: re-cutting a finished film to a different shape is a different
problem entirely, and pretending otherwise would put a button on the screen that cannot
do what it says. For video the readout still names the distortion — an operator should
know what they are booking — but the only remedy offered is to stretch it less.

| Media | Stretch | Rebuild |
|---|---|---|
| Image | ✅ | ✅ offered past 1.5× |
| Video | ✅ | ❌ not offered, not mentioned |

## 6. What happens on save

```
IMAGE                                VIDEO
Pillow, instant                      ffmpeg, a queued job
  │                                    │
  ├─ new canvas at the panel's         ├─ scale + pad filter at the
  │  native size, filled black         │  panel's native size
  ├─ source resized to (w,h)           ├─ re-encode, audio copied
  └─ pasted at (x,y)                   └─ result uploaded
        │                                    │
        └────────► new MediaAsset ◄──────────┘
                        │
                   booking created
```

The **original file is never modified.** The placed version is a new library asset, named
so it is obvious in the Content list — `E20 poster (Phoenix Marketcity)`. The same poster
can therefore be placed differently for a different panel.

**Deduped by checksum**, the way `_resolve_bookable_media_id` already dedupes chat
uploads: the same creative, screen and box renders once, not once per booking.

**The player needs no change.** A 1920×1080 creative in a 1920×1080 panel means the
existing `FIT_CENTER` fills it exactly — the letterbox becomes a no-op because there is
nothing left to letterbox. This is why no APK release is required and why it works on
every screen in the field today.

**Resolution** is the panel's native size. It is not a question we ask: a 1200-pixel-wide
panel cannot display more than 1200 pixels, and the canvas *is* the panel.

**Video is slow, so it is a job.** The image path saves and books in one request. The video
path returns immediately, renders in the background, and the booking is created when the
render lands — the same queue-and-deliver pattern `app/reports` and `app/creative_fit`
already use. The page says so plainly rather than spinning.

## 7. Video — what it costs

The hard part exists. Branch `video/resize` (commit `59c93af`, unmerged) carries:

| Piece | Lines | Status |
|---|---|---|
| `app/video/ffmpeg.py` — the subprocess boundary, binary discovery, build assertions | 402 | written |
| `app/video/encode.py` | 104 | written |
| `app/video/probe.py` | — | written |
| `app/video/layout/geometry.py` — incl. `aspect_shift` | 197 | written |
| `Dockerfile` — installs ffmpeg | — | written |

We port **the boundary only**. `erase/`, `tracking.py`, `lama.py` and the AI reframing stay
where they are: those belong to Creative Fit, and dragging them in would make this page
depend on the very pipeline it exists to avoid.

The new code is the filter itself — roughly `scale=W:H` plus `pad` for the uncovered area —
and the job wiring.

## 8. What we are NOT building

- **Rotation, opacity, z-order, multiple items on one canvas.** LED-Cloud has them because
  it is a full program editor. `layout.zones[]` already holds several items, so the canvas
  can grow into them later without rework.
- **Text, clock, weather, HTML widgets.** Same reason.
- **Re-placing an already-booked campaign.** The same component would serve it, but it
  means swapping the creative on a live booking, which touches the rotation code. Worth
  doing once the canvas is proven; not in v1.
- **Replacing `/bookings/new`.** This is a third door, beside the existing form and the
  Solution modal. People who want to fill in a form still can.
- **Changing the player.** Deliberately. The whole point of rendering server-side is that
  the existing fleet works unchanged.

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Screen has not reported a resolution | Canvas stays locked with the reason. Never guess a default — an ad rendered at a guessed size looks right until it reaches the glass |
| Creative already matches the panel | Canvas still opens; ✥ is a no-op; no distortion warning |
| Creative smaller than the panel | Stretching upscales. Warn past 2× — it will look soft |
| Very tall or very wide panel | Canvas scales to fit the browser; coordinates stay percentages |
| Video with audio | Audio stream copied, not re-encoded |
| ffmpeg missing at runtime | Video placement is disabled with the reason; images unaffected |
| Rebuild fails or is cancelled | The canvas keeps the original stretch; nothing is lost |
| Operator leaves mid-placement | Draft kept in `localStorage`, as the Solution editor already does |

## 10. Success criteria

1. An operator picks a screen, drops an ad, drags it to fill, sets dates, and books —
   without leaving the page or knowing what a resolution is.
2. What the canvas showed is what the panel shows.
3. No APK release; it works on screens already in the field.
4. A badly distorted stretch is *named* as such before it is booked, with the rebuild one
   click away.
5. Placing the same creative on the same screen twice does not create two library assets.
