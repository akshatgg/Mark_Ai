"""Stage 1 — read a finished creative with Gemini and return a Blueprint.

Two calls per creative:

1. Whole image     → every element, its text, role, font, colour, rough box.
2. Zoomed on logo  → a tight box for the trademark.

The second call is not optional. Whole-image boxes are accurate enough to erase
text, but a loose logo box drags in background pixels and the cutout comes out
carrying a slab of whatever it was sitting on.
"""

import logging
from io import BytesIO

from PIL import Image

from app.blueprint.schemas import CUTOUT_ROLES, Blueprint, Element, TightBox
from app.core.config import settings
from app.layout.rules import FONTS

logger = logging.getLogger(__name__)

PROMPT = """You are analysing a finished advertising creative so it can be
rebuilt at a different screen resolution.

Return EVERY distinct element you can see, tagged with the role it plays:

- `headline`  the main claim or product name, the biggest type on the page
- `subhead`   secondary line supporting the headline
- `body`      supporting detail, features, locations
- `legal`     fine print, registration numbers, disclaimers, copyright
- `contact`   phone number, website, email, address — the reply-to block.
              These usually sit together in a bar along one edge.
- `badge`     text that sits INSIDE a coloured shape: a pill, a circle, a
              sticker, a ribbon, a rounded tag. Price flashes like "50% OFF" or
              "₹3.3Cr ONWARDS" are almost always badges. Tag by the SHAPE it
              sits in, not by what it says. The box must contain the whole
              shape, not just the letters — the shape is kept as artwork.
- `logo`      the brand mark
- `product`   the main product, building or subject being advertised

Rules:
- `text` must be the exact wording, character for character, in the original
  script. Do NOT transliterate or translate. Null for logo/product.
- `box_2d` is [ymin, xmin, ymax, xmax] normalised to 0-1000. Be tight and
  accurate — these boxes drive both erasing and re-placement. A box that is too
  small leaves fragments of the old type behind.
- `font_family` MUST be chosen from this list, whichever looks closest:
  {fonts}
  For text in a non-Latin script, still pick the closest match by weight and
  shape; a matching script font is substituted automatically.
- `font_confidence` is how sure you are about that font match.
- The `product` box must contain the whole product — it is never cropped.
- `background_hex` is the dominant background of the LAYOUT, not of the photo.
  For an ad on a white card with a photo inset, that is the white.

Be exhaustive. A text block you miss survives into the rebuilt ad as a smear."""

REFINE_PROMPT = {
    "logo": (
        "Find the brand logo lockup in this crop. Return the TIGHTEST box that "
        "contains the whole logo and nothing else — no surrounding photo, no "
        "background. [ymin, xmin, ymax, xmax] normalised 0-1000."
    ),
    "badge": (
        "This crop contains a badge: text inside a coloured shape (a pill, "
        "circle, sticker or ribbon). Return the TIGHTEST box containing the "
        "WHOLE shape including its coloured background and any border — not "
        "just the letters. [ymin, xmin, ymax, xmax] normalised 0-1000."
    ),
}


def _client():
    from google import genai

    if not settings.ai_configured:
        raise RuntimeError("Creative fit needs GEMINI_API_KEY.")
    return genai.Client(api_key=settings.GEMINI_API_KEY)


def analyse(image: Image.Image) -> Blueprint:
    """Deconstruct ``image`` into a Blueprint."""
    from google.genai import types

    client = _client()

    buf = BytesIO()
    image.convert("RGB").save(buf, "JPEG", quality=92)
    resp = client.models.generate_content(
        model=settings.AI_MODEL,
        contents=[
            types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
            PROMPT.format(fonts=", ".join(FONTS)),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Blueprint,
            temperature=0.0,
        ),
    )
    blueprint = Blueprint.model_validate_json(resp.text)
    logger.info(
        "blueprint: %d elements (%s)",
        len(blueprint.elements),
        ", ".join(e.role.value for e in blueprint.elements),
    )

    # Anything lifted as artwork needs a tight box, so it is re-asked zoomed in.
    # A loose box drags in background; a tight-but-short one clips the shape.
    for element in blueprint.elements:
        if element.role in CUTOUT_ROLES:
            _refine_cutout(client, image, element)
    return blueprint


def _refine_cutout(client, image: Image.Image, element: Element) -> None:
    """Re-ask for a cutout's box on a zoomed crop, in place."""
    from google.genai import types

    width, height = image.size
    x0, y0, x1, y1 = element.pixels(width, height)

    # Search wider than the reported box so an off-centre first guess still
    # contains the real logo.
    mx, my = round((x1 - x0) * 0.6), round((y1 - y0) * 0.6)
    cx0, cy0 = max(0, x0 - mx), max(0, y0 - my)
    cx1, cy1 = min(width, x1 + mx), min(height, y1 + my)
    crop = image.crop((cx0, cy0, cx1, cy1))

    buf = BytesIO()
    crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS).save(buf, "PNG")
    try:
        resp = client.models.generate_content(
            model=settings.AI_MODEL,
            contents=[
                types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"),
                REFINE_PROMPT[element.role.value],
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=TightBox,
                temperature=0.0,
            ),
        )
        tight = TightBox.model_validate_json(resp.text).box_2d
    except Exception:
        # A loose box still renders; a failed request should not sink the job.
        logger.warning(
            "%s refine failed — keeping first-pass box", element.role.value, exc_info=True
        )
        return

    crop_w, crop_h = cx1 - cx0, cy1 - cy0
    ax0 = cx0 + tight[1] / 1000 * crop_w
    ay0 = cy0 + tight[0] / 1000 * crop_h
    ax1 = cx0 + tight[3] / 1000 * crop_w
    ay1 = cy0 + tight[2] / 1000 * crop_h
    element.box_2d = [
        round(ay0 / height * 1000),
        round(ax0 / width * 1000),
        round(ay1 / height * 1000),
        round(ax1 / width * 1000),
    ]
    logger.info("%s box refined -> %s", element.role.value, element.box_2d)
