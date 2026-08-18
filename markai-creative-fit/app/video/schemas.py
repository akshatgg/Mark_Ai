"""The artifacts the video path passes around.

Deliberately shaped like the image path's schemas: flat, pydantic, and carrying
the numbers a CMS operator needs to see rather than internal state.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class VideoProbe(BaseModel):
    """What ffprobe found, after the unspecified-tag heuristic has been applied."""

    width: int
    height: int
    fps: float
    duration_seconds: float
    codec: str
    pix_fmt: str
    has_audio: bool
    size_bytes: int | None = None

    #: Post-heuristic — never "unknown". See probe.py for how these are filled
    #: when the container does not declare them.
    color_space: str
    color_transfer: str
    color_primaries: str
    color_range: str

    #: True when one or more of the four colour tags were unspecified and we
    #: inferred them (not necessarily all four — see probe.py). The CMS
    #: surfaces this, because an inferred guess is worth telling an operator
    #: about when a result looks off.
    color_inferred: bool = False

    #: Degrees from the display matrix. ffmpeg's -autorotate (default on)
    #: applies this during filtering, so our code must NOT rotate again.
    rotation: int = 0

    #: Variable frame rate. Flattened to CFR at the decode boundary so that
    #: frame index and time stay interchangeable.
    is_vfr: bool = False


class FitMode:
    """How to get from the source shape to the target shape."""

    STRETCH = "stretch"
    CROP = "crop"
    REFRAME = "reframe"
    COMPOSE = "compose"


class VideoVariant(BaseModel):
    """One rendered target."""

    width: int
    height: int
    mode: str
    aspect_shift: float
    path: str
    duration_seconds: float | None = None
    bytes: int | None = None
    level: str | None = None
    warnings: list[str] = Field(default_factory=list)


class Shot(BaseModel):
    """One continuous camera take.

    Every temporal assumption in the analysis is per-shot: a mask must never
    bleed across a cut, and "has this overlay moved?" is only meaningful
    within one take.
    """

    index: int
    start_seconds: float
    end_seconds: float
    start_frame: int
    end_frame: int

    @property
    def duration_seconds(self) -> float:
        return self.end_seconds - self.start_seconds


class RegionMotion(BaseModel):
    """The three static tests, kept separate on purpose.

    Conflating them is the classic bug in this area. They answer genuinely
    different questions and a region can pass one and fail another:

      box_static        has the BOX moved? (geometry)
      pixels_static     have the pixels INSIDE it changed? (content)
      background_moves  does the SURROUND move? (is the truth recoverable
                        from other frames, or does it exist nowhere?)

    Only the third decides whether an erase can recover real pixels or must
    invent them.
    """

    box_static: bool
    pixels_static: bool
    background_moves: bool

    #: Median absolute luma difference inside the region, and in a control ring
    #: around it. The ratio is what the decision actually uses — a raw figure
    #: just tracks how much the footage moves.
    mafd_region: float
    mafd_ring: float

    @property
    def mafd_ratio(self) -> float:
        """Region change relative to its surroundings. Below ~0.25 = static.

        Relative rather than absolute because a fixed threshold cannot survive
        a change of bitrate: quantisation resets at every GOP, so a genuinely
        static overlay in a re-encoded ad measures 0.002-0.01, not the 0.001
        that ffmpeg's freezedetect defaults to.
        """
        return self.mafd_region / self.mafd_ring if self.mafd_ring > 0 else 1.0


class TextRegion(BaseModel):
    """One overlay tracked across one shot.

    `erase_box` and `retypeset_box` are deliberately DIFFERENT geometries from
    the same observations, because the two consumers want opposite errors:

      erase_box      the per-edge UNION over the shot. Erasing a
                     few pixels too many is invisible; leaving a glyph fragment
                     is a defect that ships. (A later phase dilates this before
                     inpainting; the value stored here is the raw union.)
      retypeset_box  the per-edge 20th/80th PERCENTILE. Rejects the one frame
                     where the detector's polygon blew out, so re-typeset copy
                     lands where the type actually was.

    The percentile bounds are 20/80, NOT 10/90, and that is load-bearing: at
    SAMPLES_PER_SHOT=7 the 90th percentile interpolates at position 5.4 of
    indices 0-6 and still leaks 40% of an outlier (measured: a high edge of 281
    where it should have been ~202). See tracking.percentile_box, which derives
    the rule. Do not "restore" 10/90 to match an older comment.
    """

    shot_index: int
    role: str
    text: str | None = None

    #: [ymin, xmin, ymax, xmax] normalised 0-1000, matching the image path's
    #: Element.box_2d so the two blueprints read the same way.
    erase_box: list[int]
    retypeset_box: list[int]

    font_family: str | None = None
    color_hex: str | None = None

    #: Share of sampled frames in the shot where this region was detected.
    #: Below the voting threshold it never becomes a TextRegion at all; this is
    #: kept so an operator can see how confident the track was.
    presence: float

    first_seconds: float
    last_seconds: float

    motion: RegionMotion | None = None


class VideoBlueprint(BaseModel):
    """What a finished video ad is made of. The analysis artifact.

    Produced ONCE per creative and cached, exactly like the image path's
    Blueprint: every later stage and every target resolution reads this rather
    than re-running the models. Putting a model call in the render path is what
    destroys the economics.
    """

    duration_seconds: float
    fps: float
    width: int
    height: int
    shots: list[Shot] = Field(default_factory=list)
    regions: list[TextRegion] = Field(default_factory=list)

    #: Dominant background colour of the LAYOUT, as hex. Used by a later phase
    #: when rebuilding a frame rather than repairing one.
    background_hex: str | None = None

    #: Set when analysis ran but a stage degraded (e.g. the model was
    #: unavailable). The CMS surfaces this rather than pretending confidence.
    warnings: list[str] = Field(default_factory=list)

    def regions_in(self, shot_index: int) -> list[TextRegion]:
        return [r for r in self.regions if r.shot_index == shot_index]


class EraseBranch:
    """How one region's overlay gets removed. String constants, matching
    ``FitMode`` above rather than an Enum — this codebase prefers a greppable
    literal in logs and JSON over an Enum's extra indirection here."""

    CLEAN_PLATE = "clean_plate"
    MEDIAN = "median"
    SCRIM = "scrim"


class EraseDecision(BaseModel):
    """The chosen removal method for ONE region in ONE shot, and why.

    `reason` is a free-text explanation, not a structured field, because it
    also has to explain a `median`/`scrim` split: that decision depends on
    test D's verdict (``erase.register.TestDVerdict``, Task 2 — numpy FFT
    phase correlation over the shot, kept out of this pydantic module because
    it carries no data this schema needs to serialise), and the plain-English
    numbers behind that verdict are exactly what makes a scrim demotion
    auditable rather than a bare branch name.
    """

    branch: str
    region: TextRegion
    shot: Shot
    #: LaMa cost actually spent by this decision, in megapixels. Nonzero only
    #: for `clean_plate` — `median` and `scrim` spend no model time.
    cost_mp: float
    reason: str


class ErasePlan(BaseModel):
    """Every region's erase decision for one creative, plus the budget math
    that produced it. Consumed by erase/plate.py (Task 4), which spends the
    time this module only estimates."""

    decisions: list[EraseDecision] = Field(default_factory=list)
    #: Sum of `decisions[*].cost_mp` AFTER any budget demotion — the LaMa time
    #: this plan will actually spend, not the pre-demotion estimate.
    total_cost_mp: float = 0.0
    budget_mp: float = 0.0
    #: Human-legible degradations: budget demotions, regions skipped for a
    #: missing shot, missing motion data. Mirrors VideoBlueprint.warnings.
    warnings: list[str] = Field(default_factory=list)
