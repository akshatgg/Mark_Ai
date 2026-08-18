"""Type rules for text the video path draws itself — a DELIBERATE duplicate of
`app/layout/rules.py` and the contrast helpers in `app/layout/service.py`.

**Why duplicated, not shared.** `app/layout/` is frozen by explicit user
requirement (see the root and repo `CLAUDE.md`s): not one byte of it may
change, and nothing outside it may import from it or re-export a piece of it
under a different name — an earlier attempt to hoist a single constant out of
`app/layout/rules.py` behind a re-export was reverted for exactly that reason.
More than policy, though, the image path's versions of these rules are
genuinely coupled to a pydantic construct the video path does not have: every
table in `app/layout/rules.py` is keyed on `app.blueprint.schemas.Role`, an
`Enum`, because the image blueprint's `Element.role` IS that enum. The video
blueprint's `TextRegion.role` (`app/video/schemas.py`) is a plain `str` —
Gemini's video prompt returns whatever role name it likes, `tracking.py` votes
on it as a plain string, and nothing downstream ever constructs a `Role`. Two
different key types cannot share one dict without a translation layer at the
boundary, and that translation layer would itself be a coupling to the frozen
module. Duplicating the (small) set of constants this path actually needs is
the option that keeps `app/layout/` genuinely untouched.

**Drift between the two copies is accepted, on purpose.** If a future change
to the image path's type scale does not get mirrored here, that is not a bug
in this file — the two paths render onto physically different hardware paths
(4:4:4 JPEG vs 4:2:0 H.264) and are allowed to diverge in exactly the ways
that difference demands. That divergence is the rest of this module.

**The three 4:2:0 mitigations.** The image path composites at 4:4:4 chroma
(`JPEG_SUBSAMPLING=0`) because 4:2:0 visibly smears coloured type. Video has
no equivalent option: the only H.264 profile with 4:4:4 chroma is High 4:4:4
Predictive, which the target hardware (the AndBox S905X4 signage box) cannot
decode, so every video frame ships 4:2:0 by force — only 1 chroma sample per
2x2 luma block. A glyph edge whose only distinguishing signal is chroma (the
canonical case: saturated red text on a saturated blue background, matched in
luma) bleeds roughly 2px into its background and its effective contrast
collapses, even though the two colours pass an ordinary WCAG contrast check.
Three mitigations below exist because of this, and only because of this:

1. `readable_on_video` — colour contrast PLUS a hard floor on luma
   separation, because luma is the one channel 4:2:0 keeps at full
   resolution.
2. `ROLE_FLOOR_VIDEO` — larger minimum type sizes than the image path uses,
   so a shrunk-to-floor headline still reads at a room's viewing distance.
3. `outline_for` — a black/white stroke around the glyph, chosen to maximise
   luma separation from the background, which puts the glyph edge back into
   the one plane 4:2:0 cannot touch.
"""

from __future__ import annotations

from PIL import ImageDraw, ImageFont

from app.core.config import settings

# ---------------------------------------------------------------------------
# Fonts — copied from app/layout/rules.py (see module docstring for why)
# ---------------------------------------------------------------------------
#: Latin display families, all SIL Open Font License. Gemini's video prompt
#: (`app/video/blueprint.py`) picks from exactly these names via
#: `app.core.fonts.FONTS`, which is the SAME dict as this one — that module
#: exists because the video ANALYSIS prompt needs the exact vocabulary the
#: image prompt uses (a role means the same thing in both blueprints), and it
#: lives in `app.core` because neither `app/layout/` nor `app/video/` may
#: import from the other. This copy is the RENDER-time twin of that: the
#: video layout path needs the font table to actually load glyphs, not just
#: to name them in a prompt, so it is duplicated here rather than reaching
#: back into `app.core.fonts` and coupling render-time behaviour to a module
#: that exists for a prompt string.
FONTS: dict[str, tuple[str, bool]] = {
    # name                  file                     variable weight axis?
    "Playfair Display": ("PlayfairDisplay.ttf", True),
    "Merriweather": ("Merriweather.ttf", True),
    "Lora": ("Lora.ttf", True),
    "Montserrat": ("Montserrat.ttf", True),
    "Poppins": ("Poppins-Bold.ttf", False),
    "Oswald": ("Oswald.ttf", True),
    "Anton": ("Anton.ttf", False),
    "Bebas Neue": ("BebasNeue.ttf", False),
}
FALLBACK_FONT = "Montserrat"

#: Script -> font. Indian DOOH routinely carries a Kannada, Hindi or Tamil
#: line alongside the English, and a Latin-only face renders those as empty
#: boxes. Pillow is built with raqm here, so these shape correctly (conjuncts
#: and reordering) rather than rendering as loose glyphs.
SCRIPT_FONTS: tuple[tuple[int, int, str], ...] = (
    (0x0900, 0x097F, "NotoSansDevanagari.ttf"),  # Hindi, Marathi, Nepali
    (0x0980, 0x09FF, "NotoSansBengali.ttf"),
    (0x0A00, 0x0A7F, "NotoSansGurmukhi.ttf"),  # Punjabi
    (0x0A80, 0x0AFF, "NotoSansGujarati.ttf"),
    (0x0B80, 0x0BFF, "NotoSansTamil.ttf"),
    (0x0C00, 0x0C7F, "NotoSansTelugu.ttf"),
    (0x0C80, 0x0CFF, "NotoSansKannada.ttf"),
    (0x0D00, 0x0D7F, "NotoSansMalayalam.ttf"),
)


def script_font(text: str) -> str | None:
    """File name of the font covering ``text``'s script, or None for Latin."""
    counts: dict[str, int] = {}
    for char in text:
        code = ord(char)
        for lo, hi, filename in SCRIPT_FONTS:
            if lo <= code <= hi:
                counts[filename] = counts.get(filename, 0) + 1
                break
    if not counts:
        return None
    return max(counts, key=lambda k: counts[k])


# ---------------------------------------------------------------------------
# Type scale
# ---------------------------------------------------------------------------
#: Cap height per role as a fraction of canvas height, at scale 1.0. Keyed on
#: the plain role STRINGS `TextRegion.role` actually carries (see the module
#: docstring), not on `app.blueprint.schemas.Role`. Values identical to the
#: image path's `ROLE_HEIGHT` — the nominal type hierarchy is the same idea
#: on both paths; only the FLOOR (below) needs to differ for 4:2:0.
ROLE_HEIGHT: dict[str, float] = {
    "headline": 0.055,
    "subhead": 0.030,
    "body": 0.020,
    "contact": 0.022,
    "legal": 0.011,
}

#: Floor per role, as a fraction of canvas height — the image path's numbers,
#: unmodified. `ROLE_FLOOR_VIDEO` below is what actually gets used when
#: sizing video text; this is kept only as the base those floors are derived
#: from, so the x1.35 relationship stays visible in code rather than only in
#: a comment.
ROLE_FLOOR: dict[str, float] = {
    "headline": 0.032,
    "subhead": 0.020,
    "body": 0.014,
    "contact": 0.015,
    "legal": 0.008,
}

ROLE_MAX_LINES: dict[str, int] = {
    "headline": 3,
    "subhead": 3,
    "body": 3,
    "contact": 2,
    "legal": 3,
}

_DEFAULT_ROLE = "body"

#: Cap height is roughly 72% of the em for the bundled faces. Legibility
#: standards (and the OOH rule `geometry.min_cap_px` implements) specify CAP
#: height; Pillow's `ImageFont.truetype(size=...)` takes an EM size. The two
#: are NOT the same number — treating a cap-height target as an EM size
#: under-sizes the rendered glyph by roughly this ratio, about 30%.
CAP_RATIO = 0.72
MIN_FONT_PX = 11

LINE_SPACING = 1.14
TIGHT_SPACING = 1.06  # within a multi-line block of the same string


def load_font(
    family: str | None, weight: int | None, size: int, text: str = ""
) -> ImageFont.FreeTypeFont:
    """Font for ``text`` at ``size``, substituting by script where needed."""
    size = max(MIN_FONT_PX, size)
    override = script_font(text) if text else None
    if override:
        path, variable = settings.FONT_DIR / override, True
    else:
        name = family if family in FONTS else FALLBACK_FONT
        filename, variable = FONTS[name]
        path = settings.FONT_DIR / filename

    font = ImageFont.truetype(str(path), size)
    if variable:
        try:
            axes = font.get_variation_axes()
            # Noto carries a width axis before weight; set each axis to the
            # requested weight only where the axis actually is weight.
            values = []
            for axis in axes:
                tag = axis.get("name")
                tag = tag.decode() if isinstance(tag, bytes) else str(tag)
                if "eight" in tag or tag == "wght":
                    values.append(float(weight or 700))
                else:
                    values.append(float(axis.get("default", 100)))
            font.set_variation_by_axes(values)
        except (OSError, AttributeError, KeyError):
            # Not every build exposes variation axes; the default instance
            # still renders.
            pass
    return font


def wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    """Greedy word wrap. A single word wider than the line overflows here and is
    handled by the caller shrinking the type."""
    lines: list[str] = []
    current = ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if not current or draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def line_height(font, spacing: float = LINE_SPACING) -> int:
    ascent, descent = font.getmetrics()
    return round((ascent + descent) * spacing)


# ---------------------------------------------------------------------------
# Colour — copied from app/layout/service.py
# ---------------------------------------------------------------------------
#: Anything under this contrast ratio against its background gets swapped for
#: black or white. 3.0 is the WCAG floor for large text.
MIN_CONTRAST = 3.0


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    """WCAG relative luminance: sRGB-decoded (linear-light) BT.709 weights.

    Deliberately NOT the same quantity as `_luma709` below — this one
    linearises gamma first, which is what the WCAG contrast formula (and
    `contrast_ratio`) requires. `_luma709` skips that decode on purpose; see
    its docstring.
    """
    parts = []
    for channel in rgb:
        c = channel / 255
        parts.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = _relative_luminance(a), _relative_luminance(b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def readable_on(
    colour: tuple[int, int, int], background: tuple[int, int, int]
) -> tuple[int, int, int]:
    """Keep the brand colour when it reads; swap to black/white when it doesn't.

    Gemini reports the colour the type had in the ORIGINAL. Once the layout
    moves, that colour can land on a completely different background — dark
    grey copy that was on white ending up on a photo. Checking is cheap and
    it is the difference between legible and invisible.
    """
    if contrast_ratio(colour, background) >= MIN_CONTRAST:
        return colour
    white, black = (255, 255, 255), (17, 17, 17)
    if contrast_ratio(white, background) >= contrast_ratio(black, background):
        return white
    return black


# ---------------------------------------------------------------------------
# The three 4:2:0 mitigations — video-only, no image-path equivalent
# ---------------------------------------------------------------------------
#: Minimum |delta Y'| this path requires between text and background, in
#: GAMMA-ENCODED BT.709 luma (Y', 0-1 scale; 0.25 == 64/255). Gamma-encoded,
#: not linear-light, because that is what the full-resolution luma PLANE
#: physically carries in a 4:2:0 frame — the plane the decoder hands the
#: display is the encoded Y' samples, never linearised. Checking this in
#: linear-light space (as `_relative_luminance`/`contrast_ratio` do, correctly,
#: for WCAG) would test a quantity the video pipeline never actually stores.
LUMA_DELTA_MIN = 0.25


def _luma709(rgb: tuple[int, int, int]) -> float:
    """BT.709 luma Y', computed directly on gamma-encoded R'G'B' (0-1).

    No sRGB EOTF decode here — that is the entire point relative to
    `_relative_luminance` above. Y' is the actual sample value carried by the
    encoded luma plane; decoding gamma first would compute a physically
    different signal that a 4:2:0 stream never transmits.
    """
    r, g, b = (c / 255 for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def readable_on_video(
    colour: tuple[int, int, int], background: tuple[int, int, int]
) -> tuple[int, int, int]:
    """`readable_on`, plus a hard floor on luma separation.

    Colour contrast alone is not sufficient on 4:2:0 video: two colours can
    pass WCAG contrast while sharing almost identical luma (matched-luma
    complementary hues are the canonical failure — saturated red on saturated
    blue), and chroma subsampling then bleeds the glyph edge because the one
    channel that would have anchored it, luma, carries no signal there. A
    pair that clears `readable_on`'s colour check but not `LUMA_DELTA_MIN` is
    rejected here and forced to whichever of black/white maximises |delta Y'|
    against the background — the same swap `readable_on` already makes for a
    failed colour contrast, just gated on a different, video-only threshold.
    """
    candidate = readable_on(colour, background)
    if abs(_luma709(candidate) - _luma709(background)) >= LUMA_DELTA_MIN:
        return candidate
    white, black = (255, 255, 255), (17, 17, 17)
    bg_luma = _luma709(background)
    if abs(_luma709(white) - bg_luma) >= abs(_luma709(black) - bg_luma):
        return white
    return black


#: The image floors, scaled up for video. Landing point (headline): 0.032 *
#: 1.35 = 0.0432, close to the ~4.5%-of-panel-height target the OOH
#: legibility rule (`geometry.min_cap_px`) independently derives for a 55"
#: panel at 3.5m — two different derivations converging near the same number
#: is the sanity check that 1.35 is the right multiplier, not an arbitrary
#: one. 4:2:0 chroma bleed eats a few px off every glyph edge regardless of
#: nominal size, so the FLOOR — the size text is allowed to shrink to under
#: budget pressure — has to start further from unreadable than the image
#: path's floor does.
ROLE_FLOOR_VIDEO: dict[str, float] = {role: floor * 1.35 for role, floor in ROLE_FLOOR.items()}

#: The minimum width, in output pixels, of a GLYPH'S OWN STEM — the vertical
#: bar of an "l" or an "H". This is the quantity 4:2:0 subsampling actually
#: destroys: chroma is stored at a quarter of the samples, so a stem carried
#: mainly by a colour difference is reconstructed from a 2x2 block and bleeds
#: about 2px. Below 3px of stem there is nothing left to bleed FROM.
#:
#: NOT the decorative outline `outline_for` draws. An earlier version applied
#: this bound to the outline width and it raised for almost every role, which
#: is the wrong quantity measured against the right number: the outline is a
#: 2px-minimum accent, while the stem is the letterform itself.
MIN_STEM_PX = 3

#: Stem width as a fraction of cap height, for the bold weights this service
#: renders at (all eight bundled Latin faces are set at weight 700 by
#: `load_font`). Measured across that set the ratio sits around 0.14-0.18;
#: 0.14 is the conservative end, so the check fails safe rather than passing
#: type that is thinner than it predicted.
STEM_RATIO = 0.14


def role_floor_stem_px(role: str, panel_height_px: int) -> float:
    """Glyph stem width at ``role``'s FLOOR on a panel ``panel_height_px`` tall.

    Raises when that stem falls under `MIN_STEM_PX`, because a role whose
    smallest permitted size cannot survive 4:2:0 on this panel should be
    dropped from the render — the video analogue of the image path's
    `SACRIFICE_ORDER` — rather than drawn as coloured mush. Clamping silently
    would ship exactly the defect the floor exists to prevent.

    This legitimately raises for `legal` at 1080p: an 11px cap is unreadable
    at three metres by the OOH rule regardless of chroma, so the raise is the
    correct signal, not a tuning problem.
    """
    cap_px = ROLE_FLOOR_VIDEO.get(role, ROLE_FLOOR_VIDEO[_DEFAULT_ROLE]) * panel_height_px
    stem = cap_px * STEM_RATIO
    if stem < MIN_STEM_PX:
        raise ValueError(
            f"role {role!r} floor at {panel_height_px}px panel height yields a "
            f"{stem:.1f}px stem, below the {MIN_STEM_PX}px 4:2:0 survival minimum "
            f"(cap {cap_px:.1f}px) — drop this role at this resolution"
        )
    return stem


def outline_for(
    colour: tuple[int, int, int], bg: tuple[int, int, int], cap_px: float
) -> tuple[int, tuple[int, int, int]]:
    """Stroke width and fill for Pillow's ``stroke_width``/``stroke_fill``.

    `colour` — the glyph fill, already made luma-safe by `readable_on_video`
    — does not decide the outline's own colour: the outline's job is
    anchoring the glyph EDGE against the BACKGROUND in the full-resolution
    luma plane, so its fill maximises |delta Y'| against `bg` the same way
    `readable_on_video` does, independent of what the glyph itself is doing.
    Passed to the SAME `draw.text(..., stroke_width=..., stroke_fill=...)`
    call as the fill colour, so it costs nothing extra to render — one Pillow
    draw call, not two.
    """
    white, black = (255, 255, 255), (17, 17, 17)
    bg_luma = _luma709(bg)
    fill = white if abs(_luma709(white) - bg_luma) >= abs(_luma709(black) - bg_luma) else black
    width = max(2, round(0.045 * cap_px))
    return width, fill
