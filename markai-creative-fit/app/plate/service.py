"""Stage 2 — turn the creative + blueprint into reusable parts.

Produces three artifacts, all cached per creative and all at the creative's
native resolution:

* **plate**   — the background with type erased, for the rebuild to draw on.
* **logo**    — the brand mark, cut from the ORIGINAL pixels, background removed.
* **badges**  — price flashes and pills, cut out as ARTWORK. Re-typing
                "₹3.3Cr* ONWARDS" as two plain lines throws away the red circle
                it lived in, and the ad stops looking like the ad.

Nothing here regenerates brand imagery. LaMa only ever fills areas we deleted.
"""

import logging
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFilter

from app.blueprint.analysis import LAYOUT_LED, choose_strategy
from app.blueprint.schemas import CUTOUT_ROLES, ERASE_ROLES, Blueprint, Role
from app.plate import cutout, lama

logger = logging.getLogger(__name__)

#: Mask padding, as a fraction of each BOX's own size rather than the image's.
#:
#: Two things sit outside a reported box: anti-aliased glyph edges and shadows,
#: and — the bigger problem — the model's own inconsistency. The same creative
#: analysed twice returned a headline box 27% shorter the second time, and the
#: erase left a white smear where the descenders had been. Padding relative to
#: the box absorbs that; a flat few pixels does not.
#:
#: Vertical is the generous axis because box height is what varies: ascenders
#: and descenders are what get clipped. Over-erasing costs nothing — LaMa fills
#: it with background, which is what was there anyway.
MASK_PAD_Y = 0.22
MASK_PAD_X = 0.04
MASK_PAD_MIN = 4

#: Cutouts are cropped a little WIDER than the reported box. The zoomed refine
#: pass is told to return the tightest box possible, and it obliges — a motorola
#: wordmark came back sheared off at the baseline. u2net removes the surrounding
#: background anyway, so a generous crop costs nothing and a tight one clips the
#: brand mark.
CUTOUT_PAD = 0.08
CUTOUT_PAD_MIN = 3


@dataclass
class Parts:
    plate: Image.Image
    logo: Image.Image | None = None
    badges: list[Image.Image] = field(default_factory=list)


def build_mask(
    image: Image.Image, blueprint: Blueprint, product_only: bool = False
) -> Image.Image:
    """White wherever the original type has to be repainted.

    ``product_only`` limits the mask to elements printed ON the product shot.
    That is what a layout-led rebuild needs: the flat background is being
    replaced wholesale, so repainting it is wasted work — and a huge mask is
    exactly what makes LaMa hallucinate. Keeping the mask small and local is the
    difference between a clean photo and mirrored gibberish.
    """
    width, height = image.size
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)

    count = 0
    for element in blueprint.elements:
        if element.role not in ERASE_ROLES:
            continue
        if product_only and not blueprint.inside_product(element):
            continue
        x0, y0, x1, y1 = element.pixels(width, height)
        pad_x = max(MASK_PAD_MIN, round((x1 - x0) * MASK_PAD_X))
        pad_y = max(MASK_PAD_MIN, round((y1 - y0) * MASK_PAD_Y))
        draw.rectangle([x0 - pad_x, y0 - pad_y, x1 + pad_x, y1 + pad_y], fill=255)
        count += 1
    logger.info("erase mask: %d regions%s", count, " (product only)" if product_only else "")
    return mask


def build(
    image: Image.Image, blueprint: Blueprint, analysis: Image.Image | None = None
) -> Parts:
    """Erase the type and lift the artwork, at ``image``'s native resolution.

    ``analysis`` is an optional downscaled copy for LaMa to work on. Where one is
    given, the inpainted result is composited back onto the full-resolution
    original through the erase mask — so ONLY the erased regions carry the
    upscale, and by then those regions are smooth background. The product shot
    and every other pixel stay native.

    Running LaMa at full resolution instead would be slower and worse: it is
    trained at 512 and degrades well above ~2K.
    """
    full = image.convert("RGB")
    work = (analysis or full).convert("RGB")
    product_only = choose_strategy(blueprint) == LAYOUT_LED

    mask = build_mask(work, blueprint, product_only=product_only)
    if mask.getbbox() is None:
        plate = full  # nothing to erase
    else:
        plate = lama.inpaint(work, mask)
        if work.size != full.size:
            plate = plate.resize(full.size, Image.LANCZOS)
            # Feather the join so the boundary between upscaled fill and native
            # pixels is a gradient, not a visible rectangle.
            seam = max(2, round(min(full.size) * 0.002))
            blend = build_mask(full, blueprint, product_only=product_only).filter(
                ImageFilter.GaussianBlur(seam)
            )
            plate = Image.composite(plate, full, blend)
            logger.info("plate composited back to native %dx%d", *full.size)

    logo_img: Image.Image | None = None
    badges: list[Image.Image] = []
    for element in blueprint.elements:
        if element.role not in CUTOUT_ROLES:
            continue
        # Cut from the full-resolution original. These are brand assets — a mark
        # lifted from the downscaled copy would be soft on a 4K panel.
        piece = cutout.cut_out(full.crop(element.pixels(*full.size)))
        if element.role is Role.LOGO and logo_img is None:
            logo_img = piece
            logger.info("logo cutout %dx%d", piece.width, piece.height)
        elif element.role is Role.BADGE:
            badges.append(piece)
            logger.info("badge cutout %dx%d", piece.width, piece.height)

    return Parts(plate=plate, logo=logo_img, badges=badges)
