# Co-pilot: proof of play by campaign

**Date:** 2026-08-26
**Follows:** `2026-08-25-proof-of-play-multi-ad-campaign-filter-design.md`, which built the
campaign filter for the CMS page and put the co-pilot explicitly out of scope. This is
that follow-up.

## The problem

The CMS can now report a campaign across all of its rotating creatives. The co-pilot
could not answer the same question at all. Its only proof-of-play read,
`get_proof_of_play(screen_id)`, calls the legacy screen endpoint: no campaign filter, no
creative filter, no date range, no ad names — fifty raw rows of whatever the whole screen
played. So "how many times did Sanjivani play last week?" had no tool behind it, and the
model either guessed or fell back to building a spreadsheet.

The Excel export was never the gap: `get_report` already passes `booking_id`, and
`app/reports/service.py` queries with `booking=`, which uses `owns_play_clause`. Campaign
attribution has been right in the FILE for as long as it has existed. It was missing from
the CONVERSATION.

## What we built

One read tool, `get_campaign_plays(name, date_from=None, date_to=None)`.

It answers with the campaign's whole run by default — no date range is asked for, and
none is required. Dates only narrow. It returns:

- `total_plays`, `total_seconds` / `total_minutes`, `days_with_plays`, first and last play
- `by_creative` — the per-ad split, the thing the CMS page just gained
- `by_day` — every day in the window, with `bucket: "day" | "week"`
- `covers_from` / `covers_to` / `dates_defaulted` — so the answer states its own window

No confirm card: it is a read. After answering, the agent offers the Excel in one line;
on the user's yes it calls `get_report(..., confirmed=true)` with the same campaign and
dates. That reuses `get_report`'s existing cross-turn gate — a `confirmed=true` call in a
NEW turn queues immediately, so the operator gets numbers, then a file, with one "yes"
between them and no redundant confirmation.

## Attribution

`attribution.owns_play_clause` — the booking-id tag the player writes onto each play, the
same predicate billing, the campaign PDF and the CMS report table use. A campaign
rotating five creatives reports all five; a second advertiser sharing one of them is
excluded. Legacy untagged rows keep falling back to the primary creative inside the
booking's own play windows. None of this is new logic; the tool wires up what exists.

## The bound that had to match the sheet

`query_proof_report(booking=…)` puts no date predicate on tagged rows, and `get_report`
defaults a named campaign to its start and end DATES. A tool bounded by the campaign's
exact timestamps therefore reported fewer plays than the Excel it was about to offer —
7,017 against 7,280 on local data, same campaign, no way for an operator to tell which
number was real.

So `campaign_play_rows` clamps a caller's window to the campaign's IST CALENDAR DAYS, and
the tool always passes those day bounds. Chat and sheet now return the same figure.

## Code

- `app/bookings/service.py` — `campaign_play_rows(db, booking, frm=None, to=None)`, public.
  It is the old private `_plays_by_day_and_media` (the campaign PDF's day table)
  generalized to take bounds and to also sum seconds and min/max timestamps.
  `_plays_by_day_and_media` now delegates to it with no bounds, so the PDF is byte-for-byte
  unchanged (verified: 7,017 before and after).
- `app/ai/tools.py` — the tool, plus `_roll_up_days(by_day, window_days)`, a pure helper so
  the day/week rollup is checkable without a database.
- `app/ai/prompts.py` — routing: campaign proof-of-play questions go here, `get_report` is
  only the FILE, `analyze_campaign_playback` stays the health verdict.

### Rollup, not truncation

Past a 60-day window `by_day` returns weekly bars dated by their Monday, with
`bucket: "week"`. A year-long campaign is ~52 rows instead of 365, and nothing is hidden —
truncating would have made the model quote a partial total as the whole run.

## Bug found and fixed on the way

`_match_campaigns(prefer_live=True)` dropped every finished campaign whenever any live one
matched at all — so "Chai Point Diwali" (finished, name score 1.00) resolved to
"Chai Point" (live, 0.83) and the operator was told their campaign had zero plays. Under a
tool whose whole job is reporting delivered plays, that is a wrong number under the right
name.

Liveness is now a tiebreaker, not an override: it still wins between equally-scoring
names (the case the rule was written for), but never beats a strictly better name match.
Verified across every campaign name in the local DB — live won all ties, and no name
resolves to a worse-scoring campaign.

## Out of scope

Fleet-wide play trends, the multi-ad union filter (several creatives across campaigns),
and the per-booking hourly timeline stay CMS-only. Nothing here changes the player, the
schema, or any existing endpoint.
