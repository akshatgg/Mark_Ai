# Running more than one ad in a slot — add an alternate, change it, remove it

**Date:** 2026-08-25 (rev 4 — reorder, drop-the-original, and per-creative proof added)
**Status:** PLAN ONLY — nothing implemented.
**Repos:** `markai-signage-api`, `markai-Web-cms`.
**Phase 1: no APK change, one migration. Phase 2 (per-creative proof) needs player v1.3.**
**Baseline:** rotation is merged everywhere — backend #65, player #16, CMS #50.

## What operators actually do — in priority order

1. **Add one more ad to the same slot, so the two alternate every loop.**
   This is the common case and the reason the feature exists. Chai Point is live
   with ad A; the client sends ad B; the slot plays A, B, A, B.
2. **Swap or drop one of those alternates** — *"stop running B, run C instead."*
3. **Replace a campaign's ONLY ad** — operators already handle this by ending the
   campaign and booking a new one, and that is the right operation, not a
   workaround (see R below). This plan does NOT swap a single-ad campaign's
   creative in place.

Whenever the set changes, the campaign's report must show **what ran when** — ad
A from the 1st to the 14th with its plays, ad B from the 14th onward with its
own — and it must still say that after the campaign has ended and been rolled up
(see H below).

Out of scope: two advertisers alternating in one slot.

**No pricing, invoicing or payment work — this is the CMS.** The system has no
price, rate or currency field anywhere (verified), and this plan adds none. Where
the text below says "billing", it means one thing only: the **proof-of-play
record** — the count of times an ad actually aired, and the screenshots that
evidence it. Getting that count right matters because it is the delivery record
an operator reports from; nothing here computes, charges or owes money.

## Why none of it is possible today (verified)

- The only writer of a rotation row is `app/bookings/service.py:666`, inside
  `create_booking` (line 565). Nothing edits the set afterwards.
- `update_booking`'s contract still reads *"Screen and media stay fixed"* (:1125).
- A slot holds one booking (`claim_free_position` takes the lowest UNoccupied
  slot; paused campaigns still occupy theirs).

**Precedent worth citing:** `PUT /cms/bookings/{id}/layout` (`service.py:1181`)
already changes a LIVE booking's media arrangement. So this is not a new doctrine.
But do **not** copy its guards — it has none (no editability check, no validation),
so today a cancelled or already rolled-up campaign's layout can still be changed.
This plan guards harder on purpose; a reviewer must not "simplify" toward it.

---

# D — The decisions that shape everything

Rev 1 left these unasked or wrong. They are settled here.

## D1 · Retired creatives are DATED rows, not deleted rows (one migration)

Six read paths answer *past* questions ("which creative produced this play?",
"what did this campaign run?") by consulting the **live** set. Delete a row and
each one silently reports the wrong thing. So a retired creative keeps its row.

**Migration `0055`:** add `booking_creatives.retired_at TIMESTAMPTZ NULL`, and
make `position` **nullable**. Retiring = `position → NULL, retired_at → now()`.

This one shape resolves four separate audit findings at once:

| Audit finding | How D1 disposes of it |
|---|---|
| **C1** Renumbering raises `IntegrityError` (reproduced 12/12; the constraint is NOT deferrable, unlike `uq_screen_slots_position`) | **Nothing is ever renumbered.** Adds take `max(position)+1`; retiring nulls the position. NULLs are distinct under a unique constraint, so a freed position is even reusable. |
| **C2 / P0-1** Retiring a creative made its media deletable, and `proof_of_play.media_id` is `ON DELETE CASCADE` — deleting it would destroy the plays it delivered | The row survives, so `delete_media`'s existing `BookingCreative` count keeps protecting the media **forever**. No new guard needed for this path. |
| **M8 / P1-3.2** Collapse to one creative erased the history the plan had just promised | Rows persist; the breakdown still has something to read. |
| **M7 / P1-3.4-5** Screenshot→play mapping and late-play top-up resolve against the live set | They resolve against the **historical** set — which now exists. |

Consequences to implement deliberately:
- `get_schedule_items` emits **active rows only** (`retired_at IS NULL`), ordered
  by position. Gaps are irrelevant — the player indexes the list it receives.
- `creative_media_ids` returns the **historical** set (active + retired). That is
  what the screenshot 409 and the report matchers want. A frame of a
  just-retired creative is genuine proof and should be accepted, not rejected —
  this deletes rev 1's matrix row 12 problem entirely.
- A media asset that ever aired in a campaign becomes undeletable. That is
  correct: its play history references it.

## D2 · The campaign's own ad is never swapped in place — "Replace ad" ends and re-books

Rev 2 allowed a primary swap on a not-yet-started campaign. Operators do not want
it and the audit showed why it is expensive: three separate things are nailed to
*which ad the campaign is*.

- **The proof photographs.** Each `ScreenshotJob` stores its own `media_id`,
  stamped from `booking.media_id` (`screenshots/service.py:406`). Swap the ad and
  all three milestones plus any open "Capture now" sit waiting for a creative the
  campaign no longer airs — never captured, all marked missed. Not mislabelled:
  the advertiser's evidence simply never exists.
- **Old play records.** `owns_play_clause`'s legacy branch matches untagged rows
  by `media_id == booking.media_id` (`attribution.py:292`). Repoint that and the
  campaign starts claiming another campaign's historical rows, or loses its own.
- **The old file.** Once the ad is unreferenced it looks deletable, and
  `proof_of_play.media_id` is `ON DELETE CASCADE` — deleting it destroys the
  record of every play it delivered.

**So the campaign's own ad stays fixed for the life of the campaign.** What the
operator gets instead is a **"Replace ad"** action that does, in one click, what
they already do by hand: cancel this campaign and create a new one on the same
screen, same slot, same dates and windows, with the new creative. Underneath it
is two operations that already exist and are already safe, so it inherits their
guarantees — the finished campaign keeps ad A's play record and its three photographs
exactly as they happened, and the new campaign starts clean and gets its own.

Two honest records beat one campaign whose record quietly changed what it was for. This
also deletes rev 2's screenshot re-pointing, its "not yet started" rule and its
legacy-attribution hazard — the feature gets materially smaller.

## D4 · Play order is fully editable; the ATTRIBUTION ANCHOR never moves

The operator wants to rearrange the rotation, and — after adding B — to be able
to drop A. Both are blocked by rev 3's rule that position 0 must equal
`bookings.media_id`. The way out is to stop conflating two different jobs that
column is doing.

`bookings.media_id` is read in ~20 places across six modules — attribution's
legacy branch (`attribution.py:268,292`), every `ScreenshotJob` stamp
(`screenshots/service.py:406,457,732`), the post-rollup prune (`:2120`), the
rollup pre-filter (`bookings/service.py:132`), `list_bookings`' INNER JOIN
(`:768,827`), the partner API (`ext_router.py:570`) and the legacy schedule path.
Moving it is what makes a creative swap dangerous.

So split the two roles:

- **The anchor** (`bookings.media_id`) is a play-attribution and compatibility pointer.
  It is set at creation and **never changes for the life of the campaign**. Every
  one of those 20 readers keeps working, untouched. This is what kills the
  cross-attribution hazard outright rather than guarding against it.
- **The play order** (`booking_creatives.position`) is the operator's to arrange:
  reorder freely, and retire any member — **including the anchor's own row**.

**Emission:** `get_schedule_items` sends `item.media_id` = the FIRST ACTIVE
creative (not the anchor), with `creatives[]` = the active rows in play order. So
"entry 0 equals the item's own media" still holds — the contract the player was
built against is preserved — and an older player, which reads only
`item.media_id`, plays a creative the campaign genuinely runs rather than one that
was dropped.

**Retiring the anchor's row is gated on `supports_rotation`.** A screen below
v1.2 ignores `creatives[]` entirely and plays whatever single media it is given;
that is fine (it gets the first active one), but the campaign is then airing one
ad while the CMS shows a rotation. Refuse the drop with a message naming the
screen and its player build, exactly as the add-warning does.

**Reordering uses the same rewrite-the-whole-set discipline as everything else:**
null every active position, flush, then assign `0..N-1` in the new order, inside
the row lock. Never issue shifting UPDATEs against a non-deferrable unique
constraint — that is finding C1, and it reproduced 12/12.

## D5 · The operator is told what each ad will actually get, before the write

Adding an ad to a slot does not buy more airtime; it divides airtime that is
already paid for. "I added another ad" and "I halved my main ad's exposure" are
the same action, so the confirm step states the arithmetic rather than implying it:

- the **slot's length** and the campaign's **total plays per day** — unchanged by
  this edit, and said so explicitly;
- the **projected split**: with N creatives each gets ≈ total ÷ N plays per day,
  and plays × slot seconds of screen time each;
- the same numbers for the **campaign's remaining days**, since that is what an
  advertiser actually asks about.

Derive the rate the way the system already does for `playback_health` (window
minutes ÷ loop seconds, floored) rather than inventing a second formula, and show
the observed rate beside the projection when the campaign has history.

After the write, the Creatives card carries the same split per creative, so the
operator can reconcile what they were told against what actually happened.

## D3 · Concurrency: lock the booking row. Decided, not deferred

All three endpoints open with `SELECT … FROM bookings WHERE id = :id FOR UPDATE`
— the exact precedent of `claim_free_position` (`slots.py:594`). Without it: two
concurrent adds compute the same `max(position)+1` → constraint violation → an
**opaque 500** (`app/main.py:141` catches bare `Exception`; no `IntegrityError`
handler exists), with a poisoned transaction. Two adds each seeing 9 members
produce 11, past the cap. Any residual `IntegrityError` maps to 409, never 500.

---

# The endpoints

```
POST   /api/cms/bookings/{id}/creatives              {"media_ids": ["mB", ...]}
PATCH  /api/cms/bookings/{id}/creatives/{media_id}   {"media_id": "mC"}
DELETE /api/cms/bookings/{id}/creatives/{media_id}
```

Each returns the **enriched detail shape** (`get_booking_detail`), not a plain
`BookingResponse`. Reason: only the detail path fills creative names and play
counts (`service.py:936`), and the CMS deliberately keeps its existing creatives
over a mutation response for exactly that reason (`bookings/[id]/page.tsx:164`).
Returning the plain shape would leave the strip stale — a trap rev 1 walked into.
Each also `db.refresh(booking)` after the write, or `_creatives_out` reads an
unloaded relationship and reports "no rotation".

## Guards, in order

1. **Permission** — `_assert_can_manage_booking`, EXCEPT a booking with a
   non-null `booked_via_api_key_id`, which is **superadmin only**: a partner sees
   the result in their own listing and has no way to know an operator changed it.
2. **Editability** — `_assert_schedule_editable`, with a **parameterised
   message**: its text says "a cancelled campaign's *schedule* cannot be changed",
   which reads as nonsense to an operator adding a creative.
3. **Layout refusal (422)** — a zoned item never reads `mediaId`
   (`PlaylistController.kt:375`), so rotation on it is a permanent no-op on every
   player version; but the rows are NOT inert server-side (they widen
   `creative_media_ids`, loosening the screenshot check and the report matchers).
   Symmetrically, `PUT /{id}/layout` must refuse a booking that has an active set.
4. **Fit check** — see below.
5. **Ordinary** — media exists (404); no duplicate against the active set **plus
   the primary** (or promotion writes the primary twice); active count capped at
   10, matching `CreateBookingRequest.media_ids`, as one shared constant.

## Operations

- **Add** — if the booking has no rows, PROMOTE: write the existing
  `bookings.media_id` at position 0, then the new creatives after it. Otherwise
  append at `max(position)+1` over all rows.
- **Change** — retire the target row and insert the replacement, reusing the
  freed position so play order is preserved. Position 0 obeys D2.
- **Remove** — retire the row. Refuse position 0 (it is `bookings.media_id`).
  When the active count falls to 1, the emission filter (`len(v) >= 2`,
  `screens/service.py:1301`) makes the campaign single-creative again on its own —
  no special case, and the history stays.

Every mutation bumps `schedule_updated_at` in the same transaction, so the screen
reloads within one heartbeat.

## Fit check — new; nothing validates creatives today

At creation a creative is **not** checked against the screen on any path. Two
pure helpers already exist but are used only by the AI, only advisorily, and only
on a single `media_id`: `_media_fit_warning` (orientation/aspect vs
`screen.resolution`) and `_media_airtime_warning` (video seconds vs the slot),
`app/ai/tools.py:429` and `:481`. Media dimensions are already persisted
(`content/models.py:24`).

Adding a creative is the first path where artwork joins a **live** screen with
nobody looking at the panel spec. So: lift both helpers into a shared module (not
a third copy) and apply them here.

- **Orientation mismatch → 422.** A portrait ad on a landscape panel is not a
  judgement call.
- **Aspect delta / video length → warning returned on the response**, rendered by
  the CMS as a blocking confirm *before* the write. The video case must name the
  loss: *"this creative is 30s but slot 3 is 10s — the player cuts it at 10s."*
  Also state the inverse, which nobody has written down: a video **shorter** than
  its slot ends the pass early, so a mixed set makes the loop length oscillate
  and `playback_health`'s expected-plays divisor drifts.
- Unknown dimensions pass with an explicit "cannot verify" note — never silence.

---

# H — Changeover history and the combined end-of-campaign report

The moment a slot can run more than one ad, "what did this campaign play?" stops
having a single answer. The report has to say **what ran, when, and how much** —
and keep saying it after the campaign has ended and been billed.

## What the record must contain

Per creative, for the life of the campaign:

| Field | Source |
|---|---|
| Ad name + media id | `media_assets` |
| Added on / retired on (operator intent) | `booking_creatives.created_at` / `retired_at` (D1) |
| First played / last played (what actually happened) | `MIN/MAX(played_at)` over the campaign's own rows |
| Plays and seconds delivered | `SUM(play_count)` over the same rows |
| Its milestone / loop frames | `screenshot_records.media_id` (already stores the real creative) |

Intent and reality are both kept because they answer different questions. "Added
on the 14th" is the operator's action; "first played on the 15th" is when the
screen actually aired it — and a gap between them is exactly what an advertiser
asks about.

## The part that needs a migration: freezing it at rollup

The live breakdown is derivable from `proof_of_play` — but those rows are
**deleted** `CAMPAIGN_CLEANUP_AFTER_DAYS` after a campaign is rolled up
(`screenshots/service.py:2110`), and `proof_summaries` stores exactly one
`media_id` and one total (`playback/models.py:109`). So without this, the
per-creative history evaporates weeks after the campaign ends — precisely when
someone pulls the final report.

**Migration `0055` also adds `proof_summaries.creative_breakdown` (JSONB, null
for pre-rotation summaries):** a frozen list, written once inside
`rollup_booking`'s existing transaction, of
`{media_id, media_name, plays, seconds, first_played_at, last_played_at,
added_at, retired_at}`. Names are **snapshotted**, not looked up later, so the
report survives even if the asset is renamed.

Freezing at rollup follows the rule this codebase already holds for billing: a
summary is written once and never recomputed, because the operator has already
reported from it (`playback/models.py:89-96`).

While a campaign is still running, the same breakdown is computed live from the
raw rows, so the detail page and the final report agree — the frozen copy is the
same shape, just no longer recomputable.

## Where it surfaces

1. **Booking detail (live)** — the Creatives card lists active creatives with
   their play counts, and retired ones beneath, greyed, each showing the dates it
   ran. A swap must never look like the plays disappeared.
2. **The campaign PDF (the final report)** — today it renders `bookings.media_id`
   only (`service.py:403`, `pdf_report.py:814`), so a campaign that rotated two
   ads produces a report naming one. It gains a **"Ads run in this campaign"**
   section: one row per creative that ever aired, in order, with its dates and
   plays, and a total line that reconciles to the campaign total. The three
   milestone tiles are captioned with **their own** creative's name
   (`ScreenshotRecord.media_id`) instead of a bare timestamp — otherwise a photo
   of ad B sits under a heading naming ad A, on the campaign's delivery report.
3. **The rollup xlsx** (`bookings/report.py:70`) gains the same per-creative
   rows; today its single "Ad (media)" column shows one creative beside an
   all-creative total.

## Why a replaced main ad does NOT need this

Under D2, replacing a campaign's only ad ends that campaign and starts another,
so each report already covers exactly one ad and reconciles on its own. The
changeover history is only needed **within** one campaign — which is precisely
the alternates case. The CMS should link the two campaigns to each other
("replaced by" / "replaces") so an operator reading either one can follow the
thread; that is a link, not a merged report.


---

# Phase 2 — proof photographs per creative (needs player v1.3)

**The gap, verified in merged player code:** a milestone is parked by
`(bookingId, milestone)` and the job's `media_id` is **discarded**
(`PendingMilestones.add`, `PlayerService.kt:596`); the owed capture takes its
media from whatever is playing (`PlaylistController.kt:241-245`). So on a
rotating campaign the three proof photographs show **whichever creative happened
to be on the glass** — all three may be ad A, or all three ad B, at random. For a
campaign that ran two ads, the evidence covers one of them by luck.

**Phase 1 keeps this behaviour** — it is not a regression, and every frame is
still genuine proof that the campaign ran (the record now stores the creative
actually photographed). Phase 1 must not be blocked on a player release.

**Phase 2 makes coverage deliberate:**

- **Backend (no migration):** keep three milestone jobs per campaign, but stamp
  each with a creative chosen round-robin across the active set — start→creative
  1, mid→creative 2, end→creative 3, wrapping. Two creatives get two frames and
  one; three get one each. This needs no change to
  `uq_screenshot_records_booking_milestone`, which is keyed on
  `(booking_id, shot_type)`. Beyond three creatives, coverage is partial — say so
  rather than implying otherwise; full coverage would mean N×3 jobs and a new
  unique key (a second migration).
- **Player v1.3:** honour the job's `media_id` again when the job specifies one —
  capture only when THAT creative is on the glass, falling back to today's
  behaviour when the field is absent. This is a narrow reversal of the rotation
  release's relaxation, now that the job can name a creative meaningfully.
- **Re-arming:** when the set changes, re-stamp uncaptured jobs across the NEW
  active set, mirroring `rearm_milestone_jobs` (`screenshots/service.py:415`).
- **Report:** each milestone tile is captioned with its own creative's name, and
  the end-of-campaign report states plainly which creatives have photographic
  proof and which do not — never leaving a reader to assume all of them do.


---

# Ship in the same PR (each is a live bug this feature exposes)

These are not polish. Each one is currently latent because rotation sets cannot
change; this feature is what makes them reachable.

| # | Fix | Why it cannot wait |
|---|---|---|
| S1 | `_apply_late_plays` (`playback/service.py:217`) must find candidates by `booking_id` too, not only by media membership | A buffered play of a retired creative arriving after rollup matches no booking → the frozen summary is never topped up → **silent, unrecoverable under-counting** of delivered plays |
| S2 | `_map_screenshots_to_plays` (`screens/service.py:1517`) must match on `ProofOfPlay.booking_id` first, falling back to the historical set | Plays of a retired creative attach to no booking → `_screenshot_status(None,…)` renders "—" for a play that HAS a stored frame |
| S3 | `_fill_creative_plays` must iterate `counts.keys() ∪ active set`, emitting retired entries; and must run even when the active set is empty (today it is gated on `if response.creatives`, `service.py:936`) | Otherwise a swap erases the old creative's plays from the report — the delivery number an operator reports appears to move |
| S4 | The post-rollup prune matches `ProofOfPlay.media_id == booking.media_id` (`screenshots/service.py:2120`) — the **primary only** | Alternates' rows are never reclaimed and leak forever. Rotation is about to make that routine. Use `owns_play_clause`. |
| S5 | `ROTATION_MIN_VERSION_CODE` + `supports_rotation: true\|false\|null` on the screen summary, beside `app_version_code` | The old-player warning has nothing to compute against today; `is_outdated` answers a different question and returns "not outdated" for a v1.1 fleet |
| S6 | AI read-side: `prompts.py:184` still tells operators *"a BOOKED campaign is FROZEN: only name and status can change"* (already stale after #66); add `creatives` to `list_bookings` (`tools.py:899`); stop `get_report` collapsing to `candidates[0]` (`tools.py:1662`) | The co-pilot will confidently tell an operator this feature does not exist, the day it ships |
| S7 | A minimal audit row per mutation: `booking_id, actor_id, action, old_media_id, new_media_id, at` | **There is no audit trail anywhere in this codebase** (repo-wide grep: doc comments only). This is the first edit that changes what an advertiser gets while leaving the campaign and dashboard looking identical. Cancel is loud; a creative swap looks like nothing happened. |

**Explicitly deferred, and stated so the plan does not read as if it solves them:**
(the frozen per-creative breakdown and the PDF are NO LONGER deferred — see H) `plays-aggregate` has no `booking_id` scoping; no AI, Gmail
or WhatsApp **write** path (an unattended agent swapping artwork is worse than a
missing feature); the Gmail "advertiser replied with another ad" case currently
creates a **second live campaign**, and this plan does not change that.

---

# CMS

- **Rotation campaign** → the existing Creatives card (`bookings/[id]/page.tsx:604`).
  "Add creative" in the header; per-row **Change** / **Remove** for `position > 0`.
  Row 0's bare ordinal becomes **"Campaign's own ad"** — no Remove, Change
  disabled with the reason.
- **Single-creative campaign** → the card does not render (guard at `:607`). The
  entry point belongs beside the **Media ID** row or under **Preview ad**.
- **"Preview ad" becomes a lie after the first add** — it renders `media_url`,
  which the backend fills from the primary. Either preview per creative, or
  relabel it "Preview primary ad".
- **Retired creatives** render under the live ones, greyed, with their play
  counts, so a swap never looks like the plays vanished.
- **The old-player warning is computed, not written** (S5), shown BEFORE the
  commit, in three states: too old / unknown version ("cannot confirm" — never
  "supported") / supported. Copy must also say the change reaches the screen on
  its next heartbeat — up to 60s, or up to 15 minutes for a screen currently
  outside its operating hours on the slow keep-alive.
- **Budget the picker extraction:** "reuse the existing media picker" is not free
  — it is inline state in `bookings/new/page.tsx`, not a component.

---

# Verification

**Deterministic:** `ruff check app/` + module imports; `alembic upgrade head` on a
scratch DB then `alembic downgrade -1`; `npx tsc --noEmit` + `npm test`.

**Matrix.** Rows 1-20 from rev 1 carry over, amended: row 1 now expects
**`A, A, B, A, B…`** (the counter has never been used, so the primary repeats once
before the alternate appears); row 12 is deleted (D1 makes a retired creative's
frame acceptable); rows 8-9 are replaced by D2's not-yet-started rule.

| # | Scenario | Expected |
|---|---|---|
| 21 | Remove a middle creative from a 4-member set | Active set [A,C,D], **no `IntegrityError`** — pins the no-renumber design (naive renumber failed 12/12) |
| 22 | Add / change / remove on a booking with non-null `layout` | 422; CMS hides the controls and says why |
| 23 | Change the primary before `start_at` | Allowed — the real "wrong file at booking time" case |
| 24 | Change the primary after `start_at`, zero rows landed, screen offline & buffering | **Refused** — the guard is not "no rows have arrived" |
| 25 | After an allowed primary change | All 3 uncaptured milestone jobs carry the NEW media; none expire missed |
| 26 | Open "Capture now" when the primary changes | Re-pointed or cleanly withdrawn — never stuck 409-ing |
| 27 | Retire B, then delete media B from Content | **Refused** — the retired row still references it (D1) |
| 28 | Late play of a retired creative arrives after rollup | Folded into the frozen summary via `booking_id` (S1) |
| 29 | Proof-of-play report covering plays of a retired creative | Rows attach to the campaign and show their captured frames, not "—" (S2) |
| 30 | Collapse to one creative on a campaign with plays for the removed one | Detail still shows "previously aired" with real counts (S3) |
| 31 | Two concurrent adds | Serialized by the row lock: one clean result, never a 500, never 11 members |
| 32 | Add on a **paused** campaign | 200, rows written, nothing on the glass until resume (`status == "active"` filter) |
| 33 | Portrait creative onto a landscape screen | 422 before anything is written |
| 34 | 30s video into a 10s slot | Blocking warning naming the slot and the 20s loss; proceed only on confirm |
| 35 | Partner-placed booking (`booked_via_api_key_id` set), screenowner acts | 403 — superadmin only |
| 36 | Every mutation | An audit row exists naming actor, action and both media ids (S7) |
| 37 | Campaign ran A alone, then A+B, then A+C; campaign ends | Final PDF lists A, B and C with the dates each ran and its plays; the per-creative totals reconcile to the campaign total |
| 38 | Same campaign, read the report AFTER `CAMPAIGN_CLEANUP_AFTER_DAYS` | Identical numbers — served from the frozen `creative_breakdown`, not recomputed |
| 39 | Creative added on the 14th but the screen was offline until the 15th | Report shows added 14th, first played 15th — the gap is visible, not smoothed over |
| 40 | Milestone photo captured while ad B was on the glass | Tile is captioned with B's name, not the campaign's primary |
| 42 | Reorder a 3-creative rotation | New order emitted next heartbeat; **no `IntegrityError`** (positions nulled, flushed, reassigned) |
| 43 | Drop the anchor's own row, screen on v1.2+ | Allowed; `item.media_id` becomes the first ACTIVE creative; `bookings.media_id` in the DB is unchanged |
| 44 | Drop the anchor's own row, screen below v1.2 | Refused, naming the screen and its player build |
| 45 | Add a 2nd creative | Confirm step states slot length, unchanged campaign total, and the ≈half-each split — before the write |
| 46 | Phase 2: campaign ran A and B | Milestones are stamped across both; the report says which creatives have photographic proof |
| 41 | "Replace ad" on a single-ad campaign | Old campaign closed with its plays and 3 photos intact; new campaign live with same screen/slot/dates; the two link to each other |

**Behavioural, on the real screen** (`192.168.1.6`, now on v1.2): add an alternate
to a live campaign and confirm from the player log that the slot alternates within
one heartbeat; swap the alternate and confirm the new creative appears without the
campaign restarting; confirm the retired creative's file is pruned from the device
cache on the same refresh.
