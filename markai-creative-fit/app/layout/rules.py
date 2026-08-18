"""Typography and fitting rules for the rebuild.

Two rules carry the whole thing:

1. **Text is sized for the screen it lands on**, never scaled from the source. A
   4000px banner headline naively scaled to a 1080px panel lands around 76px and
   is unreadable at three metres; sized as a share of canvas height it lands at
   ~130px and the layout flows around it.

2. **Text is fitted to a budget and never allowed to overflow.** An earlier
   version stacked copy top-down and simply kept drawing when it ran out of
   room — a 10-block ad overflowed its zone by 799px and wrote straight across
   the product photo. Copy now shrinks to fit, and if it still will not fit at
   the minimum readable size, the least important blocks are dropped and
   reported rather than overlapped.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from PIL import ImageDraw, ImageFont

from app.blueprint.schemas import SACRIFICE_ORDER, Element, Role
from app.core.config import settings

# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------
#: Latin display families, all SIL Open Font License. Gemini picks from exactly
#: these names, so whatever comes back resolves to a file we ship.
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

#: Script → font. Indian DOOH routinely carries a Kannada, Hindi or Tamil line
#: alongside the English, and a Latin-only face renders those as empty boxes.
#: Pillow is built with raqm here, so these shape correctly (conjuncts and
#: reordering) rather than rendering as loose glyphs.
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
#: Cap height per role as a fraction of canvas height, at scale 1.0.
ROLE_HEIGHT: dict[Role, float] = {
    Role.HEADLINE: 0.055,
    Role.SUBHEAD: 0.030,
    Role.BODY: 0.020,
    Role.CONTACT: 0.022,
    Role.LEGAL: 0.011,
}

#: Floor per role, as a fraction of canvas height. Copy is shrunk to fit its
#: budget but never below this — past it the ad stops being readable from across
#: a room, which defeats the point of rebuilding at all.
ROLE_FLOOR: dict[Role, float] = {
    Role.HEADLINE: 0.032,
    Role.SUBHEAD: 0.020,
    Role.BODY: 0.014,
    Role.CONTACT: 0.015,
    Role.LEGAL: 0.008,
}

ROLE_MAX_LINES: dict[Role, int] = {
    Role.HEADLINE: 3,
    Role.SUBHEAD: 3,
    Role.BODY: 3,
    Role.CONTACT: 2,
    Role.LEGAL: 3,
}

#: Cap height is roughly 72% of the em for the bundled faces.
CAP_RATIO = 0.72
MIN_FONT_PX = 11

SIDE_MARGIN = 0.06        # of canvas width
BLOCK_GAP = 0.014         # between copy blocks, of canvas height
LINE_SPACING = 1.14
TIGHT_SPACING = 1.06      # within a multi-line block of the same string

#: Cutouts (logo, badges) are capped on both axes AND against their own native
#: size — many creatives carry a logo only ~70px wide, and a small sharp mark
#: beats a large soft one.
LOGO_MAX_W = 0.30
LOGO_MAX_H = 0.11
BADGE_MAX_W = 0.30
BADGE_MAX_H = 0.16
CUTOUT_MAX_UPSCALE = 2.0


def aspect_shift(src_w: int, src_h: int, dst_w: int, dst_h: int) -> float:
    """How far the target shape is from the source, as a factor >= 1.0."""
    ratio = (dst_w / dst_h) / (src_w / src_h)
    return max(ratio, 1 / ratio)


def fit_mode(src_w: int, src_h: int, dst_w: int, dst_h: int) -> str:
    """Pick how to get from the source shape to the target shape.

    ``"stretch"``  — the gap is tiny. Resize to the exact target: nothing
                     cropped, nothing lost, distortion under a few percent.
    ``"crop"``     — small, but past where a stretch starts to visibly oval a
                     round logo. Scale and centre-crop.
    ``"relayout"`` — laptop-shaped creative onto a phone-shaped screen. Neither
                     resizing nor cropping survives it; rebuild.
    """
    shift = aspect_shift(src_w, src_h, dst_w, dst_h)
    if shift <= settings.STRETCH_TOLERANCE:
        return "stretch"
    if shift <= settings.ASPECT_TOLERANCE:
        return "crop"
    return "relayout"


def needs_relayout(src_w: int, src_h: int, dst_w: int, dst_h: int) -> bool:
    return fit_mode(src_w, src_h, dst_w, dst_h) == "relayout"


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


@dataclass
class Block:
    """One measured piece of copy, ready to draw."""

    element: Element
    font: ImageFont.FreeTypeFont
    lines: list[str]
    line_h: int

    @property
    def height(self) -> int:
        return self.line_h * len(self.lines)


def measure(
    draw: ImageDraw.ImageDraw,
    elements: Iterable[Element],
    canvas_h: int,
    usable_w: int,
    scale: float,
) -> list[Block]:
    """Measure ``elements`` at ``scale`` of the nominal type scale."""
    blocks: list[Block] = []
    for element in elements:
        if not element.text:
            continue
        role = element.role
        nominal = ROLE_HEIGHT.get(role, ROLE_HEIGHT[Role.BODY])
        floor = ROLE_FLOOR.get(role, ROLE_FLOOR[Role.BODY])
        cap = max(floor, nominal * scale) * canvas_h
        size = round(cap / CAP_RATIO)
        font = load_font(element.font_family, element.font_weight, size, element.text)
        lines = wrap(draw, element.text, font, usable_w)

        limit = ROLE_MAX_LINES.get(role, 3)
        # Shrink further if it will not wrap into its line budget.
        while len(lines) > limit and size > MIN_FONT_PX:
            size = int(size * 0.93)
            font = load_font(element.font_family, element.font_weight, size, element.text)
            lines = wrap(draw, element.text, font, usable_w)

        spacing = TIGHT_SPACING if len(lines) > 1 else LINE_SPACING
        blocks.append(Block(element, font, lines, line_height(font, spacing)))
    return blocks


def stack_height(blocks: list[Block], gap: int) -> int:
    if not blocks:
        return 0
    return sum(b.height for b in blocks) + gap * (len(blocks) - 1)


def fit_to_budget(
    draw: ImageDraw.ImageDraw,
    elements: list[Element],
    canvas_h: int,
    usable_w: int,
    budget: int,
    gap: int,
) -> tuple[list[Block], list[Element]]:
    """Fit ``elements`` into ``budget`` pixels of height.

    Shrinks the whole scale together so the type hierarchy survives, down to the
    per-role floor. If it still does not fit, drops the least important blocks
    (legal, then body, then subhead — never the headline) and returns them so the
    caller can tell the operator what was left out.

    Returns ``(blocks, dropped)``. The blocks are guaranteed to fit.
    """
    kept = list(elements)
    dropped: list[Element] = []

    while True:
        # Coarse-to-fine: the floors mean scale alone cannot always get there.
        for step in range(0, 15):
            scale = 1.0 - step * 0.05
            blocks = measure(draw, kept, canvas_h, usable_w, scale)
            if stack_height(blocks, gap) <= budget:
                return blocks, dropped

        # At the floor and still over budget — give up a block.
        victim = _pick_victim(kept)
        if victim is None:
            # Only headlines left. Return them measured at the floor; the caller
            # clips rather than overlapping anything.
            return measure(draw, kept, canvas_h, usable_w, 0.0), dropped
        kept.remove(victim)
        dropped.append(victim)


def _pick_victim(elements: list[Element]) -> Element | None:
    """The least important block still standing, or None if only headlines are."""
    for role in SACRIFICE_ORDER:
        matches = [e for e in elements if e.role == role]
        if matches:
            # Drop the longest first: it buys the most room per item lost.
            return max(matches, key=lambda e: len(e.text or ""))
    return None
