"""Stage 3 — compose the blueprint onto a target canvas.

Cheap and deterministic: no model calls. Once a creative has a blueprint and a
plate, each new screen shape is a sub-second render.

The composition is **region-based**, not one flat stack:

    ┌─────────────┐
    │  HEADER     │  logo, and whatever sat beside it
    │  COPY       │  headline · subhead · body, fitted to a budget
    │  STAGE      │  the product shot, with its captions and badges
    │  FOOTER     │  contact block and legal, on a bar
    └─────────────┘

An earlier version stacked every text element top-down in one column and kept
drawing when it ran out of room. On a 13-element ad the copy overflowed by
799px and wrote across the product photo, the logo was hardcoded to the bottom
regardless of where it started, and price badges were retyped as loose text.
Regions exist so each part of the ad keeps its job.
"""

import logging
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFilter

from app.blueprint.analysis import LAYOUT_LED, choose_strategy, mask_coverage
from app.blueprint.schemas import TEXT_ROLES, Blueprint, Element, Role
from app.layout import rules
from app.layout.rules import (
    BADGE_MAX_H,
    BADGE_MAX_W,
    BLOCK_GAP,
    CUTOUT_MAX_UPSCALE,
    LOGO_MAX_H,
    LOGO_MAX_W,
    SIDE_MARGIN,
    Block,
)
from app.plate.service import Parts

logger = logging.getLogger(__name__)

FLAT_TOLERANCE = 26
EDGE_STRIP = 0.03

#: Share of canvas height the product shot aims for, and how far it may be
#: squeezed when the copy needs more room.
STAGE_TARGET = 0.40
STAGE_MIN = 0.24

TOP_MARGIN = 0.045
BOTTOM_MARGIN = 0.035
REGION_GAP = 0.022

#: Anything under this contrast ratio against its background gets swapped for
#: black or white. 3.0 is the WCAG floor for large text.
MIN_CONTRAST = 3.0


@dataclass
class FitResult:
    image: Image.Image
    mode: str                     # "stretch" | "crop" | "relayout"
    aspect_shift: float
    #: Which rebuild was used: "photo-led" (repair the background and reuse it)
    #: or "layout-led" (rebuild on a flat card). Empty for non-relayout modes.
    strategy: str = ""
    #: Copy that would not fit at the minimum readable size. Surfaced rather
    #: than silently overlapped.
    dropped: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Colour
# ---------------------------------------------------------------------------
def _rgb(value: str | None, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    if not value:
        return fallback
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(c * 2 for c in text)
    if len(text) != 6:
        return fallback
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        return fallback


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    parts = []
    for channel in rgb:
        c = channel / 255
        parts.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = _relative_luminance(a), _relative_luminance(b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def readable_on(colour: tuple[int, int, int], background: tuple[int, int, int]):
    """Keep the brand colour when it reads; swap to black/white when it doesn't.

    Gemini reports the colour the type had in the ORIGINAL. Once the layout
    moves, that colour can land on a completely different background — dark grey
    copy that was on white ending up on a photo. Checking is cheap and it is the
    difference between legible and invisible.
    """
    if contrast_ratio(colour, background) >= MIN_CONTRAST:
        return colour
    white, black = (255, 255, 255), (17, 17, 17)
    if contrast_ratio(white, background) >= contrast_ratio(black, background):
        return white
    return black


def sample_colour(image: Image.Image, box: tuple[int, int, int, int]) -> tuple[int, int, int]:
    """Average colour of a region — used to recover the bar a footer sat on."""
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(image.width, max(x1, x0 + 1)), min(image.height, max(y1, y0 + 1))
    return image.crop((x0, y0, x1, y1)).resize((1, 1), Image.BOX).convert("RGB").getpixel((0, 0))


# ---------------------------------------------------------------------------
# Background
# ---------------------------------------------------------------------------
def cover(img: Image.Image, width: int, height: int) -> Image.Image:
    """Scale + centre-crop to exactly width x height, no distortion."""
    scale = max(width / img.width, height / img.height)
    resized = img.resize(
        (max(width, round(img.width * scale)), max(height, round(img.height * scale))),
        Image.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def contain(img: Image.Image, width: int, height: int) -> Image.Image:
    """Scale to fit inside width x height, keeping the whole subject."""
    scale = min(width / img.width, height / img.height)
    return img.resize(
        (max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS
    )


def _edge_colour(plate: Image.Image, top: bool) -> tuple[int, int, int]:
    width, height = plate.size
    strip = max(2, round(height * EDGE_STRIP))
    box = (0, 0, width, strip) if top else (0, height - strip, width, height)
    return plate.crop(box).resize((1, 1), Image.BOX).getpixel((0, 0))


def _edge_is_flat(plate: Image.Image, top: bool) -> bool:
    width, height = plate.size
    strip = max(2, round(height * EDGE_STRIP))
    box = (0, 0, width, strip) if top else (0, height - strip, width, height)
    sample = plate.crop(box).resize((16, 4), Image.BOX)
    avg = _edge_colour(plate, top)
    spread = max(max(abs(px[c] - avg[c]) for c in range(3)) for px in sample.getdata())
    return spread <= FLAT_TOLERANCE


def extend_vertically(plate: Image.Image, canvas_h: int, top: int) -> Image.Image:
    """Grow a short plate to fill a taller canvas.

    Floods the empty space with the plate's own edge colour where that edge is
    flat. Mirror-and-blur is the fallback and it is visibly worse — it smears
    recognisable content, so a ghost phone number can end up floating in the
    blur. It only runs when a solid fill would band.
    """
    width, height = plate.size
    out = Image.new("RGB", (width, canvas_h))
    feather = max(8, round(canvas_h * 0.012))

    def fill(y0: int, y1: int, is_top: bool) -> None:
        if y1 <= y0:
            return
        gap = y1 - y0
        if _edge_is_flat(plate, is_top):
            out.paste(Image.new("RGB", (width, gap), _edge_colour(plate, is_top)), (0, y0))
            return
        src_h = min(height, max(8, gap))
        box = (0, 0, width, src_h) if is_top else (0, height - src_h, width, height)
        strip = plate.crop(box).transpose(Image.FLIP_TOP_BOTTOM)
        out.paste(
            strip.resize((width, gap), Image.LANCZOS).filter(
                ImageFilter.GaussianBlur(max(3, gap * 0.06))
            ),
            (0, y0),
        )

    fill(0, top, True)
    fill(top + height, canvas_h, False)
    out.paste(plate, (0, top))

    for seam in (top, top + height):
        y0, y1 = seam - feather, seam + feather
        if y0 < 0 or y1 > canvas_h:
            continue
        band = out.crop((0, y0, width, y1))
        out.paste(band.filter(ImageFilter.GaussianBlur(feather * 0.45)), (0, y0))
    return out


def rounded(img: Image.Image, radius: int) -> Image.Image:
    """Round an image's corners, alpha-masked. Reads as a deliberate inset
    rather than a photo dropped on a card."""
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------
def scale_cutout(
    img: Image.Image, canvas_w: int, canvas_h: int, max_w: float, max_h: float
) -> tuple[int, int]:
    width = min(canvas_w * max_w, canvas_h * max_h * img.width / img.height)
    width = min(width, img.width * CUTOUT_MAX_UPSCALE)
    width = max(1, round(width))
    return width, max(1, round(img.height * width / img.width))


def draw_blocks(
    draw: ImageDraw.ImageDraw,
    blocks: list[Block],
    x: int,
    y: int,
    gap: int,
    background: tuple[int, int, int],
    shadow: int = 0,
) -> int:
    """Draw a measured stack from ``y`` down. Returns the new y."""
    for index, block in enumerate(blocks):
        colour = readable_on(_rgb(block.element.color_hex, (255, 255, 255)), background)
        for line in block.lines:
            if shadow:
                draw.text((x + shadow, y + shadow), line, font=block.font, fill=(0, 0, 0))
            draw.text((x, y), line, font=block.font, fill=colour)
            y += block.line_h
        if index != len(blocks) - 1:
            y += gap
    return y


# ---------------------------------------------------------------------------
# Compose
# ---------------------------------------------------------------------------
def render(
    original: Image.Image,
    parts: Parts,
    blueprint: Blueprint,
    width: int,
    height: int,
) -> FitResult:
    src_w, src_h = original.size
    shift = rules.aspect_shift(src_w, src_h, width, height)
    mode = rules.fit_mode(src_w, src_h, width, height)

    if mode != "relayout":
        logger.info("%s (shift %.2fx) -> %dx%d", mode, shift, width, height)
        source = original.convert("RGB")
        image = (
            source.resize((width, height), Image.LANCZOS)
            if mode == "stretch"
            else cover(source, width, height)
        )
        return FitResult(image, mode, shift)

    coverage = mask_coverage(blueprint)
    strategy = choose_strategy(blueprint)
    logger.info(
        "relayout (shift %.2fx, %.0f%% of the creative is type) -> %dx%d via %s",
        shift, coverage * 100, width, height, strategy,
    )

    canvas, dropped = _compose(
        original.convert("RGB"), parts, blueprint, width, height, strategy
    )
    return FitResult(canvas, mode, shift, strategy, dropped)


def _group(blueprint: Blueprint) -> dict[str, list[Element]]:
    """Sort the blueprint's text into the region each piece belongs to."""
    header: list[Element] = []
    copy: list[Element] = []
    stage: list[Element] = []
    footer: list[Element] = []

    logo = blueprint.first(Role.LOGO)
    logo_y = blueprint.vertical_centre(logo) if logo else 0.0

    for element in blueprint.elements:
        if element.role in (Role.PRODUCT, Role.LOGO, Role.BADGE) or not element.text:
            continue
        if element.role in (Role.CONTACT, Role.LEGAL):
            footer.append(element)
        elif blueprint.inside_product(element):
            # A caption printed on the photo — it labels the photo, so it
            # travels with it instead of joining the copy stack.
            stage.append(element)
        elif element.role in TEXT_ROLES:
            # Small type sitting level with the logo is a lockup line, not body
            # copy — it belongs with the mark.
            near_logo = logo is not None and abs(blueprint.vertical_centre(element) - logo_y) < 0.08
            if near_logo and element.role is Role.BODY:
                header.append(element)
            else:
                copy.append(element)

    order = {Role.HEADLINE: 0, Role.SUBHEAD: 1, Role.BODY: 2}
    copy.sort(key=lambda e: (order.get(e.role, 3), e.box_2d[0]))
    footer.sort(key=lambda e: (e.role is Role.LEGAL, e.box_2d[0]))
    return {"header": header, "copy": copy, "stage": stage, "footer": footer}


def _compose(
    original: Image.Image,
    parts: Parts,
    blueprint: Blueprint,
    W: int,
    H: int,
    strategy: str,
) -> tuple[Image.Image, list[str]]:
    margin = round(W * SIDE_MARGIN)
    usable = W - 2 * margin
    gap = round(H * BLOCK_GAP)
    region_gap = round(H * REGION_GAP)
    scratch = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    groups = _group(blueprint)
    page_bg = _rgb(blueprint.background_hex, (12, 12, 14))

    # --- cutouts ---------------------------------------------------------
    logo_el = blueprint.first(Role.LOGO)
    logo_img = parts.logo
    logo_size = (
        scale_cutout(logo_img, W, H, LOGO_MAX_W, LOGO_MAX_H) if logo_img else (0, 0)
    )
    # Honour where the mark actually sat. An earlier version pinned every logo
    # to the bottom, which buried a top-left brand mark under the footer.
    logo_at_top = logo_el is None or blueprint.vertical_centre(logo_el) < 0.5

    # --- footer ----------------------------------------------------------
    footer_blocks = rules.measure(scratch, groups["footer"], H, usable, 0.9)
    footer_h = rules.stack_height(footer_blocks, gap)
    footer_bg = page_bg
    if groups["footer"]:
        footer_bg = sample_colour(original, groups["footer"][0].pixels(*original.size))
    footer_band = footer_h + 2 * round(H * 0.018) if footer_blocks else 0

    # --- header ----------------------------------------------------------
    header_blocks = rules.measure(scratch, groups["header"], H, usable, 0.85)
    header_h = max(
        logo_size[1] if logo_at_top else 0,
        rules.stack_height(header_blocks, gap),
    )
    if logo_at_top and header_blocks:
        header_h = logo_size[1] + gap + rules.stack_height(header_blocks, gap)

    # --- divide what is left between the copy and the product ------------
    # Every region is optional. A poster may arrive with no photo, no logo, no
    # contact bar, or nothing but a headline — the split is computed from what
    # is actually present rather than from a fixed template.
    chrome = round(H * TOP_MARGIN) + round(H * BOTTOM_MARGIN) + header_h + footer_band
    free = H - chrome - 2 * region_gap
    if not logo_at_top:
        free -= logo_size[1] + region_gap

    # In photo-led mode the photograph IS the canvas — the plate is stretched
    # across the whole page and the copy sits on it. There is no separate photo
    # block: drawing one would print the same image twice, once as background
    # and once as an inset.
    plate = parts.plate.convert("RGB")
    band_h = round(plate.height * (W / plate.width))

    has_stage = strategy == LAYOUT_LED and blueprint.first(Role.PRODUCT) is not None
    if strategy != LAYOUT_LED:
        # Copy has first claim; the photo takes what is left, between its floor
        # and its target. Words are only dropped once the photo has already been
        # squeezed to its minimum — an ad that cannot be read has failed, an ad
        # with a smaller photo has not.
        # The band keeps its own aspect; copy takes the room above and below it.
        stage_h = min(band_h, max(round(H * STAGE_MIN), free))
    elif has_stage:
        natural = rules.stack_height(
            rules.measure(scratch, groups["copy"], H, usable, 1.0), gap
        )
        stage_h = max(round(H * STAGE_MIN), min(round(H * STAGE_TARGET), free - natural))
    else:
        stage_h = 0
    copy_budget = max(0, free - stage_h)

    copy_blocks, dropped = rules.fit_to_budget(
        scratch, groups["copy"], H, usable, copy_budget, gap
    )

    # Hand slack back: to the photo if there is one, otherwise breathe it into
    # the margins so short copy sits balanced instead of jammed against the top.
    slack = copy_budget - rules.stack_height(copy_blocks, gap)
    lead = 0
    if slack > 0:
        if has_stage:
            stage_h += slack
        elif strategy == LAYOUT_LED:
            # Short copy on a blank card would otherwise sit jammed against the
            # top edge. In photo-led mode the photograph already carries the
            # composition, so nothing is nudged.
            lead = round(slack * 0.38)  # slightly above optical centre

    # A creative with no copy at all is just a picture — let it fill the screen
    # rather than floating a band in a sea of background.
    if strategy != LAYOUT_LED and not (copy_blocks or header_blocks or footer_blocks):
        canvas = cover(plate, W, H)
        _draw_stage(
            canvas, ImageDraw.Draw(canvas), parts, blueprint, groups["stage"],
            0, 0, W, H, W, H, strategy, gap,
        )
        return canvas, []

    # --- positions, before anything is drawn ------------------------------
    # The canvas cannot be built until the stage position is known: in photo-led
    # mode the photograph is the background, and it has to land exactly where
    # the stage region sits so captions and badges fall on it.
    footer_top = H - round(H * BOTTOM_MARGIN) - footer_band
    stage_bottom = footer_top - (region_gap if footer_band else 0)
    if not logo_at_top and logo_img is not None:
        stage_bottom -= logo_size[1] + region_gap

    y = round(H * TOP_MARGIN) + lead
    logo_top = y
    if logo_at_top and logo_img is not None:
        y += logo_size[1] + (gap if header_blocks else 0)
    header_top = y
    if header_blocks:
        y += rules.stack_height(header_blocks, gap)
    if groups["header"] or (logo_at_top and logo_img is not None):
        y += region_gap
    copy_top = y
    if copy_blocks:
        y += rules.stack_height(copy_blocks, gap) + region_gap
    stage_top = y
    stage_h = max(0, min(stage_h, stage_bottom - stage_top))

    # --- canvas ------------------------------------------------------------
    if strategy == LAYOUT_LED:
        canvas = Image.new("RGB", (W, H), page_bg)
        body_bg = page_bg
    else:
        band = plate.resize((W, band_h), Image.LANCZOS)
        if band_h >= H:
            canvas = cover(band, W, H)
        else:
            canvas = extend_vertically(band, H, max(0, min(stage_top, H - band_h)))
        body_bg = _edge_colour(plate, True)

    draw = ImageDraw.Draw(canvas)
    shadow = 0 if strategy == LAYOUT_LED else max(1, round(H * 0.0026))

    # --- header ------------------------------------------------------------
    if logo_at_top and logo_img is not None:
        scaled = logo_img.resize(logo_size, Image.LANCZOS)
        canvas.paste(scaled, (margin, logo_top), scaled)
    if header_blocks:
        draw_blocks(draw, header_blocks, margin, header_top, gap, body_bg, shadow)

    # --- copy --------------------------------------------------------------
    if copy_blocks:
        draw_blocks(draw, copy_blocks, margin, copy_top, gap, body_bg, shadow)

    # --- stage: the photo inset, plus captions and badges ------------------
    if stage_h > round(H * 0.05):
        _draw_stage(
            canvas, draw, parts, blueprint, groups["stage"],
            margin, stage_top, usable, stage_h, W, H, strategy, gap,
        )

    # --- logo at the bottom, where it started -----------------------------
    if not logo_at_top and logo_img is not None:
        scaled = logo_img.resize(logo_size, Image.LANCZOS)
        canvas.paste(scaled, (margin, footer_top - region_gap - logo_size[1]), scaled)

    # --- footer bar -------------------------------------------------------
    if footer_blocks:
        if contrast_ratio(footer_bg, page_bg) > 1.6:
            # The contacts sat on their own bar in the original — keep it.
            draw.rectangle([0, footer_top, W, H], fill=footer_bg)
        pad = round(H * 0.018)
        draw_blocks(draw, footer_blocks, margin, footer_top + pad, gap, footer_bg, shadow)

    return canvas, [e.text or "" for e in dropped]


def _draw_stage(
    canvas: Image.Image,
    draw: ImageDraw.ImageDraw,
    parts: Parts,
    blueprint: Blueprint,
    captions: list[Element],
    x: int,
    y: int,
    usable: int,
    stage_h: int,
    W: int,
    H: int,
    strategy: str,
    gap: int,
) -> None:
    """Place the product shot's captions and badges.

    In layout-led mode the photo is pasted here as a rounded inset on the card.
    In photo-led mode the photo is already the background — this only overlays
    the captions and badges onto it.
    """
    if strategy == LAYOUT_LED:
        product = blueprint.first(Role.PRODUCT)
        source = parts.plate.convert("RGB")
        if product is not None:
            source = source.crop(product.pixels(*source.size))
        photo = contain(source, usable, stage_h)
        photo = rounded(photo, round(min(photo.size) * 0.035))
        px = x + (usable - photo.width) // 2
        py = y + (stage_h - photo.height) // 2
        canvas.paste(photo, (px, py), photo)
        frame = (px, py, px + photo.width, py + photo.height)
    else:
        frame = (x, y, x + usable, y + stage_h)

    # Captions sit on the photo, so they get a scrim to stay readable over
    # whatever is behind them. Measured first, because the badges have to stay
    # clear of the band it occupies.
    band_top = frame[3]
    if captions:
        scratch = ImageDraw.Draw(Image.new("RGB", (1, 1)))
        blocks = rules.measure(scratch, captions, H, round(usable * 0.62), 0.85)
        pad = round(H * 0.012)
        band_top = max(frame[1], frame[3] - rules.stack_height(blocks, gap) - 2 * pad)
        scrim = Image.new("RGBA", (frame[2] - frame[0], frame[3] - band_top), (0, 0, 0, 150))
        canvas.paste(scrim, (frame[0], band_top), scrim)
        draw_blocks(draw, blocks, frame[0] + pad * 2, band_top + pad, gap, (0, 0, 0), 0)

    # Badges are artwork lifted from the original — the shape IS the design, so
    # they are pasted, never retyped. Kept inside the photo but above the caption
    # band; a badge sitting on the caption reads as a mistake.
    badges = [b for b in parts.badges if b is not None]
    if not badges:
        return
    inset = round(W * 0.012)
    headroom = max(round(H * 0.05), band_top - frame[1] - 2 * inset)
    bx, by = frame[2] - inset, frame[1] + inset
    for badge in badges[:2]:
        bw, bh = scale_cutout(badge, W, H, BADGE_MAX_W, BADGE_MAX_H)
        if bh > headroom:  # shrink to the room actually available
            bw, bh = max(1, round(bw * headroom / bh)), headroom
        if by + bh > band_top:
            break
        scaled = badge.resize((bw, bh), Image.LANCZOS)
        bx -= bw
        canvas.paste(scaled, (max(frame[0] + inset, bx), by), scaled)
        by += bh + inset
        headroom -= bh + inset
        bx = frame[2] - inset


def letterbox(original: Image.Image, width: int, height: int) -> Image.Image:
    """Safe fallback: the untouched creative on a blurred backdrop of itself."""
    backdrop = cover(original.convert("RGB"), width, height).filter(
        ImageFilter.GaussianBlur(max(8, round(min(width, height) * 0.04)))
    )
    fitted = contain(original.convert("RGB"), width, height)
    backdrop.paste(fitted, ((width - fitted.width) // 2, (height - fitted.height) // 2))
    return backdrop
