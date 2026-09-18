# WhatsApp Structured Booking Slips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-paragraph confirm / done messages the WhatsApp co-pilot sends with a labelled, multi-line "slip" (one fact per line, warnings pulled out into their own block) — content unchanged, only the layout.

**Architecture:** Every write proposal already carries a flat `summary` string. We add an optional structured `detail` next to it (`title`, `fields`, `notes`, `warnings`) at the one place proposals are made (`_propose` in `app/ai/tools.py`), persist it on the action card, and add a pure module `app/whatsapp/slip.py` that renders `detail` into WhatsApp text for the three shapes: single proposal, multi-proposal, and "done". Old persisted cards without `detail` fall back to the flat summary, so nothing breaks. The browser CMS keeps reading `summary` and is untouched.

**Tech Stack:** Python 3.11 / FastAPI / pydantic-ai tools, pytest (async), WhatsApp Cloud API markup (`*bold*`, `_italic_`, `•`).

## Global Constraints

- Repo: `markai-signage-api/` (paths below are relative to it). Work on a branch off `main`: `git checkout -b feat/whatsapp-structured-slips`.
- **No Claude `Co-Authored-By` trailer on commits** (user rule). Do not push unless asked.
- **Do not run `pytest` yourself** unless the user says to; the house rule is: write the tests, verify with `poetry run python -c "import app.whatsapp.slip"` / `poetry run ruff check <files>`, and the user runs the suite. Where a step says "Run: pytest…", treat it as "run if permitted, otherwise report the command to the user".
- WhatsApp limits (`app/whatsapp/render.py` header): text body 4096 chars, **interactive-buttons body 1024 chars**, ≤3 buttons of ≤20 chars. Markup is `*bold*`, `_italic_`, `•` bullets — never markdown `**`.
- The `to_whatsapp_markup()` function must remain idempotent; slip text is passed through it and must not change.
- Content of the messages is unchanged: same campaign/screen/schedule/dates and the same warning sentences the tools already produce. Only layout changes.
- Existing keys `summary`, `label`, `args`, `tool`, `id`, `executed`, `dismissed` on card actions keep their exact meaning; `detail` is purely additive and optional.

---

## File Map

| File | Change |
|---|---|
| `app/whatsapp/slip.py` | **Create.** Pure formatting: `proposal_body()`, `done_body()`, `DONE_HEADINGS`, `PROPOSAL_HEADINGS`. |
| `tests/test_whatsapp_slip.py` | **Create.** Unit tests for the slip renderer. |
| `app/ai/tools.py` | `_propose(..., detail=None)` stores `detail`; `create_booking` builds a full detail; the seven other write tools build a title + 1–2 fields. |
| `app/ai/agent.py:512-520` | Copy `detail` from proposal onto the persisted action. |
| `app/ai/confirm_service.py:146-160` | `execute_actions` also returns `"actions": [...]` (the executed action dicts). |
| `app/whatsapp/render.py` | `card_to_messages` uses `slip.proposal_body`; splits into text + short-bodied buttons when the body would exceed 1024. |
| `app/whatsapp/inbound.py:231` | Done reply uses `slip.done_body(outcome["actions"])`. |
| `tests/test_whatsapp_render.py` | Extend `TestCards` for the new bodies. |
| `tests/test_ai_confirm.py` | One assertion that `execute_actions` returns `actions`. |

## The `detail` shape (contract used by every task)

```python
detail = {
    "title": "New booking",                      # noun phrase, no emoji, no verb tense
    "fields": [["Campaign", "fadw campaign"],    # ordered [label, value] pairs, strings
               ["Screen", "Droidlogic ohm (Bengaluru)"],
               ["Schedule", "Continuous"],
               ["Dates", "18 Aug 2026 → 18 Aug 2026"]],
    "notes": ["no daily window was given, so this booking inherits the SCREEN's operating hours (09:00–17:00) — it does not run 24 hours"],
    "warnings": [{"tag": "offline",
                  "text": "this screen is currently OFFLINE (last seen 18 Aug 17:35 IST) — the ad will NOT play until the screen comes back online"},
                 {"tag": "creative fit",
                  "text": "the creative is portrait (900x1600) but the screen is landscape (1920x1080) — it will play letterboxed or cropped"}],
}
```
`tag` is a ≤3-word flag used in the multi-proposal list; `text` is the full sentence the tool already generates. All keys optional except `title`.

---

### Task 1: The slip renderer (`app/whatsapp/slip.py`)

**Files:**
- Create: `app/whatsapp/slip.py`
- Test: `tests/test_whatsapp_slip.py`

**Interfaces:**
- Produces:
  - `proposal_body(actions: list[dict]) -> str` — WhatsApp text for one or many pending actions.
  - `done_body(actions: list[dict]) -> str` — WhatsApp text after execution.
  - `PROPOSAL_HEADINGS: dict[str, str]`, `DONE_HEADINGS: dict[str, str]` keyed by tool name.
  - Each `action` dict is a card action: `{"tool", "summary", "label"?, "detail"?}`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_whatsapp_slip.py
"""The WhatsApp slip: one fact per line, warnings in their own block."""
from app.whatsapp import slip


def _booking(screen="Droidlogic ohm (Bengaluru)", warnings=None, notes=None):
    return {
        "id": "0", "tool": "create_booking", "label": "Droidlogic ohm",
        "summary": "Create booking 'fadw campaign' on 'Droidlogic ohm' (Bengaluru) "
                   "(continuous, 18 Aug 2026 → 18 Aug 2026)",
        "detail": {
            "title": "New booking",
            "fields": [["Campaign", "fadw campaign"], ["Screen", screen],
                       ["Schedule", "Continuous"],
                       ["Dates", "18 Aug 2026 → 18 Aug 2026"]],
            "notes": notes or [],
            "warnings": warnings or [],
        },
    }


OFFLINE = {"tag": "offline",
           "text": "this screen is currently OFFLINE (last seen 18 Aug 17:35 IST) — "
                   "the ad will NOT play until the screen comes back online"}
FIT = {"tag": "portrait creative",
       "text": "the creative is portrait (900x1600) but the screen is landscape "
               "(1920x1080) — it will play letterboxed or cropped"}


class TestSingleProposal:
    def test_one_fact_per_line_with_bold_labels(self):
        body = slip.proposal_body([_booking()])
        lines = body.split("\n")
        assert lines[0] == "📋 *New booking*"
        assert "*Campaign:* fadw campaign" in lines
        assert "*Screen:* Droidlogic ohm (Bengaluru)" in lines
        assert "*Schedule:* Continuous" in lines
        assert "*Dates:* 18 Aug 2026 → 18 Aug 2026" in lines
        # No warnings → no heads-up block, but the footer is there.
        assert "Heads-up" not in body
        assert body.endswith("Confirm to book, Change to edit, Cancel to drop it.")

    def test_warnings_become_their_own_bulleted_block(self):
        body = slip.proposal_body([_booking(warnings=[OFFLINE, FIT])])
        assert "\n\n⚠️ *Heads-up*\n" in body
        assert "• This screen is currently OFFLINE" in body   # capitalised, full text
        assert "• The creative is portrait (900x1600)" in body
        # Warnings never sit on the same line as a field.
        for line in body.split("\n"):
            if line.startswith("*Dates:*"):
                assert "OFFLINE" not in line

    def test_notes_are_info_lines(self):
        note = ("no daily window was given, so this booking inherits the SCREEN's "
                "operating hours (09:00–17:00) — it does not run 24 hours")
        body = slip.proposal_body([_booking(notes=[note])])
        assert "ℹ️ No daily window was given" in body

    def test_falls_back_to_summary_when_no_detail(self):
        a = {"id": "0", "tool": "create_booking", "summary": "Book it on X"}
        body = slip.proposal_body([a])
        assert body.startswith("📋 *New booking*")
        assert "Book it on X" in body

    def test_unknown_tool_gets_generic_heading(self):
        a = {"id": "0", "tool": "frobnicate", "summary": "Frob the nicate"}
        assert slip.proposal_body([a]).startswith("📋 *Action*")


class TestMultiProposal:
    def test_shared_facts_go_in_header_and_screens_are_numbered(self):
        acts = [_booking("Droidlogic ohm (Bengaluru)", warnings=[OFFLINE]),
                _booking("Cafe Blue (Indiranagar)"),
                _booking("Metro Hub (MG Road)", warnings=[FIT])]
        for i, a in enumerate(acts):
            a["id"] = str(i)
        body = slip.proposal_body(acts)
        lines = body.split("\n")
        # Header carries the count and the facts every action shares.
        assert lines[0].startswith("📋 *3 bookings ready*")
        assert "fadw campaign" in lines[0]
        assert "Continuous" in lines[0]
        assert "18 Aug 2026 → 18 Aug 2026" in lines[0]
        # Screen differs per action → it is what each numbered line shows.
        assert "1. Droidlogic ohm (Bengaluru)   ⚠️ offline" in lines
        assert "2. Cafe Blue (Indiranagar)" in lines
        assert "3. Metro Hub (MG Road)   ⚠️ portrait creative" in lines
        assert body.endswith("Tap a screen to confirm it alone, or Confirm all.")

    def test_mixed_tools_use_plain_actions_heading(self):
        acts = [_booking(),
                {"id": "1", "tool": "update_screen", "summary": "Update screen X",
                 "detail": {"title": "Screen update",
                            "fields": [["Screen", "X"], ["Hours", "09:00–21:00"]]}}]
        body = slip.proposal_body(acts)
        assert body.startswith("📋 *2 actions ready*")
        assert "1. New booking — Droidlogic ohm (Bengaluru)" in body
        assert "2. Screen update — X" in body


class TestDone:
    def test_single_done_repeats_the_slip_with_a_verdict_heading(self):
        body = slip.done_body([_booking(warnings=[OFFLINE, FIT])])
        lines = body.split("\n")
        assert lines[0] == "✅ *Booked*"
        assert "*Campaign:* fadw campaign" in lines
        assert "*Screen:* Droidlogic ohm (Bengaluru)" in lines
        assert "*Schedule:* Continuous · 18 Aug 2026 → 18 Aug 2026" in lines
        assert "⚠️ This screen is currently OFFLINE" in body
        assert "⚠️ The creative is portrait" in body
        assert "Confirm to book" not in body

    def test_multi_done_lists_each(self):
        acts = [_booking("A (X)"), _booking("B (Y)")]
        body = slip.done_body(acts)
        assert body.startswith("✅ *2 bookings done*")
        assert "1. A (X)" in body and "2. B (Y)" in body

    def test_done_headings_cover_every_write_tool(self):
        for tool in ["create_booking", "set_booking_status", "delete_booking",
                     "toggle_premium_screenshots", "update_screen",
                     "add_loop_item", "remove_loop_item"]:
            assert tool in slip.DONE_HEADINGS
            assert tool in slip.PROPOSAL_HEADINGS

    def test_done_without_detail_uses_summary(self):
        a = {"id": "0", "tool": "delete_booking", "summary": "Cancel booking 123"}
        body = slip.done_body([a])
        assert body.startswith("✅ *Booking cancelled*")
        assert "Cancel booking 123" in body
```

- [ ] **Step 2: Run to verify it fails**

Run: `poetry run pytest tests/test_whatsapp_slip.py -q`
Expected: `ImportError: cannot import name 'slip'`

- [ ] **Step 3: Implement `app/whatsapp/slip.py`**

```python
"""The WhatsApp "slip": a proposal or a result laid out one fact per line.

The co-pilot's tools describe each write with a flat ``summary`` sentence, which
is fine on a wide browser card and unreadable as a WhatsApp bubble — a booking,
its dates and two warnings all end up in one 300-character paragraph. Tools may
also attach a structured ``detail`` (title / fields / notes / warnings); this
module turns that into text with labelled lines and a separate warnings block,
and falls back to the summary when a stored card predates ``detail``.

Every function here is pure and takes card ACTION dicts as stored on the turn.
"""

from __future__ import annotations

# tool name → heading nouns. Proposal = what is about to happen; done = verdict.
PROPOSAL_HEADINGS: dict[str, str] = {
    "create_booking": "New booking",
    "set_booking_status": "Booking status change",
    "delete_booking": "Cancel booking",
    "toggle_premium_screenshots": "Screenshot setting",
    "update_screen": "Screen update",
    "add_loop_item": "Add to loop",
    "remove_loop_item": "Remove from loop",
}
DONE_HEADINGS: dict[str, str] = {
    "create_booking": "Booked",
    "set_booking_status": "Status updated",
    "delete_booking": "Booking cancelled",
    "toggle_premium_screenshots": "Screenshots updated",
    "update_screen": "Screen updated",
    "add_loop_item": "Added to loop",
    "remove_loop_item": "Removed from loop",
}
# Plural nouns for the multi-action header, by tool. Anything mixed → "actions".
PLURAL: dict[str, str] = {"create_booking": "bookings"}

SINGLE_FOOTER = "Confirm to book, Change to edit, Cancel to drop it."
MULTI_FOOTER = "Tap a screen to confirm it alone, or Confirm all."


def _cap(s: str) -> str:
    s = (s or "").strip()
    return s[:1].upper() + s[1:] if s else s


def _detail(a: dict) -> dict:
    return a.get("detail") or {}


def _title(a: dict, headings: dict[str, str], default: str) -> str:
    return _detail(a).get("title") or headings.get(a.get("tool") or "", default)


def _fields(a: dict) -> list[list[str]]:
    return [[str(k), str(v)] for k, v in (_detail(a).get("fields") or []) if v]


def _warnings(a: dict) -> list[dict]:
    return [w for w in (_detail(a).get("warnings") or []) if w.get("text")]


def _notes(a: dict) -> list[str]:
    return [n for n in (_detail(a).get("notes") or []) if n]


def _field_lines(fields: list[list[str]]) -> list[str]:
    return [f"*{k}:* {v}" for k, v in fields]


def _first_field(a: dict, label: str) -> str | None:
    for k, v in _fields(a):
        if k == label:
            return v
    return None


def _identity(a: dict) -> str:
    """The one line that tells this action apart from its neighbours."""
    return (_first_field(a, "Screen") or a.get("label")
            or _first_field(a, "Campaign") or a.get("summary") or "action")


# ---------------------------------------------------------------- proposals

def _single_proposal(a: dict) -> str:
    out = [f"📋 *{_title(a, PROPOSAL_HEADINGS, 'Action')}*", ""]
    fields = _fields(a)
    if fields:
        out += _field_lines(fields)
    else:
        out.append(a.get("summary") or "")
    notes = _notes(a)
    if notes:
        out.append("")
        out += [f"ℹ️ {_cap(n)}" for n in notes]
    warns = _warnings(a)
    if warns:
        out += ["", "⚠️ *Heads-up*"]
        out += [f"• {_cap(w['text'])}" for w in warns]
    out += ["", SINGLE_FOOTER]
    return "\n".join(out).strip()


def _shared_fields(actions: list[dict]) -> list[list[str]]:
    """[label, value] pairs identical across EVERY action, in first-action order."""
    first = _fields(actions[0])
    if not first:
        return []
    others = [{tuple(f) for f in _fields(a)} for a in actions[1:]]
    return [f for f in first if all(tuple(f) in o for o in others)]


def _multi_proposal(actions: list[dict]) -> str:
    tools = {a.get("tool") for a in actions}
    same_tool = len(tools) == 1
    tool = next(iter(tools)) if same_tool else None
    noun = PLURAL.get(tool or "", "actions")
    header = f"📋 *{len(actions)} {noun} ready*"
    shared = _shared_fields(actions) if same_tool else []
    shared_set = {tuple(f) for f in shared}
    if shared:
        header += " — " + " · ".join(v for _, v in shared)
    out = [header, ""]
    for i, a in enumerate(actions, 1):
        if same_tool:
            own = [v for k, v in _fields(a) if (k, v) not in shared_set]
            line = own[0] if own else _identity(a)
        else:
            line = f"{_title(a, PROPOSAL_HEADINGS, 'Action')} — {_identity(a)}"
        tags = [w["tag"] for w in _warnings(a) if w.get("tag")]
        if tags:
            line += "   ⚠️ " + ", ".join(tags)
        out.append(f"{i}. {line}")
    out += ["", MULTI_FOOTER]
    return "\n".join(out)


def proposal_body(actions: list[dict]) -> str:
    """WhatsApp text for the pending action(s) on a card."""
    if not actions:
        return ""
    if len(actions) == 1:
        return _single_proposal(actions[0])
    return _multi_proposal(actions)


# ---------------------------------------------------------------- done

def _single_done(a: dict) -> str:
    out = [f"✅ *{_title(a, DONE_HEADINGS, 'Done')}*", ""]
    fields = _fields(a)
    if fields:
        # Fold the dates into the schedule line: the result reads as one slip,
        # and the verdict heading has already said what happened.
        merged: list[list[str]] = []
        for k, v in fields:
            if k == "Dates" and merged and merged[-1][0] == "Schedule":
                merged[-1][1] = f"{merged[-1][1]} · {v}"
            else:
                merged.append([k, v])
        out += _field_lines(merged)
    else:
        out.append(a.get("summary") or "")
    extras = [f"ℹ️ {_cap(n)}" for n in _notes(a)]
    extras += [f"⚠️ {_cap(w['text'])}" for w in _warnings(a)]
    if extras:
        out.append("")
        out += extras
    return "\n".join(out).strip()


def done_body(actions: list[dict]) -> str:
    """WhatsApp text after the action(s) executed."""
    if not actions:
        return "✅ Done"
    if len(actions) == 1:
        return _single_done(actions[0])
    tools = {a.get("tool") for a in actions}
    noun = PLURAL.get(next(iter(tools)), "actions") if len(tools) == 1 else "actions"
    out = [f"✅ *{len(actions)} {noun} done*", ""]
    for i, a in enumerate(actions, 1):
        line = _identity(a)
        tags = [w["tag"] for w in _warnings(a) if w.get("tag")]
        if tags:
            line += "   ⚠️ " + ", ".join(tags)
        out.append(f"{i}. {line}")
    return "\n".join(out)
```

Notes for the implementer: the proposal `title` heading in the single case is the detail's own title when present, so `"New booking"` comes from the tool; the map is only the fallback for cards without `detail`. In `_single_done` the "Schedule · Dates" fold is what makes `*Schedule:* Continuous · 18 Aug 2026 → 18 Aug 2026` in the test.

- [ ] **Step 4: Run tests**

Run: `poetry run pytest tests/test_whatsapp_slip.py -q`
Expected: all pass. Also `poetry run ruff check app/whatsapp/slip.py tests/test_whatsapp_slip.py`.

- [ ] **Step 5: Commit**

```bash
git add app/whatsapp/slip.py tests/test_whatsapp_slip.py
git commit -m "feat(whatsapp): slip renderer — one fact per line, warnings in their own block"
```

---

### Task 2: `_propose` carries `detail`; `create_booking` builds a full one

**Files:**
- Modify: `app/ai/tools.py:1712-1730` (`_propose`) and `app/ai/tools.py:1917-1990` (`create_booking` warnings → summary → `_propose`)
- Modify: `app/ai/agent.py:512-520`
- Test: `tests/test_ai_booking_naming.py` (add one test next to the existing proposal tests — it already drives `create_booking` end-to-end and inspects `deps.proposals`; copy its fixture pattern)

**Interfaces:**
- Consumes: the `detail` contract above.
- Produces: `_propose(ctx, tool, args, summary, label=None, detail=None)`; proposal dicts gain `"detail"` when given; persisted card actions gain `"detail"`.

- [ ] **Step 1: Write the failing test**

Open `tests/test_ai_booking_naming.py`, find the existing test that calls `create_booking` and asserts on `deps.proposals[0]["summary"]` (search `proposals[0]`). Add directly after it, reusing the same fixtures/helper it uses to invoke the tool:

```python
async def test_create_booking_proposal_carries_structured_detail(<same fixtures as the neighbouring test>):
    """WhatsApp renders a slip from `detail`; the summary stays for the browser card."""
    <same setup as the neighbouring test — a screen, a media asset, deps>
    await <same call the neighbouring test makes to create_booking>(
        ...same args..., schedule_type="continuous",
        start_at="2026-08-18T00:00:00+05:30", end_at="2026-08-18T23:59:00+05:30",
    )
    p = deps.proposals[0]
    d = p["detail"]
    assert d["title"] == "New booking"
    labels = [k for k, _ in d["fields"]]
    assert labels[:4] == ["Campaign", "Screen", "Schedule", "Dates"]
    assert dict(d["fields"])["Schedule"] == "Continuous"
    assert dict(d["fields"])["Dates"] == "18 Aug 2026 → 18 Aug 2026"
    assert isinstance(d["warnings"], list) and isinstance(d["notes"], list)
    # The flat summary is untouched — the CMS card still reads it.
    assert p["summary"].startswith("Create booking '")
```

(The angle-bracket parts are the neighbouring test's own setup, copied verbatim — do not invent new fixtures.)

- [ ] **Step 2: Run to verify it fails**

Run: `poetry run pytest tests/test_ai_booking_naming.py -q -k structured_detail`
Expected: `KeyError: 'detail'`

- [ ] **Step 3: Extend `_propose`**

In `app/ai/tools.py` replace the `_propose` definition (starts `def _propose(` at ~line 1712) with:

```python
    def _propose(
        ctx: RunContext[AiDeps],
        tool: str,
        args: dict,
        summary: str,
        label: Optional[str] = None,
        detail: Optional[dict] = None,
    ) -> str:
        """Record one proposed write for the confirm card.

        ``label`` is the SHORT name for a tappable button — WhatsApp allows 20
        characters, and truncating the summary instead produced three identical
        buttons reading "Create booking 'Zom…" when one ad was booked onto three
        screens. The distinguishing part has to lead.

        ``detail`` is the STRUCTURED form of ``summary`` — title / fields / notes /
        warnings — so a phone can lay the proposal out one fact per line instead
        of as one paragraph. Optional: the summary alone still renders.
        """
        proposal = {"tool": tool, "args": args, "summary": summary}
        if label:
            proposal["label"] = label
        if detail:
            proposal["detail"] = detail
        ctx.deps.proposals.append(proposal)
        return (
            f"PROPOSED ({tool}). A confirmation card is being shown to the user. "
            "Do not call this tool again for the same action; wait for confirmation."
        )
```

- [ ] **Step 4: Build the detail in `create_booking`**

In `create_booking`, the warnings block currently reads (≈ lines 1917-1930):

```python
        warnings: list[str] = []
        offline_note = _screen_delivery_warning(screen_obj)
        if offline_note:
            warnings.append(offline_note)
        fit_note = await _media_fit_warning(ctx.deps.db, media_id, screen_obj)
        if fit_note:
            warnings.append(fit_note)
        # Seconds, not pixels: ...
        airtime_note, _msecs, _slotsecs = await _media_airtime_warning(
            ctx.deps.db, media_id, screen_obj
        )
        if airtime_note:
            warnings.append(airtime_note)
```

Change it to keep a tagged copy alongside (the `warnings: list[str]` list and everything that reads it stay exactly as they are):

```python
        warnings: list[str] = []
        tagged_warnings: list[dict] = []   # {"tag","text"} — the slip's short flag + full sentence
        offline_note = _screen_delivery_warning(screen_obj)
        if offline_note:
            warnings.append(offline_note)
            tagged_warnings.append({"tag": "offline", "text": offline_note})
        fit_note = await _media_fit_warning(ctx.deps.db, media_id, screen_obj)
        if fit_note:
            warnings.append(fit_note)
            tagged_warnings.append({"tag": "creative fit", "text": fit_note})
        # Seconds, not pixels: a video longer than its slot is CUT OFF by the player.
        airtime_note, _msecs, _slotsecs = await _media_airtime_warning(
            ctx.deps.db, media_id, screen_obj
        )
        if airtime_note:
            warnings.append(airtime_note)
            tagged_warnings.append({"tag": "video too long", "text": airtime_note})
```

Then, immediately before the `out = _propose(` call for `ToolName.CREATE_BOOKING` (≈ line 1987), add the detail and pass it:

```python
        # The structured twin of `summary`, for the phone. Same facts, no prose.
        schedule_label = {
            "continuous": "Continuous",
            "specific_time": "Daily window",
            "times_per_day": (
                f"{target_plays_per_day} plays/day" if target_plays_per_day else "Times per day"
            ),
            "custom": "Custom",
        }.get(schedule_type, str(schedule_type))
        place = (screen_obj.city or screen_obj.location or "").strip()
        screen_field = (
            f"{screen_for_name} ({place})" if screen_for_name and place
            else (screen_for_name or screen)
        )
        fields: list[list[str]] = [
            ["Campaign", name],
            ["Screen", screen_field],
            ["Schedule", schedule_label],
            ["Dates", when],
        ]
        if daily_start and daily_end:
            fields.append(["Daily window", f"{daily_start}–{daily_end}"])
        if days_of_week:
            day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            fields.append(["Days", ", ".join(day_names[d] for d in days_of_week if 0 <= d <= 6)])
        if screenshot_enabled:
            fields.append(["Screenshots", "every play"])
        detail = {
            "title": "New booking",
            "fields": fields,
            "notes": list(notes),
            "warnings": tagged_warnings,
        }
        out = _propose(
            ctx, ToolName.CREATE_BOOKING, args, summary,
            label=screen_for_name, detail=detail,
        )
```

(Delete the old `out = _propose(ctx, ToolName.CREATE_BOOKING, args, summary, label=screen_for_name)` call so there is exactly one.)

- [ ] **Step 5: Persist `detail` on the card**

In `app/ai/agent.py` the action list comprehension (≈ lines 512-520) becomes:

```python
                actions = [
                    {
                        "id": str(i),
                        "tool": p["tool"],
                        "args": p["args"],
                        "summary": p["summary"],
                        "executed": False,
                        # Optional structured form of `summary` (WhatsApp slip);
                        # keys are copied only when present so old cards and
                        # detail-less tools look exactly as before.
                        **({"label": p["label"]} if p.get("label") else {}),
                        **({"detail": p["detail"]} if p.get("detail") else {}),
                    }
                    for i, p in enumerate(deps.proposals)
                ]
```

⚠️ Check first whether `label` is already copied somewhere in that comprehension or just below it (grep `"label"` in `app/ai/agent.py`). If it is, keep the existing line and add only the `detail` spread — do not duplicate the key.

- [ ] **Step 6: Run tests**

Run: `poetry run pytest tests/test_ai_booking_naming.py tests/test_screenshot_chat_delivery.py -q`
Expected: pass. `poetry run ruff check app/ai/tools.py app/ai/agent.py`.

- [ ] **Step 7: Commit**

```bash
git add app/ai/tools.py app/ai/agent.py tests/test_ai_booking_naming.py
git commit -m "feat(ai): proposals carry a structured detail; create_booking fills it"
```

---

### Task 3: Light `detail` for the other seven write tools

**Files:**
- Modify: `app/ai/tools.py` — the `_propose(` calls at ≈ lines 2032 (`set_booking_status`), 2047 (`delete_booking`), 2058 (`toggle_premium_screenshots`), 2123 (`update_screen`), 2200 (`add_loop_item`), 2220 (`remove_loop_item`)
- Test: `tests/test_whatsapp_slip.py` (already covers rendering); add a compile check only.

**Interfaces:**
- Consumes: `_propose(..., detail=)` from Task 2.
- Produces: every write proposal has `detail.title` and at least one field.

- [ ] **Step 1: Add `detail=` to each call**

For each call, keep the summary string exactly as it is and add a `detail` kwarg. Use the local variables already in scope at each call site (read the 10 lines above each call to confirm the names — they are the ones the summary f-string uses):

```python
# set_booking_status (~2032)
detail={"title": "Booking status change",
        "fields": [["Booking", str(booking_id)], ["New status", str(status)]]},

# delete_booking (~2047)
detail={"title": "Cancel booking",
        "fields": [["Booking", str(booking_id)]],
        "warnings": [{"tag": "permanent",
                      "text": "this cancels the booking permanently (it cannot be reactivated)"}]},

# toggle_premium_screenshots (~2058)
detail={"title": "Screenshot setting",
        "fields": [["Booking", str(booking_id)],
                   ["Premium screenshots", "on" if enabled else "off"]]},

# update_screen (~2123)  — `screen` is the resolved label; `hours` is the " (hours …)" suffix or ""
detail={"title": "Screen update",
        "fields": [["Screen", screen]]
                  + ([["Hours", hours.strip(" ()").removeprefix("hours ").strip()]] if hours else [])},

# add_loop_item (~2200)  — `media_label`, `screen`, `daily` (", daily HH:MM-HH:MM" or "")
detail={"title": "Add to loop",
        "fields": [["Creative", media_label], ["Screen", screen]]
                  + ([["Daily window", daily.removeprefix(", daily ").strip()]] if daily else [])},

# remove_loop_item (~2220)
detail={"title": "Remove from loop",
        "fields": [["Loop item", str(item_id)], ["Screen", screen]]},
```

If a call site also sets fields the summary mentions that aren't listed here (e.g. `update_screen` may include name/location), add them as extra `[label, value]` pairs — the rule is: every fact in the summary appears once as a field.

- [ ] **Step 2: Verify**

Run: `poetry run python -c "import app.ai.tools"` and `poetry run ruff check app/ai/tools.py`
Expected: no output / "All checks passed".
If permitted: `poetry run pytest tests/test_ai_confirm.py tests/test_ai_dismiss.py -q` — pass.

- [ ] **Step 3: Commit**

```bash
git add app/ai/tools.py
git commit -m "feat(ai): structured detail on every write proposal"
```

---

### Task 4: `execute_actions` returns the executed actions

**Files:**
- Modify: `app/ai/confirm_service.py:146-160`
- Test: `tests/test_ai_confirm.py`

**Interfaces:**
- Produces: `execute_actions(...) -> {"executed": True, "results": [...], "summaries": [...], "actions": [dict, ...]}` where each dict is the card action (with `tool`, `summary`, `label?`, `detail?`).

- [ ] **Step 1: Write the failing test**

In `tests/test_ai_confirm.py`, find the existing test that calls `confirm_service.execute_actions(...)` on a persisted action card and asserts on `outcome["summaries"]` or `outcome["executed"]`. Add a sibling using its exact setup:

```python
async def test_execute_actions_returns_the_action_dicts(<same fixtures>):
    """The WhatsApp done-slip is rendered from the action, not from the summary."""
    <same setup>
    outcome = await confirm_service.execute_actions(db_session, cms_user, session.id, turn.id)
    assert [a["summary"] for a in outcome["actions"]] == outcome["summaries"]
    assert all("tool" in a for a in outcome["actions"])
```

- [ ] **Step 2: Run to verify it fails**

Run: `poetry run pytest tests/test_ai_confirm.py -q -k returns_the_action_dicts`
Expected: `KeyError: 'actions'`

- [ ] **Step 3: Implement**

`app/ai/confirm_service.py`, the final `return` of `execute_actions` (≈ line 160):

```python
    return {
        "executed": True,
        "results": results,
        "summaries": done_summaries,
        # The full action dicts (tool / summary / label / detail) so a channel
        # can lay the result out itself — WhatsApp renders a slip from `detail`.
        "actions": [dict(a) for a in targets],
    }
```

- [ ] **Step 4: Run tests**

Run: `poetry run pytest tests/test_ai_confirm.py tests/test_whatsapp_confirm.py -q`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/ai/confirm_service.py tests/test_ai_confirm.py
git commit -m "feat(ai): execute_actions returns the executed action dicts"
```

---

### Task 5: Render proposals as slips on WhatsApp (with the 1024-char guard)

**Files:**
- Modify: `app/whatsapp/render.py:176-263` (`card_to_messages`, the `ctype == "action"` branch)
- Test: `tests/test_whatsapp_render.py` (`TestCards`)

**Interfaces:**
- Consumes: `slip.proposal_body(actions)` from Task 1.
- Produces: same message dict shapes as before (`{"kind": "text"|"buttons", ...}`); a new constant `BUTTON_BODY_LIMIT = 1024`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_whatsapp_render.py` inside `class TestCards`:

```python
    def _detailed(self, i, warnings=None):
        return {"id": f"a{i}", "tool": "create_booking", "executed": False,
                "label": f"Screen {i}",
                "summary": f"Create booking 'fadw' on 'Screen {i}' (continuous)",
                "detail": {"title": "New booking",
                           "fields": [["Campaign", "fadw"], ["Screen", f"Screen {i}"],
                                      ["Schedule", "Continuous"],
                                      ["Dates", "18 Aug 2026 → 18 Aug 2026"]],
                           "warnings": warnings or []}}

    def test_single_action_body_is_a_slip(self):
        card = {"type": "action", "actions": [self._detailed(1)]}
        msgs = card_to_messages(card, turn_id="t1")
        assert msgs[-1]["kind"] == "buttons"
        body = msgs[-1]["body"]
        assert body.startswith("📋 *New booking*")
        assert "*Campaign:* fadw" in body
        assert body.endswith("Confirm to book, Change to edit, Cancel to drop it.")
        assert [b["title"] for b in msgs[-1]["buttons"]] == ["Confirm", "Change", "Cancel"]

    def test_two_actions_body_is_a_numbered_slip(self):
        card = {"type": "action", "actions": [self._detailed(1), self._detailed(2)]}
        msgs = card_to_messages(card, turn_id="t1")
        body = msgs[-1]["body"]
        assert body.startswith("📋 *2 bookings ready*")
        assert "1. Screen 1" in body and "2. Screen 2" in body
        assert [b["title"] for b in msgs[-1]["buttons"]] == ["Screen 1", "Screen 2"]

    def test_long_body_is_split_into_text_plus_short_buttons(self):
        """WhatsApp caps an interactive body at 1024 chars; the slip goes out as a
        text message and the buttons ride a one-line follow-up."""
        big = [{"tag": "x", "text": "w" * 300} for _ in range(5)]
        card = {"type": "action", "actions": [self._detailed(1, warnings=big)]}
        msgs = card_to_messages(card, turn_id="t1")
        assert msgs[0]["kind"] == "text" and "📋 *New booking*" in msgs[0]["body"]
        assert msgs[-1]["kind"] == "buttons"
        assert len(msgs[-1]["body"]) <= 1024
        assert msgs[-1]["body"] == "Confirm the booking above?"
        assert len(msgs[-1]["buttons"]) == 3

    def test_summary_only_action_still_renders(self):
        card = {"type": "action", "actions": [self._action(1)]}   # no detail
        msgs = card_to_messages(card, turn_id="t1")
        assert "Book on screen 1" in msgs[-1]["body"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `poetry run pytest tests/test_whatsapp_render.py -q -k "slip or split or summary_only"`
Expected: FAIL (`startswith("📋 *New booking*")` false; split test gets a body >1024).

- [ ] **Step 3: Implement**

In `app/whatsapp/render.py`:

1. Add the import and constant near the top:
```python
from app.whatsapp import slip

TEXT_LIMIT = 4096
BUTTON_TITLE_LIMIT = 20
BUTTON_BODY_LIMIT = 1024   # interactive (buttons) message body cap
MAX_BUTTONS = 3
```

2. Add a helper above `card_to_messages`:
```python
def _with_buttons(body: str, buttons: list[dict], short_prompt: str) -> list[dict]:
    """A buttons message — or, when the body is too long for one, the body as a
    plain text message followed by a one-line buttons message. WhatsApp rejects
    an interactive body over 1024 characters outright, and a slip with several
    warnings can get there."""
    body = to_whatsapp_markup(body)
    if len(body) <= BUTTON_BODY_LIMIT:
        return [{"kind": "buttons", "body": body, "buttons": buttons}]
    return (
        [{"kind": "text", "body": part} for part in chunk(body)]
        + [{"kind": "buttons", "body": short_prompt, "buttons": buttons}]
    )
```

3. Replace the whole `if ctype == "action":` branch with:
```python
    if ctype == "action":
        pending = _pending(card)
        if not pending:
            return []
        body = slip.proposal_body(pending)
        if len(pending) == 1:
            a = pending[0]
            return _with_buttons(body, [
                {"id": f"{BTN_CONFIRM_PREFIX}{turn_id}:{a['id']}", "title": "Confirm"},
                {"id": f"{BTN_REVIEW_PREFIX}{turn_id}", "title": "Change"},
                {"id": f"{BTN_CANCEL_PREFIX}{turn_id}", "title": "Cancel"},
            ], "Confirm the booking above?")
        if len(pending) <= MAX_BUTTONS:
            return _with_buttons(body, [
                {"id": f"{BTN_CONFIRM_PREFIX}{turn_id}:{a['id']}",
                 # `label` is the short, DISTINGUISHING name (usually the screen).
                 # Falling back to the summary is what made three screens produce
                 # three identical buttons: every summary opens with the same
                 # "Create booking '…" and the difference sits past character 40.
                 "title": _truncate(a.get("label") or a.get("summary") or "Confirm")}
                for a in pending
            ], "Pick one to confirm:")
        # More proposals than buttons: one aggregate action plus the numbered list.
        return _with_buttons(body, [
            {"id": f"{BTN_CONFIRM_ALL_PREFIX}{turn_id}",
             "title": _truncate(f"Confirm all {len(pending)}")},
            {"id": f"{BTN_REVIEW_PREFIX}{turn_id}", "title": "Review"},
            {"id": f"{BTN_CANCEL_PREFIX}{turn_id}", "title": "Cancel"},
        ], f"Confirm all {len(pending)}, or review?")
```

- [ ] **Step 4: Run tests**

Run: `poetry run pytest tests/test_whatsapp_render.py tests/test_whatsapp_slip.py -q`
Expected: pass. Note the existing `test_many_actions_collapse_to_confirm_all` asserts `"7" in body` — the new header `📋 *7 bookings ready*` satisfies it. `poetry run ruff check app/whatsapp/render.py`.

- [ ] **Step 5: Commit**

```bash
git add app/whatsapp/render.py tests/test_whatsapp_render.py
git commit -m "feat(whatsapp): proposals render as slips; split long bodies past the 1024 button cap"
```

---

### Task 6: The "Done" reply uses the slip

**Files:**
- Modify: `app/whatsapp/inbound.py:231` and its import line 32
- Test: `tests/test_whatsapp_inbound.py`

**Interfaces:**
- Consumes: `outcome["actions"]` (Task 4), `slip.done_body` (Task 1).

- [ ] **Step 1: Write the failing test**

In `tests/test_whatsapp_inbound.py`, find the test that exercises a Confirm button tap and asserts the reply body starts with `"✅ Done"` (search `"✅ Done"` / `Done:`). Add a sibling with the same setup whose stored card action carries a `detail`:

```python
async def test_confirm_tap_replies_with_a_done_slip(<same fixtures>):
    <same setup, but the persisted card action includes>
    #   "detail": {"title": "New booking",
    #              "fields": [["Campaign", "fadw"], ["Screen", "Cafe X (Bengaluru)"],
    #                         ["Schedule", "Continuous"], ["Dates", "18 Aug 2026 → 18 Aug 2026"]]}
    <same tap + handle call>
    body = <the captured outbound text body, same way the neighbouring test reads it>
    assert body.startswith("✅ *Booked*")
    assert "*Campaign:* fadw" in body
    assert "*Screen:* Cafe X (Bengaluru)" in body
    assert "Done:" not in body
```

If the neighbouring test stubs `confirm_service.execute_actions`, extend the stub's return value with `"actions": [<the action dict>]` — the real function returns it after Task 4.

- [ ] **Step 2: Run to verify it fails**

Run: `poetry run pytest tests/test_whatsapp_inbound.py -q -k done_slip`
Expected: FAIL (body starts with `✅ Done:`).

- [ ] **Step 3: Implement**

`app/whatsapp/inbound.py` line 32:
```python
from app.whatsapp import client, link_service, ratelimit, render, slip
```
and line 231:
```python
            body = slip.done_body(outcome.get("actions") or [
                {"tool": None, "summary": s} for s in outcome["summaries"]
            ])
```
(The fallback keeps a stubbed/legacy outcome without `actions` rendering.)

- [ ] **Step 4: Run tests**

Run: `poetry run pytest tests/test_whatsapp_inbound.py tests/test_whatsapp_confirm.py -q`
Expected: pass. Update any pre-existing assertion that expected the literal `"✅ Done: "` prefix to expect `"✅ *"` instead — the old test was asserting the paragraph format this feature replaces.

- [ ] **Step 5: Commit**

```bash
git add app/whatsapp/inbound.py tests/test_whatsapp_inbound.py
git commit -m "feat(whatsapp): the confirm reply is a done-slip, not a paragraph"
```

---

### Task 7: Live check on the dev number + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-whatsapp-copilot-design.md` (append a short §18 "Message layout")
- Modify: `markai-signage-api/CLAUDE.md` if it has a WhatsApp section (add one line pointing at `slip.py`)

- [ ] **Step 1: Run it against the dev app**

Local `.env` already points at the Meta **dev** app (test number +1 555 671‑2504, ngrok → :8095). Restart the API (`./dev_start.sh`), make sure ngrok is up and the dev app's webhook is verified, then from the linked phone send: `book fadw campaign on Droidlogic ohm today, continuous`. Expect a bubble that starts `📋 *New booking*` with `*Campaign:*`, `*Screen:*`, `*Schedule:*`, `*Dates:*` lines, an `⚠️ *Heads-up*` block if the screen is offline / creative doesn't fit, then Confirm/Change/Cancel. Tap Confirm → `✅ *Booked*` slip. Screenshot both bubbles for the user.

If Meta rejects the buttons message (HTTP 400 mentioning body length), the 1024 guard in Task 5 is not being hit — check `client.build_payload` is receiving the split messages.

- [ ] **Step 2: Document**

Append to the design doc:

```markdown
## 18. Message layout (the "slip")

Proposals and results are laid out one fact per line, never as a paragraph:
heading (`📋 *New booking*` / `✅ *Booked*`), then `*Label:* value` lines, an
`ℹ️` line per plain note, an `⚠️ *Heads-up*` block with one bullet per warning,
and a one-line footer telling the operator what the buttons do. Several
proposals share a header (count + the facts common to all) and a numbered list
of what differs, with ⚠️ tags. Rendering is `app/whatsapp/slip.py` (pure);
the data is the optional `detail` a tool attaches via `_propose(...)`. Cards
without `detail` fall back to the flat `summary`. Interactive bodies over 1024
chars go out as text + a one-line buttons message.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-whatsapp-copilot-design.md
git commit -m "docs(whatsapp): message layout — the slip"
```
(The design doc lives in the umbrella repo `MarkAi/`, so this commit is there, not in `markai-signage-api/`.)

---

## Self-review

- **Coverage:** single proposal ✔ (T1/T5), multi proposal ✔ (T1/T5), done single/multi ✔ (T1/T6), other actions get headings ✔ (T1/T3), warnings as separate block ✔, content unchanged ✔ (summary + warning strings untouched), old cards still render ✔ (fallbacks in T1/T5/T6), 1024 cap ✔ (T5), CMS untouched ✔.
- **Placeholders:** the only "copy the neighbouring test's setup" instructions (T2/T4/T6) are deliberate — the fixtures already exist in those files and inventing new ones would be wrong; the assertions are complete.
- **Type consistency:** `detail` shape identical in T1 tests, T2 builder, T3 builders; `slip.proposal_body(list[dict])` / `slip.done_body(list[dict])` used identically in T5/T6; `outcome["actions"]` produced in T4, consumed in T6; `BUTTON_BODY_LIMIT` defined and used only in T5.
