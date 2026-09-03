# Advertiser dashboard → CMS shell

**Date:** 2026-09-03
**Repo:** `markai-frontend-new`
**Status:** approved, implementing

## Problem

`/dashboard` and `/console` are meant to read as one signed-in platform, and both are
meant to look like the CMS at `:5120`. Only the console got there. The advertiser
dashboard still wears the marketing site's clothes.

| | CMS (`:5120`) | `/console` | `/dashboard` |
|---|---|---|---|
| 60px top bar | yes | yes (`ConsoleTopbar`) | no — rail only; a bar appears below `lg` |
| ⌘K search | yes | yes | no palette at all |
| Theme toggle | yes | yes | unreachable |
| Profile dropdown | yes | yes | identity + sign-out sit in the rail footer |
| Layout owns `<main>` | yes | yes | no — all five pages repeat the wrapper |
| Heading scale | `text-2xl` semibold | `clamp(28→42px)` extrabold | `clamp(28→52px)` extrabold |

The duplication is the root cause. Every page under `/dashboard` repeats

```
<main className="relative z-[1] min-h-screen overflow-x-clip pb-28 pt-[76px] lg:pt-10">
  <div className="relative mx-auto max-w-[1150px] px-6 sm:px-7">
```

and then hand-rolls its own hero. Five copies of the chrome is why the pages drift from
each other and from the console.

## Decisions taken

- **Structure and density only.** No token changes. `markai-frontend-new` shares
  `app/theme.css` with the public marketing site, so porting the CMS palette would
  restyle pages nobody asked to touch. Both are dark navy already; the visible gap is
  layout and type scale, not hue.
- **All of `/dashboard/*`** — overview, campaigns, content, invoices, and the invoice
  receipt.
- **Console pages are out of scope.** The console already has the shell; only its page
  headings are still oversized, and that is a separate pass.

## Approach

Promote the console's shell to a shared one, rather than copying it. Two surfaces
rendering one component cannot drift; two near-identical components will, and did.

### 1. `components/layout/AppTopbar.tsx` (renamed from `ConsoleTopbar.tsx`)

`ConsoleTopbar` is already generic — it takes `user`, `config`, `chrome`, `signOutTo`.
Exactly two things are console-specific, and both become props:

| New prop | Console | Dashboard |
|---|---|---|
| `caption: string` | `"Signage Control"` | `"Advertising"` |
| `profileHref?: string \| null` | `"/console/profile"` | omitted — no advertiser profile page exists, and inventing one would 404 |

Everything else is unchanged, so the console's bar keeps behaving identically. The
profile chip keeps showing `displayName(user)` rather than the CMS's literal word
"Profile": the console already does this, and a name is strictly more informative than
a generic label.

### 2. `app/dashboard/layout.tsx`

Mirrors `app/console/layout.tsx`:

```
CommandBarProvider (commands from the rail via commandsFromRail)
  AppBackdrop
  AppTopbar  ← search pill, theme toggle, profile menu
  flex row:
    DashboardNav (rail)
    main  ← px-5 pb-24 pt-6 sm:px-7 lg:pt-8, inner max-w-[1180px]
```

`DashboardNav` gains a `chrome` prop and passes `railHeader={false} railFooter={false}
ownBar={false}`, exactly as `ConsoleNav` does — the brand block and the sign-out move
into the bar, so neither is printed twice.

The ⌘K palette is derived from the rail config, so a row added to the nav is reachable
by name on the same commit instead of the two lists quietly diverging.

### 3. `components/patterns/PageHeader.tsx` (new)

The CMS's scale and spacing, frontend-new's tokens:

```tsx
<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 className="m-0 font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
    {subtitle && <p className="mb-0 mt-1 text-sm text-muted">{subtitle}</p>}
  </div>
  {actions && <div className="flex items-center gap-2">{actions}</div>}
</div>
```

### 4. The five pages

Each drops its `<main>` wrapper and its hero, and calls `PageHeader`. Two judgement
calls:

- **Overview keeps "Hey {name}"** as its title, at 24px instead of 52px. It costs
  nothing and keeps the advertiser surface warmer than the operator console, which is
  the correct difference between the two audiences.
- **`/dashboard/invoices/[paymentId]` opts out of the standard wrapper.** It is the
  printable receipt: its own `max-w-[860px]`, and a full set of `print:` overrides that
  strip the chrome. It gets the shell but keeps its own width, and printing is verified
  to still produce a clean page.

### 5. Header action buttons

Normalise to the CMS's compact size (`h-9`, `text-sm`). They are currently `py-2.5`
marketing-weight buttons, which is what makes the dashboard read as a landing page.

## Risks

- **`pt-[76px]` must come out of every page.** It exists to clear the *fixed* mobile
  bar. The new bar is *sticky* and owned by the layout, so leaving the padding opens
  every page with a 76px gap. This is the change most likely to look broken halfway
  through.
- **The invoice receipt's print path.** The bar is already `print:hidden`, but the new
  flex-column layout wraps it, so print output needs an actual check rather than an
  assumption.
- **`SidebarShell` pins the rail at `top-[60px]` when `ownBar={false}`.** That constant
  has to keep matching `AppTopbar`'s height or the divider goes crooked.

## Out of scope

Token/palette changes, the marketing site, console page headings, and any change to
what the dashboard pages actually show. This is chrome only — no data, copy, or
behaviour changes beyond the headers themselves.
