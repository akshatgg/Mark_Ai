# Screen Panel 3D Hover — Design

**Date:** 2026-07-27
**Project:** `markai-frontend-new` (public marketing site, port 3100)
**Scope:** Purely visual. Two components. No deps, no data/API changes.

## Goal

On the screens grid (`/screens`), the signage panel inside each card should read
as a **frosted-glass 3D screen**. It sits **straight / face-on** at rest (no
tilt). Hovering **the panel itself** floats it up the Y-axis and tips it up to
"look" at the viewer; moving off settles it back down flat. Only the panel
reacts — the card box, text, chips and status badge stay put.

> **Revision (2026-07-27, after live review):** the earlier "tilt at rest →
> face-on on hover" motion was replaced. On seeing it live the user asked for:
> no resting right-side tilt (sit straight), a **transparent/frosted-glass**
> screen instead of a solid black block (so the card reads through it and the
> text stays visually separate), and a hover that **floats up + tips up** to
> look at you. The sections below reflect that final design.

## What the user asked for (verbatim intent)

- Make the black screen a "3D structure."
- At rest it should already look 3D (angled, with visible thickness).
- On hover it should "look forward to us" (rotate to face-on) and "translate
  along the Y-axis" (float up), "so it looks cool."
- The hover target and the thing that moves is **only the black screen panel** —
  **not the whole card box.** The whole-card lift is removed.
- Keep a whisper of the card's blue border glow as a "clickable" affordance; only
  the box *movement* is removed.

## Affected files

| File | Change |
|------|--------|
| `components/screens/ScreenMock.tsx` | Panel (card frame) becomes a frosted-glass screen inside a `perspective` wrapper: translucent fill + `backdrop-blur`, sits face-on at rest, and on the panel's own hover animates `translateY(-16px) rotateX(-11deg)` (float up + look up). Detail frame unchanged. |
| `components/screens/ScreenCard.tsx` | Remove the whole-card lift (`hover:-translate-y-1.5`) and the big glow. Keep a whisper of border glow on card hover. |

The `detail` frame (large hero on `/screens/[id]`) is **unchanged** — it stays
flat/face-on.

## Behaviour

### Technique
Pure CSS 3D transforms (no three.js — this is a grid of many cards, and CSS
transforms are GPU-composited and cheap).

- The `ScreenMock` outer wrapper (the fixed-height flex box) gets
  `perspective: ~1000px` so the hover tilt reads as depth.
- The panel is the transformed element; its **own `:hover`** drives the
  animation (NOT the card `group`), with a `transition` on transform
  (~450ms ease-out).
- The screen surface is a **frosted-glass panel**, not a solid black block: a
  translucent fill (`bg-white/[0.03]`) + `backdrop-blur`, a faint `white/10`
  border and the top glare highlight. The card reads through it, keeping the
  text below visually separate.
- The existing screen content (On-air `.mk-ad`, vignette, glare, off-hours glow)
  still layers on top, so all status states keep working.

### States
- **Rest:** no transform — the screen sits straight / face-on.
- **Hover the panel:** animates to `translateY(-16px) rotateX(-11deg)` — floats
  up the Y-axis and tips up to "look" at the viewer; the drop shadow deepens
  (`shadow-card-hover`) to sell the lift.
- **Leave:** transitions back down to flat.

### Hover isolation
- The 3D transform lives on the panel and is triggered by the **panel's own
  hover**, so hovering the text/chips area does NOT move the panel.
- `ScreenCard`'s whole-card `hover:-translate-y-1.5` is removed so the box does
  not move. The card keeps a subtle `hover:border`/`hover:shadow` glow (whole
  card is still a `<Link>`, so this is a fine click affordance).

## Accessibility

- `prefers-reduced-motion: reduce` → the panel stays **flat and static** with no
  float or tilt (Tailwind `motion-reduce:` variants). This matches existing
  reduced-motion handling in this repo.
- The visual layers are decorative; `aria-hidden` stays on them. The card remains
  a normal keyboard-focusable link; the hover effect never gates interaction.

## Non-goals

- No change to the `detail` hero.
- No cursor-follow parallax (a fixed float-up + look-up motion was chosen).
- No new dependencies, no three.js, no data/schema/API changes.

## Verification

Run the site (`:3100`), open `/screens`:
1. Panel sits **straight / face-on** at rest as a frosted-glass screen; the card
   reads faintly through it and the text below is clearly separate.
2. Hover the panel → it floats up the Y-axis and tips up to look at you (~450ms).
3. Hover the card's *text* area → the panel does **not** move.
4. The whole card box no longer lifts; a faint border glow still appears on hover.
5. All status states (online On-air / off-hours / offline) still render on the
   glass at the screen's real aspect ratio.
6. With OS "reduce motion" on, the panel is flat and static.
