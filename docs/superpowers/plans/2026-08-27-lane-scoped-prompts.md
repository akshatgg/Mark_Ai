# Lane-Scoped System Prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sending the READ agent the ~1,193 tokens of instructions it can provably never act on, without changing a single byte of what the ACTION agent receives.

**Architecture:** `AI_OPERATOR_SYSTEM_PROMPT` is not rewritten, reworded, or retyped. It is sliced at import time on its own `## ` headings and reassembled per lane. The action lane gets the constant back unchanged (identity, not reconstruction); the read lane gets the same text minus three sections. Because the read prompt is produced only by *deleting* whole sections, no new wording can enter the system and change behaviour.

**Tech Stack:** Python 3.11, pydantic-ai 2.1.0, GoogleModel (native function calling).

## Global Constraints

- **The ACTION lane must be byte-identical to today.** Not "equivalent" — identical. It holds all 32 tools, so nothing in the prompt is dead for it, and any change to it is pure regression risk with zero upside.
- **Doubt means keep.** A section is cut from the read lane only when the router *provably* never sends such a turn there, or every rule in it governs a tool the read agent does not hold. Anything else stays.
- **Never cut vocabulary.** The read agent cannot book, but it must still explain what a slot, a booking, a loop item and an operating-hours window *are*. Text that defines terms stays on both lanes even when it names a write tool.
- **No prompt text is edited.** Only sliced. If a task finds itself retyping prompt prose, it has gone wrong.
- **No Gemini API calls during verification.** Every check in this plan is string-level and offline. A live accuracy run is a separate, explicitly-approved step (see Task 4).
- Per project rule: the implementer does **not** run `pytest`. Verification here is standalone scripts. Akshat runs the suite.

---

## The classification, and the evidence for it

Eleven sections. Three are cut from the read lane. Each cut carries its proof.

| Section | Chars | Read lane | Why |
|---|---:|---|---|
| (preamble — persona, `SCOPE — HARD LIMIT`) | 1,078 | **keep** | Scope guard. Must never be conditional. |
| `## HOW TO TALK` | 2,957 | **keep** | Tone/format rules apply to every reply. |
| `## THE FAST PATH — a creative arrives` | 2,728 | **CUT** | `router_lane.decide()` rule 1: `if has_media: return Lane(ACTION, ...)` — unconditional. A turn where a creative arrives *cannot* reach the read agent. |
| `## A SCREEN NAME IS NOT A PLACE` | 917 | **keep** | Governs `search_screens` — a read tool. |
| `## READING A LOCATION ANSWER` | 734 | **keep** | Governs `search_screens` / `pick_screens` — read tools. |
| `## RESIZING A CREATIVE (fit_creative)` | 1,121 | **keep** | `fit_creative` is **not** in `READ_AGENT_EXCLUDED`. The read agent holds it. |
| `## FACTS THAT KEEP YOU HONEST` | 2,534 | **keep** | **The trap.** Contains `SLOT vs BOOKING vs LOOP ITEM` and `OPERATING HOURS`, which name write tools but are *vocabulary*. A naive tool-name filter cuts these and makes read answers worse. |
| `## WHICH TOOL FOR WHICH QUESTION` | 4,403 | **keep** | The read lane's entire routing table. |
| `## WRITES, THE CARD, AND THE DRAFT` | 993 | **CUT** | `router_lane.decide()` rule 2: `if draft and draft_missing: return Lane(ACTION, ...)`. Also: read agent holds neither `update_booking_draft` nor `recall_booking_draft` (`READ_AGENT_EXCLUDED`) nor any write tool. |
| `## WHAT DID THEY JUST NAME?` | 829 | **keep** | Governs `resolve` and `media_where_playing` — read tools. |
| `## CHANGING THINGS THAT ALREADY EXIST` | 1,049 | **CUT** | Every rule governs `campaign_update`, `slot_edit` or `campaign_creatives_edit` — all excluded from the read agent. |

**Four write-tool mentions survive on the read lane, on purpose.** Two sit in `## HOW TO TALK` (multi-attachment booking, draft locking) and two in `## FACTS THAT KEEP YOU HONEST` (loop-vs-booking, the operating-hours remedy). Cutting them means surgery inside sections that are otherwise load-bearing, and a tool name the agent holds no tool for is inert — it cannot call what it does not have. They are pinned in `REVIEWED_WRITE_MENTIONS` so that a *fifth* one is a decision somebody makes, not drift. This is why the test is "only where reviewed" and not "zero mentions": the stricter assertion is the wrong one, and writing it first is how these four were found.

**Measured effect:** prompt 19,353 → 14,580 chars on the read lane (**−4,773 chars, −1,193 tokens, −24%**). Read-lane per-turn payload (prompt + its 20 tool descriptions) **8,926 → 7,733 tokens, −13%**. Action lane: **0 change**.

**Escalation is unaffected:** `escalate.needed()` hands a stuck read turn to the ACTION agent, which carries the full prompt. A read turn that turns out to need a change still gets every cut section — from the agent that can actually use it.

---

## File Structure

- `markai-signage-api/app/ai/prompts.py` — **modify, append only.** Prompt text untouched. Gains `_sections()`, `_ACTION_ONLY_HEADINGS`, `_EXPECTED_HEADINGS`, `build_system_prompt()`.
- `markai-signage-api/app/ai/tools.py` — **modify, 2 lines.** `_lane_agent()` asks for its lane's prompt.
- `markai-signage-api/tests/test_ai_lane_prompts.py` — **create.** Nine assertions.
- `markai-signage-api/scripts/verify_lane_prompts.py` — **create.** Offline runner, same assertions, no pytest.

---

### Task 1: Slice the prompt by lane

**Files:**
- Modify: `markai-signage-api/app/ai/prompts.py` (append at end of file, after the `+=` at line 285)
- Test: `markai-signage-api/tests/test_ai_lane_prompts.py`

**Interfaces:**
- Consumes: `AI_OPERATOR_SYSTEM_PROMPT` (existing), `app.ai.constants.Lane` (existing, has `.READ` / `.ACTION`)
- Produces: `build_system_prompt(lane: str | None = None) -> str`, `_sections(text: str) -> list[tuple[str, str]]`, `_ACTION_ONLY_HEADINGS: frozenset[str]`, `_EXPECTED_HEADINGS: frozenset[str]`, `REVIEWED_WRITE_MENTIONS: tuple[str, ...]`

- [ ] **Step 1: Write the failing test**

Create `markai-signage-api/tests/test_ai_lane_prompts.py`:

```python
"""The read lane loses only what it can never act on — and the action lane loses nothing.

Every assertion here is offline string work. None of it calls Gemini.
"""

from __future__ import annotations

import ast
from pathlib import Path

from app.ai.constants import READ_AGENT_EXCLUDED, Lane
from app.ai.prompts import (
    _ACTION_ONLY_HEADINGS,
    _EXPECTED_HEADINGS,
    _sections,
    AI_OPERATOR_SYSTEM_PROMPT,
    build_system_prompt,
    REVIEWED_WRITE_MENTIONS,
)

TOOLS_PY = Path(__file__).resolve().parents[1] / "app" / "ai" / "tools.py"


def _tool_names() -> set[str]:
    tree = ast.parse(TOOLS_PY.read_text())
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if "agent.tool" in ast.unparse(dec):
                    names.add(node.name)
    return names


def test_sections_partition_the_prompt_exactly():
    """Slicing then rejoining must be a no-op, or every guarantee below is worthless."""
    rejoined = "\n".join(body for _, body in _sections(AI_OPERATOR_SYSTEM_PROMPT))
    assert rejoined == AI_OPERATOR_SYSTEM_PROMPT


def test_action_prompt_is_byte_identical():
    assert build_system_prompt(Lane.ACTION) == AI_OPERATOR_SYSTEM_PROMPT
    assert build_system_prompt() == AI_OPERATOR_SYSTEM_PROMPT
    assert build_system_prompt("anything-unknown") == AI_OPERATOR_SYSTEM_PROMPT


def test_read_prompt_only_deletes_never_rewrites():
    """Every line the read agent sees must appear verbatim in the full prompt."""
    full = set(AI_OPERATOR_SYSTEM_PROMPT.split("\n"))
    for line in build_system_prompt(Lane.READ).split("\n"):
        assert line in full, f"read prompt invented a line: {line!r}"


def test_read_prompt_names_write_tools_only_where_reviewed():
    """Not "zero mentions" — that assertion is wrong, and finding out why mattered.

    Two of the kept sections legitimately name a write tool: one to define what a loop
    item is *versus* a booking, one to say what fixes a bad operating-hours window. Both
    are vocabulary the read agent needs. So the guarantee is narrower and truer: the only
    write-tool mentions left are the four somebody read and signed off on.
    """
    read = build_system_prompt(Lane.READ)
    stripped = read
    for line in REVIEWED_WRITE_MENTIONS:
        assert line in read, f"reviewed line vanished — re-review the split: {line!r}"
        stripped = stripped.replace(line, "")
    leaked = sorted(name for name in READ_AGENT_EXCLUDED if name in stripped)
    assert not leaked, f"unreviewed write-tool guidance on the read lane: {leaked}"


def test_read_prompt_keeps_every_read_tool_the_full_prompt_names():
    read = build_system_prompt(Lane.READ)
    held = _tool_names() - READ_AGENT_EXCLUDED
    for name in sorted(held):
        if name in AI_OPERATOR_SYSTEM_PROMPT:
            assert name in read, f"read prompt lost guidance for its own tool: {name}"


def test_read_prompt_keeps_vocabulary_and_scope():
    """The two blocks a naive tool-name filter would wrongly cut, plus the scope guard."""
    read = build_system_prompt(Lane.READ)
    for phrase in (
        "SCOPE — HARD LIMIT",
        "SLOT vs BOOKING vs LOOP ITEM",
        "OPERATING HOURS:",
        "SCREEN STATUS",
        "BOOKINGS: schedule_type",
    ):
        assert phrase in read, f"read prompt lost required context: {phrase!r}"


def test_headings_have_not_drifted():
    """A new '## ' section must be classified on purpose, not inherit BOTH by accident."""
    actual = {h for h, _ in _sections(AI_OPERATOR_SYSTEM_PROMPT) if h}
    assert actual == _EXPECTED_HEADINGS


def test_action_only_headings_all_exist():
    """A typo'd heading would silently cut nothing and look like it worked."""
    actual = {h for h, _ in _sections(AI_OPERATOR_SYSTEM_PROMPT) if h}
    assert _ACTION_ONLY_HEADINGS <= actual


def test_read_prompt_is_meaningfully_smaller():
    read = build_system_prompt(Lane.READ)
    saved = len(AI_OPERATOR_SYSTEM_PROMPT) - len(read)
    assert saved == 4773, f"expected to cut 4773 chars, cut {saved}"
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd markai-signage-api && python -c "from app.ai.prompts import build_system_prompt"
```

Expected: `ImportError: cannot import name 'build_system_prompt' from 'app.ai.prompts'`

- [ ] **Step 3: Append the implementation to `app/ai/prompts.py`**

Append at the very end of the file (it must come after the `AI_OPERATOR_SYSTEM_PROMPT +=` block at line 285). Do not touch any prompt text above it.

```python


# --- Lane-scoped instructions ---------------------------------------------------
# The prompt above is NOT edited by this split. It is sliced on its own "## " headings
# and reassembled per lane, so the ACTION lane's instructions come back as the very same
# string object it always got — proven by test_action_prompt_is_byte_identical.
#
# Only the READ lane loses anything, and only these three sections, each of which it can
# PROVABLY never need:
#
#   THE FAST PATH                 router_lane.decide() rule 1 — ``if has_media`` returns
#                                 ACTION unconditionally. A turn where a creative arrives
#                                 cannot reach the read agent.
#   WRITES, THE CARD, AND THE     router_lane.decide() rule 2 — a booking in progress
#   DRAFT                         returns ACTION. The read agent also holds neither draft
#                                 tool nor any write tool (READ_AGENT_EXCLUDED).
#   CHANGING THINGS THAT ALREADY  every rule in it governs campaign_update / slot_edit /
#   EXIST                         campaign_creatives_edit, none of which it holds.
#
# What is deliberately KEPT on the read lane even though it names write tools:
# "SLOT vs BOOKING vs LOOP ITEM" and "OPERATING HOURS" inside FACTS THAT KEEP YOU HONEST.
# Those are VOCABULARY. The read agent cannot book, but it must still say what a slot is
# and why a screen reads off_hours. A tool-name filter cuts them; a human must not.
_ACTION_ONLY_HEADINGS = frozenset(
    {
        "## THE FAST PATH — a creative arrives (this is most conversations)",
        "## WRITES, THE CARD, AND THE DRAFT",
        "## CHANGING THINGS THAT ALREADY EXIST",
    }
)

# Every heading the prompt is expected to carry. Frozen so that a section added later is
# a failing test — an unclassified section silently inheriting BOTH is the one way this
# split rots without anybody noticing.
_EXPECTED_HEADINGS = frozenset(
    {
        "## HOW TO TALK — operators are busy people, usually on a phone",
        "## THE FAST PATH — a creative arrives (this is most conversations)",
        "## A SCREEN NAME IS NOT A PLACE",
        "## READING A LOCATION ANSWER",
        "## RESIZING A CREATIVE (fit_creative)",
        "## FACTS THAT KEEP YOU HONEST",
        "## WHICH TOOL FOR WHICH QUESTION",
        "## WRITES, THE CARD, AND THE DRAFT",
        "## WHAT DID THEY JUST NAME?",
        "## CHANGING THINGS THAT ALREADY EXIST",
    }
)


def _sections(text: str) -> list[tuple[str, str]]:
    """Split the prompt into (heading, body-including-its-heading) pairs.

    The text before the first heading comes back under the empty heading and is never
    droppable — it carries the persona and the scope hard limit. Rejoining every body
    with "\\n" reproduces ``text`` exactly; that identity is what makes the action lane
    safe, so it is asserted in the tests rather than assumed.
    """
    lines = text.split("\n")
    marks = [i for i, line in enumerate(lines) if line.startswith("## ")]
    if not marks:
        return [("", text)]
    out = [("", "\n".join(lines[: marks[0]]))]
    for start, end in zip(marks, marks[1:] + [len(lines)]):
        out.append((lines[start], "\n".join(lines[start:end])))
    return out


# Write-tool mentions that survive on the READ lane on purpose, each one read by a human.
# Two sit in HOW TO TALK, two in FACTS THAT KEEP YOU HONEST — the latter are vocabulary
# (what a loop item is versus a booking; what fixes a wrong operating-hours window), and
# the read agent must still be able to explain both. Cutting them would mean surgery
# inside sections that are otherwise load-bearing, and a tool name the agent holds no tool
# for is inert: it cannot call what it does not have.
#
# This tuple lives here, beside the prompt it describes, so the test and the offline
# verifier assert against ONE list. A fifth mention appearing is then a decision somebody
# makes on purpose, not drift nobody notices.
REVIEWED_WRITE_MENTIONS = (
    "create_booking. Never ask them to identify the second one; they already sent it.",
    "everything at once, lock each resolved fact (update_booking_draft), ask only for",
    "loop tools, NOT create_booking. Never silently substitute one for the other.",
    "screen's hours (update_screen with on_start_minute/on_end_minute) and ask which.",
)


def build_system_prompt(lane: str | None = None) -> str:
    """The instruction sheet for one lane.

    Anything other than the read lane — including ``None`` and any unrecognised value —
    gets the full prompt back untouched. Defaulting to MORE instructions means a new
    caller that forgets to pass a lane degrades to today's behaviour instead of quietly
    running an agent with rules missing.
    """
    if lane != Lane.READ:
        return AI_OPERATOR_SYSTEM_PROMPT
    return "\n".join(
        body
        for heading, body in _sections(AI_OPERATOR_SYSTEM_PROMPT)
        if heading not in _ACTION_ONLY_HEADINGS
    )
```

Add the import at the top of `prompts.py`, after the module docstring and before the `AI_OPERATOR_SYSTEM_PROMPT = """\` literal. (There is no `from __future__ import annotations` in this file — an earlier draft of this plan wrongly said there was.)

```python
from app.ai.constants import Lane
```

(`app/ai/constants.py` imports nothing from `app.ai`, so this cannot cycle.)

- [ ] **Step 4: Verify it passes**

```bash
cd markai-signage-api && python - <<'PY'
from app.ai.constants import Lane
from app.ai.prompts import AI_OPERATOR_SYSTEM_PROMPT as FULL, build_system_prompt, _sections
assert "\n".join(b for _, b in _sections(FULL)) == FULL, "partition broken"
assert build_system_prompt(Lane.ACTION) == FULL, "action lane changed"
assert build_system_prompt() == FULL, "default changed"
read = build_system_prompt(Lane.READ)
assert len(FULL) - len(read) == 4773, f"cut {len(FULL)-len(read)}, expected 4773"
print("OK  action identical; read cut 4773 chars")
PY```

Expected output: `OK  action identical; read cut 4773 chars`

- [ ] **Step 5: Commit**

```bash
git add app/ai/prompts.py tests/test_ai_lane_prompts.py
git commit -m "feat(ai): slice the system prompt by lane, action lane unchanged"
```

---

### Task 2: Hand each lane its own prompt

**Files:**
- Modify: `markai-signage-api/app/ai/tools.py:32` (import), `markai-signage-api/app/ai/tools.py:215` (lane agent)
- Test: `markai-signage-api/tests/test_ai_lane_prompts.py` (append)

**Interfaces:**
- Consumes: `build_system_prompt(lane)` from Task 1
- Produces: nothing new — `_lane_agent()` keeps its signature

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ai_lane_prompts.py`:

```python
def test_lane_agent_asks_for_its_own_prompt():
    """The wiring, checked at source level.

    Building a real Agent needs a GEMINI_API_KEY and would drift into calling the
    provider, which this suite must never do. What matters is that ``_lane_agent`` stops
    passing the whole sheet to every lane, and that is visible in the source.
    """
    src = TOOLS_PY.read_text()
    assert "instructions=build_system_prompt(lane)" in src, (
        "_lane_agent must ask for the prompt of the lane it is building"
    )
    assert "instructions=AI_OPERATOR_SYSTEM_PROMPT" in src, (
        "the default (non-lane) agent must keep the full prompt"
    )
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd markai-signage-api && grep -c "instructions=build_system_prompt(lane)" app/ai/tools.py
```

Expected: `0`

- [ ] **Step 3: Make the change**

In `app/ai/tools.py`, extend the existing import on line 32:

```python
from app.ai.prompts import AI_OPERATOR_SYSTEM_PROMPT, build_system_prompt
```

In `_lane_agent()` (line 215), replace:

```python
    agent = Agent(model, deps_type=AiDeps, instructions=AI_OPERATOR_SYSTEM_PROMPT)
```

with:

```python
    # Each lane gets only the rules it can act on. The action lane's string is byte-
    # identical to the shared one (build_system_prompt returns the constant itself for
    # every lane but READ), so this is a change to the read lane and nothing else.
    agent = Agent(model, deps_type=AiDeps, instructions=build_system_prompt(lane))
```

Leave the default `_agent` at line 184 exactly as it is — it is the un-laned fallback and must keep the whole sheet.

- [ ] **Step 4: Verify**

```bash
cd markai-signage-api && grep -n "instructions=" app/ai/tools.py
```

Expected exactly two lines: `instructions=AI_OPERATOR_SYSTEM_PROMPT,` (the default agent) and `instructions=build_system_prompt(lane)` (the lane agent).

```bash
cd markai-signage-api && python -c "import app.ai.tools" && ruff check app/ai/prompts.py app/ai/tools.py
```

Expected: no output from the import, `All checks passed!` from ruff.

- [ ] **Step 5: Commit**

```bash
git add app/ai/tools.py tests/test_ai_lane_prompts.py
git commit -m "feat(ai): read lane runs on read-lane instructions"
```

---

### Task 3: An offline verifier, and a diff a human can read

**Files:**
- Create: `markai-signage-api/scripts/verify_lane_prompts.py`
- Create: `markai-signage-api/scripts/lane_prompt_diff.txt` (generated, git-ignored — for review only)

**Interfaces:**
- Consumes: everything from Tasks 1 and 2
- Produces: an exit-code-0-or-1 script, and a human-readable list of exactly what the read lane lost

- [ ] **Step 1: Write the verifier**

Create `markai-signage-api/scripts/verify_lane_prompts.py`:

```python
"""Offline proof that the lane split cut only what it was meant to cut.

Runs the same assertions as tests/test_ai_lane_prompts.py without pytest, and prints the
before/after so a human can check the judgement calls rather than just the arithmetic.
No Gemini call is made.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.constants import READ_AGENT_EXCLUDED, Lane  # noqa: E402
from app.ai.prompts import (  # noqa: E402
    _ACTION_ONLY_HEADINGS,
    _EXPECTED_HEADINGS,
    _sections,
    AI_OPERATOR_SYSTEM_PROMPT as FULL,
    build_system_prompt,
    REVIEWED_WRITE_MENTIONS,
)

TOOLS_PY = Path(__file__).resolve().parents[1] / "app" / "ai" / "tools.py"
READ = build_system_prompt(Lane.READ)
failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(label)


def tool_names() -> set[str]:
    tree = ast.parse(TOOLS_PY.read_text())
    return {
        n.name
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        for d in n.decorator_list
        if "agent.tool" in ast.unparse(d)
    }


print("\n=== structural ===")
check("slicing then rejoining is a no-op",
      "\n".join(b for _, b in _sections(FULL)) == FULL)
check("action prompt is byte-identical", build_system_prompt(Lane.ACTION) == FULL)
check("default prompt is byte-identical", build_system_prompt() == FULL)
check("unknown lane falls back to the full prompt", build_system_prompt("nonsense") == FULL)

headings = {h for h, _ in _sections(FULL) if h}
check("headings have not drifted", headings == _EXPECTED_HEADINGS,
      f"unexpected: {sorted(headings ^ _EXPECTED_HEADINGS)}" if headings != _EXPECTED_HEADINGS else "")
check("every action-only heading exists", _ACTION_ONLY_HEADINGS <= headings)

print("\n=== the read lane only lost things ===")
full_lines = set(FULL.split("\n"))
invented = [ln for ln in READ.split("\n") if ln not in full_lines]
check("read prompt invented no new text", not invented, f"{len(invented)} new lines")

print("\n=== the read lane kept what it needs ===")
held = tool_names() - READ_AGENT_EXCLUDED
lost = sorted(n for n in held if n in FULL and n not in READ)
check("kept guidance for all 20 of its own tools", not lost, f"lost: {lost}")

stripped = READ
for line in REVIEWED_WRITE_MENTIONS:
    check(f"reviewed mention still present: {line[:40]!r}...", line in READ)
    stripped = stripped.replace(line, "")
leaked = sorted(n for n in READ_AGENT_EXCLUDED if n in stripped)
check("no UNREVIEWED write-tool guidance on the read lane", not leaked, f"leaked: {leaked}")

for phrase in (
    "SCOPE — HARD LIMIT",
    "SLOT vs BOOKING vs LOOP ITEM",
    "OPERATING HOURS:",
    "SCREEN STATUS",
    "BOOKINGS: schedule_type",
):
    check(f"kept vocabulary: {phrase!r}", phrase in READ)

print("\n=== size ===")
saved = len(FULL) - len(READ)
check("cut exactly the reviewed 4773 chars", saved == 4773, f"cut {saved}")
print(f"  full: {len(FULL):6d} chars (~{len(FULL)//4} tok)")
print(f"  read: {len(READ):6d} chars (~{len(READ)//4} tok)   -{saved} (-{saved*100//len(FULL)}%)")

print("\n=== what the read lane no longer sees (review this by eye) ===")
out = Path(__file__).with_name("lane_prompt_diff.txt")
with out.open("w") as fh:
    for heading, body in _sections(FULL):
        if heading in _ACTION_ONLY_HEADINGS:
            print(f"  CUT  {heading}  ({len(body)} chars)")
            fh.write(f"{'=' * 78}\nCUT FROM READ LANE: {heading}\n{'=' * 78}\n{body}\n\n")
print(f"  full text written to {out}")

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {failures}")
    sys.exit(1)
print("ALL CHECKS PASSED")
```

- [ ] **Step 2: Run it**

```bash
cd markai-signage-api && python scripts/verify_lane_prompts.py
```

Expected: every line `PASS`, ending in `ALL CHECKS PASSED`, and `scripts/lane_prompt_diff.txt` written.

- [ ] **Step 3: Read the diff by eye**

```bash
cd markai-signage-api && cat scripts/lane_prompt_diff.txt
```

This is the review gate, and it is not automatable. Read all 4,773 cut characters and ask of each paragraph: *could a read-only turn ever need this?* If any could, move its section out of `_ACTION_ONLY_HEADINGS` and re-run. The 4,773 assertion will fail — update it to the new number, and say so in the commit.

- [ ] **Step 4: Lint and import-check**

```bash
cd markai-signage-api && ruff check app/ai/ scripts/verify_lane_prompts.py && python -c "import app.ai.tools; import app.ai.service; print('imports clean')"
```

Expected: `All checks passed!` then `imports clean`.

- [ ] **Step 5: Commit**

```bash
echo "scripts/lane_prompt_diff.txt" >> .gitignore
git add scripts/verify_lane_prompts.py .gitignore
git commit -m "test(ai): offline verifier for the lane prompt split"
```

---

### Task 4: Live accuracy check — REQUIRES EXPLICIT APPROVAL

**Do not start this task without Akshat saying yes.** It makes real Gemini API calls and costs real money. Everything above is offline.

**Files:**
- Read only: `docs/ai-copilot-test-report-2026-07-28.md` (the format prior runs used)

- [ ] **Step 1: Ask**

Present the numbers from Task 3 and the eyeballed diff, then ask whether to spend on a live run.

- [ ] **Step 2: If approved — the read-lane battery**

Run the same actor/verifier harness used before, against the seeded local users (`rohit@chaipoint.in`, `ai-tester-admin@`). Read-lane prompts to cover, one per cut section's risk:

| Prompt | Watches for |
|---|---|
| "how many times did Summer Sale play?" | proof-of-play path intact |
| "which screens are down?" | fleet health intact |
| "what's running on the Xiaomi screen?" | slot vocabulary survived the cut |
| "why is Blue Tokai showing off hours?" | **OPERATING HOURS vocabulary survived** |
| "what's the difference between a slot and a booking?" | **SLOT vs BOOKING vocabulary survived** |
| "send me the excel for Chai Point" | report path intact |
| "how many slots are free on screen 3? ok put mine in 6" | **escalation still hands over correctly** |

The last one is the important one: it is the read→action hop, and it must produce a confirm card, not an apology.

- [ ] **Step 3: Compare against the same battery on `master`**

Any answer that got *worse* means a section was cut wrongly. Move it back to BOTH, re-run Task 3, re-run this.

- [ ] **Step 4: Write the result into `docs/ai-copilot-lane-prompt-verification-<date>.md`**

---

## Self-Review

**Spec coverage.** Akshat asked for four things. (1) *How many tools in each lane, and which* — answered in the table at the top: 20 read, 32 action, named. (2) *Remove only dead prompt* — the classification table gives a per-section reason, and the action lane is cut by zero because it holds every tool. (3) *Don't remove anything with a conflict* — encoded as the "doubt means keep" constraint and demonstrated on the two vocabulary blocks a naive filter would have wrongly cut. (4) *Verify properly, no accuracy risk* — Task 3 offline, Task 4 live and gated on his approval.

**Placeholders.** None: every step carries its real code, its real command and its expected output.

**Type consistency.** `build_system_prompt(lane: str | None) -> str` is defined in Task 1 and used with that exact signature in Task 2 and Task 3. `_sections()` returns `list[tuple[str, str]]` in all three. `Lane.READ` / `Lane.ACTION` come from `app/ai/constants.py` and are the same values `router_lane.py` emits.

**Known limitation, stated rather than hidden.** The three cuts are justified by today's `router_lane.decide()`. If someone later routes a media-bearing turn to the read lane, the fast-path rules would be missing. `test_headings_have_not_drifted` does not catch that — it guards the prompt, not the router. The mitigation is that `escalate.py` still hands such a turn to the action agent, which has everything.
