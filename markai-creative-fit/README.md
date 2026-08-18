# Mark AI — Creative Fit

Takes a **finished ad creative** and rebuilds it for a different **screen resolution**.

Stretching distorts. Cropping cuts the logo off. Scaling a 4000px mall banner down to a
1080px café panel leaves the headline at ~76px — unreadable from three metres. This service
does none of those: it works out what the ad is *made of*, then lays those parts out again
for the shape it has to play on.

**Still images only.** Video is not implemented.

---

## What it actually does

```
banner.jpg  (1600x900, text baked into the pixels)
     │
     ├─ 1. READ      Gemini vision → every text block, its role, font, colour,
     │               the logo box, the product box              (app/blueprint)
     │
     ├─ 2. REFINE    second zoomed Gemini call → a tight logo box
     │
     ├─ 3. ERASE     LaMa inpaints the text + logo away → clean plate  (app/plate)
     │
     ├─ 4. CUT       u2net lifts the logo off its background, alpha kept
     │                                                    ↓
     │                                          ┌──────────────────┐
     └─────────────────────────────────────────►│    BLUEPRINT     │
                                                │ cached per file  │
                                                └────────┬─────────┘
                                                         │  (steps 1-4 run ONCE)
                                    ┌────────────────────┼────────────────────┐
                                    ▼                    ▼                    ▼
                              1080x2400            1080x1920            1920x1080
                              relayout             relayout             scale only
                              ~0.15s               ~0.15s               ~0.15s
```

The split is the point. The model work costs ~10s **once per creative**. Every additional
screen shape after that is a sub-second render.

## How a rebuild is composed

Not one flat stack — four regions, **all of them optional**, because posters
arrive with different pieces:

```
HEADER   logo, at the end of the page it started on
COPY     headline · subhead · body, fitted to a budget
STAGE    the product shot, its captions, and badge cutouts
FOOTER   contact block + legal, on the bar they sat on
```

And two strategies, picked from how much of the creative is type:

| Type coverage | Strategy | What happens |
|---|---|---|
| under 20% | **photo-led** | The ad IS a photograph. Repair its background and set the copy over it |
| 20% or more | **layout-led** | The ad is a designed card. Rebuild on a fresh card of the same colour and place the photo as an inset |

That split exists because of a measurement: a real estate ad needed 32% of its
area repainted across 12 boxes, and LaMa returned doubled words and mirrored
phone numbers. Past a certain density the background cannot be reconstructed —
so it isn't reconstructed, it's replaced.

## The rules that make it work

**Text is sized for the screen, never scaled from the source.** A headline gets 5.5% of
canvas *height* as cap height, a subhead 3.0%, legal 1.1%. That is why the rebuilt headline
is readable where a scaled one is not.

**Copy is fitted to a budget and can never overflow.** It shrinks the whole scale together so
the hierarchy survives, down to a per-role floor. The photo is squeezed to its minimum
*before* any word is dropped, and anything finally left out comes back in `dropped` rather
than being silently written over the artwork.

**Badges are lifted as artwork, not retyped.** A price flash like "₹3.3Cr ONWARDS" lives
inside a red circle; extracting the words and re-setting them as two plain lines throws the
circle away, and the ad stops looking like the ad.

**Non-Latin scripts get a matching font.** All eight Latin families are missing every Kannada
glyph, so a Kannada line set in Montserrat is a row of empty boxes. Devanagari, Bengali,
Gurmukhi, Gujarati, Tamil, Telugu, Kannada and Malayalam are bundled, and Pillow here is built
with raqm so conjuncts shape correctly rather than rendering as loose glyphs.

**Text colour is contrast-checked against where it lands.** Gemini reports the colour the type
had in the *original*; after a re-layout that colour can end up on a completely different
background.

**Brand pixels are moved, never regenerated.** The logo is cut from the original and
re-placed. The product photo is untouched. No generative model ever repaints a trademark —
an AI-redrawn client logo is not something you can put on a paying advertiser's screen.

**Small shape changes skip the pipeline entirely.** How far the target drifts decides
everything:

| Aspect shift | Mode | What happens |
|---|---|---|
| ≤ 1.08× | `stretch` | Resized to fit exactly. **Nothing cropped, nothing lost** — a few percent of distortion is invisible and cheaper than discarding part of the ad |
| ≤ 1.25× | `crop` | Scaled + centre-cropped. Past ~8% a stretch starts to visibly oval a round logo |
| > 1.25× | `relayout` | Laptop-shaped ad onto a phone-shaped screen. Neither resizing nor cropping survives this — rebuild it |

Rebuilding a 1600×900 creative for a 1920×1080 screen produces a *worse* ad than leaving
the brand's own composition alone. The rebuild only earns its keep when the gap is genuinely
large.

**Backgrounds are extended with their own edge colour** when that edge is flat, which covers
most ad backgrounds. Mirror-and-blur is the fallback and looks noticeably worse, so it only
runs when a solid fill would band.

## Output quality

These play on physical panels, so the file is the product. Nothing is downscaled on the way
out:

- **The plate keeps the creative's native resolution.** LaMa runs on a ≤2600px copy (it is
  trained at 512 and degrades above ~2K), then the inpainted result is composited back onto
  the full-resolution original through the erase mask. Only the *erased* regions carry the
  upscale, and by then those regions are smooth background. The product shot stays native.
  A 3600×2025 creative yields a 3600×2025 plate.
- **The logo is cut from the full-resolution original**, not the analysis copy — 256×377
  rather than 52×50 on that same creative.
- **Text is re-rendered as vector at the target size**, so a 4K portrait rebuild has type
  that is genuinely 4K, not upscaled pixels.
- **JPEG q95 with 4:4:4 chroma** (`subsampling=0`). The default 4:2:0 halves colour
  resolution and visibly smears the edges of coloured type. `OUTPUT_FORMAT=PNG` for lossless.

The one thing that cannot be conjured: if a creative arrives at 1600×900 and the panel is 4K,
the *photograph* is upscaled 2.4×. The type is still rendered sharp at 4K. Feeding in the
highest-resolution master the advertiser has is always worth it.

## Run it

```bash
cd markai-creative-fit
cp .env.example .env               # add GEMINI_API_KEY
poetry install --no-root
```

Everything runs through `poetry run` — the deps live in Poetry's venv, not your system
Python. Calling `python cli.py` directly gives `ModuleNotFoundError: No module named 'dotenv'`.

```bash
# CLI — no server needed. Pass a REAL image path.
poetry run python cli.py fit ~/Downloads/banner.jpg 1080x2400 1920x1080 --sheet

# API
poetry run uvicorn app.main:app --reload --port 8097
```

Outputs land in `.work/<creative_id>/` and the CLI prints the folder. With `--sheet` you also
get `sheet.png`, a before/after contact sheet — the fastest way to judge a result.

First run downloads ~380 MB of weights (`big-lama.pt`, `u2net.onnx`) into `.models/`.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/fit` | Upload a creative + target resolutions → variants |
| `POST` | `/api/fit/{id}/render` | More resolutions from a cached blueprint (no model calls) |
| `POST` | `/api/fit/{id}/letterbox` | Rejection fallback — original on a blurred backdrop |
| `GET` | `/api/fit/{id}/blueprint` | The extracted blueprint |
| `GET` | `/api/fit/{id}/file/{name}` | Fetch an artifact |
| `GET` | `/health` | Liveness |

```bash
curl -F file=@banner.jpg -F targets=1080x2400 -F targets=1920x1080 \
     http://localhost:8097/api/fit
```

`mode` on each variant tells you which path ran: `relayout` (rebuilt) or `scale`
(shape was close enough to leave alone).

## Known limitations

- **Gemini's boxes vary between runs.** The same creative analysed twice returned a headline
  box **27% shorter** the second time, and the too-tight mask left a white smear where the
  descenders had been. Mask padding is therefore proportional to each box's own size
  (22% vertical, 4% horizontal) rather than a flat few pixels. Anything that tightens
  padding again will reintroduce the smear.
- **LaMa struggles on busy backgrounds.** Erasing text off a flat or dark area is clean;
  erasing it off detailed photography can leave a smear. This is the main reason a human
  reviews the output before it goes live.
- **Font matching is a nearest-neighbour guess** across 8 bundled families. Decorative and
  script faces will miss. `font_confidence` below 0.6 is reported in `low_confidence` so the
  CMS can flag it.
- **Small source logos stay small.** Many creatives carry a logo only ~70px wide. Upscaling
  is capped at 1.8× — a small sharp mark beats a large soft one.
- **u2net leaves a faint halo** on some cutouts.
- **One layout template**: text stacked above, product band, logo and legal below. It has
  not been tuned for portrait-source → landscape-target.
- **No video.** Uploads of `video/*` are rejected with 415.

## Measured on the Coca-Cola test banner (1600×900)

| | |
|---|---|
| Deconstruct (2 Gemini calls + LaMa + u2net, CPU) | ~75 s |
| Each additional resolution, cached blueprint | **~0.15 s, zero model calls** |
| Headline cap height at 1080×2400 | 132 px (a naive scale gives ~76 px) |

## Licences

Everything ships commercially clean:

| Component | Licence |
|---|---|
| LaMa (`big-lama.pt`) | Apache 2.0 |
| u2net | Apache 2.0 |
| Bundled fonts | SIL Open Font License |
| Pillow / FastAPI / onnxruntime | permissive |

Deliberately **not** used: Ultralytics YOLO (AGPL-3.0 — would force open-sourcing Mark AI),
ProPainter (S-Lab non-commercial), Gemini image generation (repaints brand assets, adds a
SynthID watermark, caps around 2K).

We also avoid the `simple-lama-inpainting` and `rembg` packages: they declare conflicting
numpy ceilings that cannot coexist in one environment. Both models are invoked directly
instead — see `app/plate/lama.py` and `app/plate/cutout.py`.
