# Web CMS — mobile-view fixes (2026-09-18)

Six phone-view problems in `markai-Web-cms`, reported from a real device session.
Desktop is unchanged except where noted. The reference for "good" is
`markai-cms-mobile` (the CMS as a Compose app), which already solved the same
screens for a phone.

## 1 · Scheduling list: tap the row, not the expander
`app/(dashboard)/bookings/page.tsx`

Today each campaign on mobile is a `MobileDetails` disclosure: tap to expand,
read a 2-col `dl`, then tap "View campaign". Two taps and a wall of text to
reach a page that shows all of it anyway.

Below `md` the row becomes a single `Link` to `/bookings/{id}`: preview thumb ·
name · screen name · status badge · right-chevron. The `dl` and the inner link
are dropped. The desktop table is untouched.

## 2 · Dashboard plays chart is hidden on mobile
`app/(dashboard)/page.tsx`

`TrendChart`'s column gets `hidden md:block`. A 14-day line chart at 390px is
unreadable, and the "Plays today" stat tile already carries the same series as a
sparkline plus the vs-yesterday delta. Fleet health moves up under the tiles.
The Reports page chart stays — that page exists for it.

## 3 · Slot editor: app-style cards on mobile
`components/screens/SlotGrid.tsx` + new `components/screens/SlotGridMobile.tsx`

The desktop panel (rundown rows with a `Move to…` select, a number input, and an
open-slot chip grid) does not survive a phone: the select truncates, the number
boxes need the keyboard, and the open chips become a wall.

State, fetching and every mutation stay in `SlotGrid`; `SlotGridMobile` is
presentation plus passed-in handlers, mounted `md:hidden`. It mirrors
`SlotsPage.kt`:

- Loop map card: `90s · 9 slots` + proportional bars (`flexGrow: seconds`).
- Condensed 2-up: On air now / When full.
- One card per slot, booked and open in one list, position order: number chip,
  occupant label, sub-line, seconds pill, chevron.
- Expanded: `Slot length [−] n s [+]` stepping by 5 and clamped to
  `min_slot_seconds`/`max_slot_seconds` (so mobile can never stage an invalid
  length), "Plays in this slot" pill, Up / Down (swap with the neighbour via the
  existing move endpoint, blocked while dirty exactly as the select is), remove.
  A rotating campaign opens `SlotRotation` here too.
- Sticky save bar while dirty (total + Undo + Save all); Add slot in the footer.

Drag-to-reorder and the `Move to…` select do not render on mobile. "Set all 15s"
(an app-only affordance) is not added.

## 4 · Proof frames as rows
`app/(dashboard)/bookings/[id]/page.tsx` (`MilestoneSlots`) +
`components/OnDemandCaptures.tsx`

Below `md`, milestone tiles stop being tall stacked boxes and become rows like
`CampaignFrames.kt`: 112×68 thumb left; label + status badge right; one detail
line (`Captured 18 Sept · 09:12`, `Due 18 Sept, 09:00`). Captured rows open the
full frame. Desktop keeps the 3-across grid.

On-demand captures: the 5-column table is replaced below `md` by the same row
shape (64×40 thumb, timestamp, sub-line, badge, download, select checkbox). The
filters and Capture-now/Cancel controls already stack and stay.

## 5 · "Screen is offline" is one line, at every width
`app/(dashboard)/bookings/[id]/page.tsx` and `app/(dashboard)/bookings/page.tsx`

The paragraph explaining that a campaign still activates and resumes when the
screen returns is removed; the banner is just ⚠ **Screen is offline**. Decided
for all widths, not only mobile.

## 6 · Profile avatar matches the app
`components/layout/Topbar.tsx`

The gradient (`signal-bg`) initials chip becomes a solid `bg-accent` circle with
a hairline border and a white person icon — what `Chrome.kt`'s header button and
`ProfileSheet.kt` use. Both sizes. `initials()` becomes dead and is removed.

## Verification
`npx tsc --noEmit`, `npm run lint`, `npm test`, then the real pages at 390px in
Chrome. `next build` is never run here — it clobbers `.next` under the running
dev server.

---

## Added during the session (same pass)

### 7 · Screens list: a rectangle, not a block
`app/(dashboard)/screens/page.tsx`

Below `sm` each screen is `ScreenRowCompact`: status-tinted icon, name, place,
status; a rule; then one line of "what it is doing" (playing / idle / last seen /
off-hours) with the resolution on the right — the CMS app's fleet card. The full
tile (player build, admin badges, loop length, operating window) stays from `sm`
up. The bulk-select checkbox moves inside the card, since the floating corner
position collides with the status label.

### 8 · Raw ids are superadmin-only
Campaign page's Screen ID + Media ID rows, and the screen page's Screen ID row,
render only for `isSuperadmin(user)`. An owner identifies a screen by name and an
ad by its file; the ids exist for API calls and support threads.

### 9 · Proof of play names the ad
`rowAdName` fell back to `media_id.slice(0, 8)` — an id fragment that reads as a
name. Now "Unnamed ad".

### 10 · Screen health: one filter
The six status chips (which wrapped to two rows on a phone) become a single
`Select`. Every count they carried is already on the tiles above.

### 11 · Content rows open the popup
Below `md` a content row is a button that opens the existing `MediaDetailModal` —
preview, dimensions, added-on, with Rename and Delete in its footer — instead of
expanding into a smaller copy of that modal.

### 12 · Play timeline is desk-only
A 24-column hour grid is unreadable at 390px; hidden below `md`.

### 13 · One campaign editor
`components/bookings/EditCampaignModal.tsx` (was `EditScheduleModal`; the
rename-only `EditBookingModal` is deleted). Name + Schedule + The ad, in one
sheet. Name and schedule save in ONE PATCH. The ad section previews the current
creative and hands "Change ad" / "Add an alternate creative" back to the page's
existing creative dialog. The campaign page header is now Activity · Edit
campaign · status (plus Download report on a finished campaign), and the two
creative buttons in the body are replaced by the sentence that explains what a
second ad does.

The new-booking form already supports a rotation set, so it only gained the
question: with one creative chosen it now says a second ad splits the same slot
and plays, next to the existing "Add another creative" / "Quick add" buttons.

### 14 · The screen picker fits the visible screen
`components/patterns/AsyncSelect.tsx`

Two phone-only faults, one symptom ("it hides some of the screens"):

- The menu measured its room against `window.innerHeight`. A software keyboard
  does not change that number — it covers the bottom of it — so the menu opened
  to its full height with the lower half behind the keyboard, and because it is
  `position: fixed`, nothing could be scrolled to reveal those rows. It now
  measures against `visualViewport` (height + offsetTop) and re-measures on that
  viewport's own resize/scroll, which is what the keyboard actually fires. Its
  floor drops from 160px to 96px — search row plus a row — so a cramped viewport
  shrinks the menu instead of overflowing it.
- Opening auto-focused the search box, which raised that keyboard in the first
  place. On a touch device (coarse pointer AND a real touchscreen — either alone
  misreports a headless browser or a touchscreen laptop) the list now opens
  unfocused; the operator taps the search box when they want to type.

Verified at 390×420 (the keyboard case): the menu flips above the field and every
option is on screen.

### 15 · A frame that can never exist is not shown at all
`app/(dashboard)/bookings/[id]/page.tsx` (CMS) ·
`app/bookings/service.py` + `app/bookings/pdf_report.py` (signage-api)

Milestones with `status == "missed"` — both reasons, the ad being swapped and the
campaign ending before the ad played again — are filtered out before anything
renders them. Decided for the page AND the report PDF: a tile reading "Missed" is
not evidence, and this section exists to show evidence.

Consequences, all intended:

- A retired ad whose frames were all lost disappears from the strip entirely.
- A strip lays out as many columns as it has frames (`COLUMNS` map, complete
  literal Tailwind classes): two frames means two half-width tiles, not two
  tiles and a hole where the third was.
- `MilestoneFrame` now has two states, captured and pending. The missed/changed
  branches, their amber and red tones, and the `AlertTriangle` import are gone.
- The paragraph explaining that a swapped ad keeps its own frames is gone too.
  Each ad's strip carries its name, the dates it aired, and a "Previous ad" tag
  when retired — the layout says it.
- In the PDF, `missed_reason` is gone from `MilestoneFrame`, `_milestone_tiles`
  renders `len(cells)` columns at a fixed one-third width (a lone frame blown up
  to full page width prints as a poster, not as evidence), and a report with no
  frames at all omits the verification section rather than printing a heading
  over an empty space.
- The cancel-campaign warning no longer says remaining frames "will be marked
  Missed" — a status the UI no longer shows anywhere — but that they can never be
  captured.

Verified by temporarily marking one live milestone job missed in the local DB:
the strip rendered two stretched tiles, and the row reverted cleanly afterwards.

### 16 · Retime the ad from Scheduling
`bookings/new/page.tsx` · `components/bookings/EditCampaignModal.tsx` ·
`bookings/[id]/page.tsx`

The rule is unchanged: a booking has no duration of its own, the slot owns the
seconds. What changed is where the slot can be edited from. Both the booking form
and Edit campaign now carry a "How long it plays" stepper (±5s, clamped to the
backend's bounds) that writes `PATCH …/slots/{position}` — the same call the
screen page makes.

- **Booking form:** the field appears once a screen is chosen, defaulted to that
  screen's `default_slot_seconds`. The write happens AFTER create, since the slot
  only exists once the backend has placed the campaign (`claim_free_position`),
  and in its own try/catch: a failed retime warns and leaves a correct booking,
  it never loses one.
- **Edit campaign:** the grid is fetched when the dialog opens, the campaign's
  slot found by occupant id. Saving writes the booking first and the slot second,
  so a slot failure doesn't cost the schedule edit. The Schedule card's "Play
  duration" row now prints the real number ("10s per play (screen slot)").
- Both say the same sentence: the screen's loop changes length with it, and
  whatever is booked into that slot next plays for the same time.

Verified end to end: opening Edit campaign, stepping 10s → 20s and saving moved
that one `screen_slots` row and left the other eight at 10s.

### 17 · Two downloads on a campaign
`Download report` becomes the primary (blue) button, and a `Proof of play` button
beside it exports every play row for that campaign as .xlsx — `api.proofReportXlsx({
bookingId })`, the same endpoint and sheet the Proof of play page exports. Unlike
the PDF (superadmin, finished campaigns only) it is offered while a campaign is
still running: advertisers ask for a delivery sheet mid-flight, and the rows it
prints are already final.

### 18 · The slot length is typed, not only stepped
Both "How long it plays" controls are now a text box between the − and + buttons.
Held as a STRING, like `SlotGrid`'s own inputs: as a number, clearing the box to
retype it would be 0 for a keystroke and clamp itself to the screen's minimum
under the cursor, and "1" on the way to "15" would be a 1-second slot. Digits
only (`/^\d+$/` — `Number("1e3")` is 1000 and passes `Number.isInteger`), bounds
from the backend, and an invalid value blocks the save with a message naming the
range. The ± buttons stay for the ±5 nudge; 12s is reachable now, and it was not
before.

Verified: typing 12 into Edit campaign and saving wrote `duration_seconds = 12`
to that campaign's slot and nothing else (restored to 10 afterwards).

### 19 · No standing operating-hours line while scheduling
The "This screen runs 09:00–17:00 — book inside that window." line is removed
from all three scheduling surfaces: `bookings/new`, the Edit campaign dialog and
the schedule-a-solution modal. It printed on every visit whether or not the
operator was anywhere near the edge of the window.

`isBookingWithinScreenHours` still runs on save in all three, and its message
names the window — so the hours are stated at the moment they can be acted on
rather than standing above the fields permanently.

### 20 · Continuous has no daily window
`cfg.dailyWindow` for `continuous` goes from `"optional"` to `false` in all three
schedulers (booking form, Edit campaign, schedule-a-solution). The "Run all day"
checkbox and the From/To fields no longer render for it, and its option now reads
"All day, every day in the range — whenever the screen is on".

Continuous means the whole date range; the only clock that then applies is the
screen's own operating hours, which the operator already set on the screen. The
optional window made the simplest type carry the most controls, and a campaign
labelled "continuous" while holding 09:00–17:00 read as a contradiction.

The render gates were tightened at the same time (`cfg.dailyWindow === "optional"
&& !allDay`, not bare `!allDay`) — otherwise a campaign whose stored window made
`allDay` false would still have drawn the fields under a type that no longer has
them.

**Consequence, intended:** `buildPayload` sends `daily_windows: []` for a
continuous campaign, so saving the editor on a legacy continuous booking that
carries a window normalises it to all day. Its plays stay bounded by the screen's
operating hours either way. A campaign that genuinely needs a daily window is a
"Specific time" campaign.
