"""The font vocabulary shared by the image AND video analysis prompts.

Lives in `app.core`, not `app.layout`, on purpose. `app/video/blueprint.py`'s
Gemini prompt needs the exact same font list `app/layout/rules.py`'s prompt
does — a role means the same thing in both blueprints, so the font vocabulary
should too — but `app/video/` must never import from `app/layout/` (see the
root `CLAUDE.md` and `app/video/__init__.py`: "nothing here imports from
app.blueprint / app.plate / app.layout, and nothing there imports from
here"). `app/video/blueprint.py` importing `FONTS` straight from
`app.layout.rules` violated exactly that rule, and dragged PIL and
`app.blueprint.schemas` (via `app/layout/rules.py`'s own imports) into the
video path along with it. Neither path owns the other, so the shared piece
lives here instead, in the one module both are already allowed to import
from.
"""

from __future__ import annotations

#: Latin display families, all SIL Open Font License. Gemini picks from
#: exactly these names, so whatever comes back resolves to a file we ship.
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
