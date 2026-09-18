"""Removing a baked-in overlay: which method, per region per shot.

    router.py    per-region branch decision (Task 1, this task)
    register.py  numpy FFT phase correlation -> test D's camera verdict (Task 2)
    plate.py     builds the erased mezzanine (Task 4)
    scrim.py     the designed-cover fallback (Task 4)
    flicker.py   the flicker ratio metric (Task 4)

Imports nothing from app.blueprint / app.plate / app.layout except the leaf
module app.plate.lama.inpaint, per the image path's freeze (see the root
CLAUDE.md and this repo's CLAUDE.md).
"""

from __future__ import annotations
