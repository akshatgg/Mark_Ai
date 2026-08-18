"""The blueprint — what a finished creative is made of.

This is the artifact the whole service is built around. The expensive AI stages
produce it ONCE per creative; every target resolution is then a cheap render
off the same blueprint. Adding a new screen shape later costs a render, not a
re-analysis.
"""

from enum import Enum

from pydantic import BaseModel, Field


class Role(str, Enum):
    HEADLINE = "headline"
    SUBHEAD = "subhead"
    BODY = "body"
    LEGAL = "legal"
    LOGO = "logo"
    PRODUCT = "product"
    #: Text sitting inside a coloured shape — a pill, circle, sticker, ribbon.
    #: The shape is part of the design, so these are lifted as GRAPHICS rather
    #: than erased and retyped. Re-typing "₹3.3Cr* ONWARDS" as two plain lines
    #: loses the red badge it lived in, and the ad stops looking like the ad.
    BADGE = "badge"
    #: Phone, website, address — the reply-to block. Almost always sits in a bar
    #: along the bottom, and belongs in a footer rather than the copy stack.
    CONTACT = "contact"


#: Copy roles, in the order they stack.
TEXT_ROLES: tuple[Role, ...] = (Role.HEADLINE, Role.SUBHEAD, Role.BODY)

#: Roles lifted from the original as pixels instead of being re-rendered.
CUTOUT_ROLES: frozenset[Role] = frozenset({Role.LOGO, Role.BADGE})

#: Roles whose pixels get erased from the background plate. Cutouts are included
#: because they are re-placed elsewhere and must not appear twice.
ERASE_ROLES: frozenset[Role] = frozenset(
    {
        Role.HEADLINE,
        Role.SUBHEAD,
        Role.BODY,
        Role.LEGAL,
        Role.LOGO,
        Role.BADGE,
        Role.CONTACT,
    }
)

#: Drop order when the copy will not fit even at the minimum readable size.
#: Legal goes first; the headline is never dropped.
SACRIFICE_ORDER: tuple[Role, ...] = (Role.LEGAL, Role.BODY, Role.SUBHEAD)


class Element(BaseModel):
    role: Role = Field(description="What this element is for in the ad.")
    box_2d: list[int] = Field(
        description="Bounding box [ymin, xmin, ymax, xmax], normalised 0-1000."
    )
    text: str | None = Field(
        default=None, description="Exact wording. Null for logo/product."
    )
    font_family: str | None = Field(
        default=None, description="Closest match from the supplied font list."
    )
    font_weight: int | None = Field(
        default=None, description="400 regular, 700 bold, 900 black."
    )
    color_hex: str | None = Field(default=None, description="Text colour, e.g. #FFFFFF.")
    font_confidence: float | None = Field(
        default=None, description="0-1 confidence in the font match."
    )

    def pixels(self, width: int, height: int) -> tuple[int, int, int, int]:
        """[ymin,xmin,ymax,xmax] 0-1000 -> (x0, y0, x1, y1) clamped to the image."""
        ymin, xmin, ymax, xmax = self.box_2d
        x0 = max(0, min(width, round(xmin / 1000 * width)))
        y0 = max(0, min(height, round(ymin / 1000 * height)))
        x1 = max(0, min(width, round(xmax / 1000 * width)))
        y1 = max(0, min(height, round(ymax / 1000 * height)))
        if x1 <= x0:
            x1 = min(width, x0 + 1)
        if y1 <= y0:
            y1 = min(height, y0 + 1)
        return x0, y0, x1, y1


class Blueprint(BaseModel):
    elements: list[Element]
    background_hex: str = Field(description="Dominant background colour.")
    background_is_extendable: bool = Field(
        description="True if the background is plain or gradient enough to extend "
        "past its edges without looking fake."
    )

    def by_role(self, role: Role) -> list[Element]:
        return [e for e in self.elements if e.role == role]

    def first(self, role: Role) -> Element | None:
        found = self.by_role(role)
        return found[0] if found else None

    def inside_product(self, element: Element) -> bool:
        """True if ``element`` sat on top of the product shot in the original.

        Those are captions and badges belonging to the photo, not part of the
        copy stack — stacking them with the headline is how "4Bhk Villas" ends
        up floating away from the building it labels.
        """
        product = self.first(Role.PRODUCT)
        if product is None or element is product:
            return False
        py0, px0, py1, px1 = product.box_2d
        ey0, ex0, ey1, ex1 = element.box_2d
        # Centre-in-box: an element straddling the edge belongs to whichever
        # side holds its middle.
        cy, cx = (ey0 + ey1) / 2, (ex0 + ex1) / 2
        return px0 <= cx <= px1 and py0 <= cy <= py1

    def vertical_centre(self, element: Element) -> float:
        """0.0 = top of the original, 1.0 = bottom."""
        return (element.box_2d[0] + element.box_2d[2]) / 2000


class TightBox(BaseModel):
    """Result of the zoomed second pass used to tighten the logo box."""

    box_2d: list[int] = Field(
        description="Tight box [ymin, xmin, ymax, xmax] 0-1000 within THIS crop."
    )
