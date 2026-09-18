"""Facts derived from a blueprint, shared by the plate and layout stages.

Lives here rather than in either stage because both need the same answer and
importing one from the other would be a cycle.
"""

from PIL import Image, ImageDraw

from app.blueprint.schemas import Blueprint, Role

#: Above this share of the creative needing to be repainted, the background
#: cannot be reconstructed: LaMa runs out of clean context and fills the gaps
#: with text-shaped mush — doubled words, mirrored phone numbers. Measured on a
#: real estate ad that hit 32%, where the result was unusable.
LAYOUT_LED_COVERAGE = 0.20

PHOTO_LED = "photo-led"
LAYOUT_LED = "layout-led"


def mask_coverage(blueprint: Blueprint) -> float:
    """Share of the creative that must be repainted to erase every element.

    Rasterised on a small grid so overlapping boxes are counted once — summing
    box areas double-counts and over-reports badly on dense layouts.
    """
    grid = Image.new("L", (200, 200), 0)
    draw = ImageDraw.Draw(grid)
    for element in blueprint.elements:
        if element.role is Role.PRODUCT:
            continue
        if element.text is None and element.role not in (Role.LOGO, Role.BADGE):
            continue
        y0, x0, y1, x1 = element.box_2d
        draw.rectangle([x0 / 5, y0 / 5, x1 / 5, y1 / 5], fill=255)
    return grid.histogram()[255] / (200 * 200)


def choose_strategy(blueprint: Blueprint) -> str:
    """How to rebuild this creative.

    ``photo-led``  — the ad IS a photograph with a little type on it. Repair the
                     background and reuse it.
    ``layout-led`` — the ad is a designed card: lots of type on a flat ground
                     with a photo inset. Repairing that background is hopeless
                     and unnecessary — rebuild on a fresh card of the same
                     colour and place the photo as an inset.
    """
    return LAYOUT_LED if mask_coverage(blueprint) > LAYOUT_LED_COVERAGE else PHOTO_LED
