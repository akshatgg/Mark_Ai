# "Capture now" on a rotating campaign — pick which ad, or photograph them all

**Date:** 2026-08-25
**Status:** PLAN ONLY — nothing implemented.
**Repos:** `markai-signage-api`, `markai-Web-cms`, and (Phase B only) `markai-player-apk`.
**Baseline:** live creative editing is on branch `feat/live-creative-editing`
(PRs CMS-Back#67 / CMS-Web#52). A campaign's slot can hold several ads.

## The ask

Clicking **Capture now** on a campaign that rotates several ads should ask
*which ad* to photograph — and offer **all of them** in one click.

## What happens today (verified)

`request_ondemand_screenshot` (`app/screenshots/service.py:675`) creates ONE
`ScreenshotJob` with `milestone="ondemand"` and `media_id=booking.media_id`.
Three facts decide this plan:

1. **The job's `media_id` is thrown away by the player.** It parks the request as
   `PendingMilestones.add(shot.bookingId, shot.milestone)`
   (`PlayerService.kt:598`) — booking and milestone only — then photographs
   **whatever creative is on the glass** when that campaign next plays. On a
   rotating campaign that is effectively a coin toss.
2. **Only one on-demand request may be open per campaign.**
   `_open_ondemand_job` (`:598`) returns the single in-flight job and
   `request_ondemand_screenshot` (`:722`) refuses a second with 409.
3. **Multiple on-demand RECORDS are already legal.**
   `uq_screenshot_records_booking_milestone` explicitly excludes `'ondemand'`
   (`app/screenshots/models.py:44-51`) — repeatability is the existing feature —
   so storing several frames for one campaign needs no schema change.

Good news from the creative-editing work: a captured frame is already **stored
under the creative actually photographed** (`media_id or booking.media_id`), and
ingest accepts any of the campaign's creatives. So the *record* is already
honest; what is missing is **choosing**.

## The one hard constraint

**A specific creative cannot be targeted precisely without a player release.**
The device decides what to shoot, and it currently ignores the job's `media_id`.
That is the same blocker as per-creative milestone photographs, already scoped as
Phase 2 of the rotation plan — so these two should ship in **one** player
release, not two.

That gives a clean split: everything that can be done from the server now, and
one player change that makes it exact.

---

# Phase A — server + CMS only, no player release

### A1 · "Photograph every ad" (this is the one that genuinely works today)

A **coverage request**: one on-demand job that stays open until every active
creative has a frame, rather than closing on the first.

- The request records the set of creatives it wants covered.
- Each upload is stored (records are repeatable) and ticks that creative off.
- The job closes when the set is empty, or at TTL.
- Because the player already photographs whatever is up, and a rotating slot
  cycles, coverage arrives on its own — two creatives typically need two or
  three passes.

This needs **no** player change and no targeting: it wants them all anyway.

### A2 · "Photograph this one" — best effort

Same machinery, set-of-one. The frame that arrives may be a different creative:

- store it (it is a real photograph of this campaign, and the operator will
  usually be glad of it), but **do not close the request**;
- re-offer and try again until the wanted creative comes round or the TTL expires.

The honest cost, which the UI must state: each attempt is a coin toss, and
re-offers are paced by `_JOB_REDELIVER_GRACE_MINUTES` (10). For a 2-ad campaign
that is minutes, not seconds.

**Tuning knob:** give on-demand jobs their own, shorter re-offer grace (~1 min).
A `Capture now` is a human waiting at a screen, unlike a milestone that has all
day. Cheap, backend-only, and it makes A2 feel responsive.

### A3 · Allow several open on-demand requests

Rule 2 becomes **one open request per creative** instead of one per campaign, so
"photograph ad B" and "photograph ad C" can be in flight together and A1 is
expressible at all. The existing 409 stays for a duplicate request on the *same*
creative.

**Watch out:** the player's pending map is keyed by `(bookingId, milestone)`, so
two jobs both called `ondemand` collapse into one. Either keep A1 as a single
job carrying a set (preferred — no wire change), or give each job a distinct
milestone string, which changes the `shot_type` the player sends
(`"milestone_$job"`) and touches ingest's normalisation. **Prefer the single-job
form.**

### A4 · CMS

- Single-ad campaign → today's button, unchanged. No new question for the
  common case.
- Rotating campaign → the click opens a small chooser: one row per active
  creative, plus **"All of them"**. Retired creatives are not offered (nothing
  will photograph them again).
- State what the operator is agreeing to: the shot happens on the ad's **next
  real play**, not now; with several ads that is a few passes; and on Phase A a
  specific pick is best-effort. Never imply precision the system does not have.
- Show progress against a coverage request ("2 of 3 ads photographed"), reusing
  the existing 15-second poll while a request is open.

---

# Phase B — the player release that makes it exact (with per-creative milestones)

`PendingMilestones` learns the creative a job wants, and `CaptureGuard` shoots
only when that creative is on the glass — a narrow, deliberate re-tightening of
the media check that rotation relaxed, now that the job can name a creative
meaningfully.

Then A2 becomes exact and instant (first play of that ad), A1 becomes
deterministic rather than opportunistic, and the same change delivers
per-creative milestone photographs from the rotation plan. **One release, both
features.**

Backward compatibility: a job with no creative behaves exactly as today, so an
un-updated screen keeps working and Phase A keeps functioning on it.

---

# Scenario matrix

| # | Scenario | Expected |
|---|---|---|
| 1 | Capture now, single-ad campaign | Unchanged — no chooser, one frame |
| 2 | Capture now → "All of them", 2 ads | Both photographed within a few passes; request closes on the second |
| 3 | Same, one ad never plays (outside its window) | Request expires at TTL, reports which ads it got and which it did not — never claims full coverage |
| 4 | Capture now → one specific ad (Phase A) | Frame of another ad is kept and labelled correctly, request stays open until the wanted one lands |
| 5 | Same (Phase B) | First play of that ad, no wasted captures |
| 6 | Two requests for the same creative | 409, as today |
| 7 | Requests for two different creatives | Both allowed and both in flight |
| 8 | A creative is retired while a request for it is open | Request closes as unfulfilled with the reason; it can never be satisfied |
| 9 | Screen below player v1.2 | Chooser hidden; single Capture now, as today |
| 10 | Campaign blocked (paused, off-hours, out of window) | Existing `_ondemand_block_reason` 409s unchanged — the chooser must not bypass it |
| 11 | Coverage request on a campaign whose set changes mid-flight | Targets the set as at request time; a newly added ad is not silently required |
| 12 | TTL expiry with partial coverage | Frames captured so far are kept; nothing is rolled back |

# Verification

- Exercise A1/A2/A3 against real PostgreSQL the way the creative-editing work was
  (a scratch script driving the service, not mocks): coverage completion,
  partial expiry, per-creative duplicate 409, and two concurrent different-creative
  requests.
- Confirm each stored frame's `media_id` is the creative actually photographed,
  and that `_ondemand_block_reason` still governs.
- CMS: `tsc` + tests; confirm the chooser is absent for a single-ad campaign and
  for a screen that cannot rotate.
- Phase B additionally: player unit tests for "shoot only the named creative",
  and a real-screen run on `192.168.1.6`.

# Recommendation

Ship **Phase A now** — "photograph every ad" is the request that actually works
without a player release, and it is probably what "capture both" meant. Fold
**Phase B** into the same v1.3 player release as per-creative milestone
photographs, since both need the identical change and neither justifies a fleet
update on its own.
