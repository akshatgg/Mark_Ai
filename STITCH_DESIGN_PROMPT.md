# Mark AI — Stitch Design Prompt Kit (AI-Native DOOH CMS)

A per-page prompt kit for redesigning the **existing** Mark AI signage CMS into a premium,
AI-native, dark-mode SaaS product. Grounded in the **real** pages, data entities, and
components of `markai-Web-cms` — not invented features.

---

## How to use this with Stitch

Google Stitch generates **one screen at a time** and does **not** reliably remember a global
system prompt between generations. So:

1. For each screen, **paste the `STYLE HEADER` (below) + that screen's Page Card**.
2. **Attach the screenshot** of that page as a reference image, and add:
   *"This is the current screen. Redesign it completely — keep the data, entities, actions,
   and functionality; do NOT copy the layout or visual style."*
3. Generate. Iterate per screen. Keep each prompt focused on ONE page (don't merge pages).
4. Reuse the same STYLE HEADER everywhere so all screens share one design system.

---

## ⚠️ Scope reconciliation (real product vs. what ChatGPT invented)

**These pages are REAL (you have screenshots — design these):**
Login · AI Co-Pilot (chat) · Dashboard · Screens (list + detail) · Content / Media Library ·
Solution (multi-zone layout designer) · Scheduling / Bookings (list + new + detail) ·
Gmail Ingestion · Proof of Play (Reports) · Users · API Keys.

**These were INVENTED by the earlier prompt and do NOT exist — do not ask Stitch to build them
(or move them to a clearly-labeled "future" backlog):**
Screen Marketplace, AI Studio (image/video/copy generation), Billing/Subscriptions/Invoices/
Credits, Organizations/Teams switcher, SSO, Signup + Google/Microsoft/Magic-link login, 7-step
onboarding with plans + payment, Audience prediction, Budget optimization, Notifications center,
Help Center, Wishlist/Comparison, Street View/3D screen models.

**Loose mappings (what the invented names actually are in your product):**
- "AI Assistant / Copilot" → the **AI Co-Pilot** chat (this IS your primary interface).
- "Analytics dashboard" → **Proof of Play / Reports** (DOOH play logs — no revenue/CTR/conversions).
- "Screen Marketplace / browse" → your **Screens** page is *inventory management*, not a buyer marketplace.
- "Campaign wizard / creative assignment" → your **Solution designer + Scheduling** flow.
- Auth is **login-only** (username + password, two roles). No signup, no OAuth, no onboarding.

Keep the *aesthetic* ambition from the original prompt. Drop the *feature* invention.

---

## STYLE HEADER — prepend to every page prompt

> Design a single screen for **Mark AI**, an AI-native DOOH (digital out-of-home) signage CMS,
> in a premium 2026 SaaS aesthetic — think Linear × Vercel × Stripe × Raycast × ChatGPT.
> **Dark mode first.** Deep near-black background (#0A0B0F / #0E0F14), elevated glass panels,
> soft depth shadows, 1px hairline borders (#FFFFFF at ~8% opacity). Accents: electric blue
> (#3B82F6) → neon cyan (#22D3EE) → soft purple (#8B5CF6) gradient, used sparingly for primary
> actions, active nav, and AI moments only — never a rainbow dashboard. Typography: Inter / SF Pro,
> tight tracking, clear hierarchy. 8px spacing grid, 16–24px radii. Rounded cards, floating panels,
> subtle glassmorphism in selected areas, smooth micro-interactions (hover elevation, animated
> counters, gradient shimmer). Lucide icons. Enterprise-grade, minimal, fast, intelligent.
> Include empty/loading (glass skeleton shimmer)/error states. Fully responsive, accessible
> (WCAG AA contrast). Preserve all functionality shown; redesign the layout from scratch.

---

## APP SHELL & NAVIGATION (real information architecture)

**Two modes, one product** (this is the core UX concept — design both shells):
- **AI Co-Pilot mode (PRIMARY, default on login):** a full-screen chat console.
- **Manual mode (fallback):** a classic sidebar dashboard.
- A gradient **"AI Co-Pilot"** button in the manual sidebar switches to chat; a **"Manual mode"**
  button in the chat sidebar switches back. The choice persists.

**Manual shell:**
- **Top bar:** global search, current page title, user menu (username + role + logout).
  (No org switcher, no notifications bell — those don't exist yet.)
- **Left sidebar (role-filtered):** Dashboard · Screens · Content · Solution* · Scheduling* ·
  Gmail Ingestion* · Proof of Play · Users* · API Keys** · [gradient "AI Co-Pilot" button] ·
  version + role footer. (`*` = superadmin only; `**` = api-key-permission only.)
- **Reusable components:** PageHeader (title + subtitle + actions), StatCard, Card, Table,
  Modal, Toast, Badge, StatusBadge (online/offline), BookingStatusBadge (active/paused/
  completed/cancelled), Buttons (primary/secondary/ghost/danger), Input, Select, FormField,
  EmptyState, LoadingState, ErrorState.

**Roles:** `superadmin` (everything) · `screenowner` (only assigned screens; sidebar hides
Solution, Scheduling, Gmail, Users, API Keys).

---

# PAGE CARDS

Each card lists: **Purpose · Entities (real data fields) · Components/Sections · Actions · States · Role.**

---

## 1. Login  *(the ONLY auth screen — no signup/OAuth/onboarding)*
- **Purpose:** authenticate an operator into the CMS.
- **Entities:** credentials → `{ username, password }`; returns `{ access_token, user{username, role} }`.
- **Components:** split layout; left = brand panel with a subtle animated 3D element (floating
  holographic signage screens / particle field), right = login card with Username, Password,
  "Remember me", Sign in (gradient). Mark AI gradient logo. A small line: "Accounts are created
  by an administrator." **No** signup link, **no** Google/Microsoft/magic-link, **no** company fields.
- **Actions:** submit; inline error on bad credentials ("backend unreachable" friendly error).
- **States:** default, submitting (button spinner), error banner.
- **Role:** public.

---

## 2. AI Co-Pilot  *(PRIMARY interface — design this as the hero screen)*
- **Purpose:** run the entire CMS by chatting ("find screens near Bellandur", "book summer_sale
  on CP Screen 1 next Monday 1–2pm", "show proof-of-play last week"). Human confirms every write.
- **Entities:** `AiSession{ id, title, last_active_at }`; `AiTurn{ user_message, final_response,
  status, card }`; `AiCard` types = `screen_grid | action | attachments`;
  `AiChatMedia{ filename, type image|video, width, height }`; `model` name.
- **Components:**
  - **Left history rail:** "New chat" button, session list (title + delete on hover), a
    "Manual mode" switch at the bottom, brand "Co-Pilot" logo.
  - **Center thread:** assistant/user message bubbles; **live streaming tokens** (typewriter
    caret); empty state with example prompt chips.
  - **Rich inline AI cards (design these — they're the signature feature):**
    - **Screen-grid card:** clickable screen tiles (name, online/offline pill, location/city,
      resolution) — picking one continues the chat.
    - **Action card (confirm-before-write):** "Confirm action" panel with plain-language
      summary + **Confirm / Dismiss**. Multi-action variant lists several proposed writes
      each with its own Confirm + a **"Confirm all"**. Optional **"Customize layout"** toggle
      on bookings (Full screen / Top-Bottom / Left-Right).
    - **Attachment chips:** uploaded image/video with resolution.
  - **Composer:** auto-grow textarea (Enter to send), **attach image/video** (paperclip → chips
    with resolution), send button (spinner while streaming).
  - **Header:** "Mark AI Co-Pilot" + model name + user/logout.
- **States:** empty (prompt suggestions), streaming, awaiting-confirm, executed (green check),
  error bubble, "AI not configured" fallback (CTA → manual dashboard).
- **Role:** all.

---

## 3. Dashboard
- **Purpose:** at-a-glance health of the signage network.
- **Entities:** `DashboardStats{ screens_total, screens_online, bookings_active, plays_today }`;
  recent `Screen[]`; recent `Booking[]`.
- **Components:** 4 hero **StatCards** (Total screens · Online now · Active bookings · Plays today,
  each with icon + trend/animated counter); a "Screens" panel (recent 5: name, status, last seen);
  a "Recent bookings" panel (name, schedule type, status badge). Optional premium touches: a live
  fleet mini-map / activity feed / today's schedule strip (all fed by existing data — no invented metrics).
- **Actions:** "View all" links to Screens / Scheduling.
- **States:** loading skeletons, empty ("no screens yet"), error+retry.
- **Role:** all.

---

## 4. Screens — List
- **Purpose:** the physical screen fleet (inventory), scoped to what the user can manage.
- **Entities:** `Screen{ screen_id, name, status online|offline, last_seen_at, resolution, city }`.
- **Components:** table or premium card grid — name, status pill, last-seen ("2m ago"),
  location/city, resolution; row → screen detail. Filter/search by status/name.
- **States:** loading, empty ("no screens registered"), error.
- **Role:** superadmin (all) / screenowner (assigned only).

---

## 5. Screen — Detail
- **Purpose:** everything about one screen + edit its playback loop.
- **Entities:** `Screen{ screen_id, name, location, status, resolution, manufacturer, model,
  android_version, now_playing_media_id, last_seen_at, registered_at, latitude, longitude,
  address, postal_code, city, device_info(JSON), slot_duration_seconds, loop_duration_seconds,
  total_slots }`; paginated `ProofReportRow[]` (media, played_at, duration, play_count, screenshot_url).
- **Components:**
  - **Overview panel:** id, resolution, manufacturer, model, Android, now-playing, last seen, registered.
  - **Device info panel:** full reported device profile (key/value grid).
  - **Location panel:** address, pin code, city, coordinates, "View on Google Maps" link (auto-detected by the APK).
  - **Playback loop panel:** "loop restarts every {X} · each ad plays {Y}s · {N} slots" + edit.
  - **Proof-of-play panel:** paginated table (media, played-at, duration, count, screenshot
    "View"/"Capturing…").
  - **Edit-screen modal:** name, location, **slot duration (sec)**, **loop length (sec)** —
    live-computes slot count. (Loop timing is owner-fixed; every ad plays the same slot length.)
- **States:** loading, not-found, error; "no location reported yet"; "no plays recorded".
- **Role:** superadmin / assigned screenowner.

---

## 6. Content — Media Library
- **Purpose:** the creative asset library used by bookings and loops.
- **Entities:** `Media{ id, name, type image|video, file_url, created_at }`.
- **Components:** premium asset grid/list with **thumbnail / first-video-frame previews**, name,
  type badge, added date, delete; **"Add media" modal** (drag-and-drop file upload → Cloudinary,
  optional name, auto-detected type, size readout). Search/filter by name/type. (Delete is blocked
  with a message if the media is currently playing.)
- **States:** loading, empty ("no media yet"), upload-in-progress, error/409-in-use toast.
- **Role:** all.

---

## 7. Solution — Multi-Zone Layout Designer  *(superadmin; signature power feature)*
- **Purpose:** design a split-screen ad layout for a specific screen, then save it to schedule later.
- **Entities:** `Solution{ name, screen_id, layout }`; `LayoutData{ partition_count 1|2|3, template,
  zones[] }`; `Zone{ id, x, y, w, h (%), media_id, media_url, media_type }`.
- **Components:** a **5-step wizard** with a progress stepper —
  1) **Select screen** (cards showing real aspect-ratio icon, portrait/landscape, resolution, status);
  2) **# of zones** (1/2/3 with template thumbnails);
  3) **Pick template** (Full, Top/Bottom, Left/Right, Wide+Narrow, Banner+Main, 3 Columns, 3 Rows,
     Big-Left+2-Right, 2-Left+Big-Right…);
  4) **Design zones** — a **live WYSIWYG canvas that matches the screen's real aspect ratio**, with
     **drag-to-resize dividers** and a per-zone **media picker modal** (searchable grid);
  5) **Save** — name it → go to Scheduling. Auto-saves a draft locally.
- **States:** loading, per-step validation ("assign media to all zones"), saving, error.
- **Role:** superadmin.

---

## 8. Scheduling / Bookings — List
- **Purpose:** turn saved solutions (or single media) into scheduled campaigns; manage campaigns.
- **Entities:** `Solution[]`; `BookingListItem{ name, screen_name, media_url/type or layout,
  schedule_type, start_at, end_at, status }`.
- **Components:**
  - **"Your Solutions" grid:** solution cards (zone-thumbnail preview, screen name, zone count) →
    **Schedule** button + delete.
  - **"Active Campaigns" table:** name, screen, media/layout preview thumbnail, schedule type,
    date window, status badge, delete, row → detail.
  - Header actions: **"New Solution"** and **"Single-media booking"**.
- **States:** loading, empty ("no solutions"/"no campaigns"), error.
- **Role:** superadmin (screenowners don't see this).

---

## 9. Booking Creation — Schedule Modal & Single-Media Form
- **Purpose:** the custom DOOH scheduling engine.
- **Entities:** `CreateBookingPayload{ name, screen_id, media_id, schedule_type, start_at, end_at,
  daily_windows[{start,end}], days_of_week[], target_plays_per_day, layout? }`;
  `schedule_type = continuous | specific_time | times_per_day | custom`.
- **Components:**
  - **Schedule-type selector** (cards: Continuous / Specific time / N times-per-day / Custom, each
    with a one-line description).
  - **Date range** (start / end).
  - **Daily time windows:** "run all day" toggle, or **add multiple windows** (e.g. 14:00–15:00 AND
    17:00–18:00).
  - **Days-of-week** chips (Mon–Sun).
  - **Target plays per day** (number).
  - **Offline-screen warning** banner ("you can book, but it stays paused until the screen is back").
  - Single-media form adds a **"Quick add" media upload**.
  - Info note: "how long each ad plays is fixed by the screen owner — same for every ad."
- **States:** validation errors, submitting, success toast → back to list.
- **Role:** superadmin.

---

## 10. Booking — Detail
- **Purpose:** manage one campaign and read its results.
- **Entities:** `Booking{ ...schedule..., status }`; `plays_today`, `target_plays_per_day`;
  `media_url/type` (creative preview); `screenshot_enabled`; `ScreenshotRecord[]`;
  `ProofSummary{ total_plays, total_seconds, first_play_at, last_play_at, per_day }` (on completion).
- **Components:** campaign settings summary; **creative preview** (image/video or multi-zone layout);
  **plays-today vs target** progress; **status controls** (Active / Pause / Complete / Cancel);
  **screenshot capture toggle** + screenshot gallery; a **"Final report" billing rollup card** once
  the campaign completes.
- **States:** loading, active vs completed (final report), error.
- **Role:** superadmin.

---

## 11. Gmail Ingestion  *(superadmin)*
- **Purpose:** pull external ad-booking requests that arrive by email into the CMS.
- **Entities:** connection `{ connected, email, is_simulated }`; `EmailMessage{ sender, sender_name,
  subject, date, snippet, body, extracted_fields{ advertiser, screen, campaign_start, campaign_end,
  duration_seconds, creative_url } }`.
- **Components:** **connection card** (Link Gmail / Disconnect, active-inbox chip, "Sandbox
  Simulator" badge, OAuth/privacy note); **inbox search + results list** (sender, subject, snippet,
  date); **email detail** (decoded body + **extracted-fields preview grid** + "Ingest & Analyze").
- **States:** not-connected (locked), connected, searching, empty, importing.
- **Role:** superadmin.

---

## 12. Proof of Play — Reports  *(this is your "Analytics")*
- **Purpose:** every ad shown across screens; the basis for billing advertisers.
- **Entities:** `ProofReportRow{ screen_name, media (ad), played_at, duration_seconds, play_count,
  screenshot_url }`; `total`, pagination.
- **Components:** **filter bar** (Screen dropdown, Ad dropdown, From/To dates, Reset); **paginated
  table** (screen, ad, played-at, duration, count, screenshot "View"/"Capturing…"). Optional premium
  layer: play-volume-over-time chart + per-screen heat strip (fed by the same rows — no invented
  revenue/CTR/conversion metrics). Note: completed campaigns roll up to a summary on their booking page.
- **States:** loading, empty ("no plays found — widen date range"), error.
- **Role:** all (scoped server-side).

---

## 13. Users  *(superadmin)*
- **Purpose:** create and manage operator accounts; assign screens to owners.
- **Entities:** `User{ username, role superadmin|screenowner, can_manage_api_keys, is_active,
  assigned_screen_ids[] }`.
- **Components:** users table (username, role badge, active toggle, api-key permission, screens
  assigned); **create-user modal** (username, password, role, **screen assignment** picker for
  screenowners, "can manage API keys" toggle); edit (toggle active, reset password, reassign
  screens, toggle api-key permission); delete. **No public signup anywhere.**
- **States:** loading, empty, saving, error.
- **Role:** superadmin.

---

## 14. API Keys  *(superadmin / api-key permission)*
- **Purpose:** mint keys so external partners can book programmatically via the external API.
- **Entities:** `ApiKey{ key_id, prefix, label, is_active, created_at, last_used_at }`;
  `CreateApiKeyResponse{ id, key_id, secret, prefix, label }` — **secret shown once**.
- **Components:** keys table (label, prefix, last-used, status, revoke); **create-key modal**
  (label); **one-time secret reveal** in a copyable box with a "copy now — shown once" warning.
- **States:** loading, empty, just-created (secret box), revoke confirm, error.
- **Role:** superadmin with api-key permission.

---

## DESIGN SYSTEM (tokens for a consistent kit)

- **Color:** bg #0A0B0F / surface #0E0F14 / elevated #14161C; text #F5F6F8 / muted #9AA1AC;
  hairline border rgba(255,255,255,.08); accent gradient #3B82F6→#22D3EE→#8B5CF6; status:
  online/success #22C55E, offline/idle #6B7280, warning #F59E0B, danger #EF4444.
- **Type:** Inter / SF Pro Display. Display 28–40, H1 22, H2 16 semibold, body 14, caption 12.
- **Spacing:** 8px grid. **Radii:** cards 16–20, inputs 10–12, pills full.
- **Elevation:** soft, low-spread dark shadows + 1px inner hairline (glass edge).
- **Components:** Buttons (primary gradient / secondary glass / ghost / danger / icon); Cards
  (glass, hairline, hover-lift); Inputs (dark, focus glow in accent); Dropdowns (floating,
  blurred); Tables (minimal, zebra-free, hairline rows); Badges (soft-tint); StatusBadge;
  Modals (centered glass + backdrop blur); Toasts; Skeletons (glass shimmer); Charts (Recharts,
  thin lines, gradient fills, no gridline clutter); Icons (Lucide).
- **Motion (Framer Motion):** hover elevation, button press, card expand, page fade/slide,
  animated counters, gradient shimmer on AI moments, subtle parallax. Never distracting.
- **3D (optional, R3F/Three.js):** reserve for Login and the AI Co-Pilot empty state — a floating
  holographic cluster of signage screens / particle network / soft energy waves. Keep it behind
  glass, low-motion, never blocking content.
- **Every screen:** empty state (illustration + one-line AI suggestion + primary CTA),
  loading skeletons, error+retry. Dark-mode first, responsive, WCAG-AA contrast.

---

## OPTIONAL — future modules (NOT in the product today; only if you want to design ahead)
Billing/subscriptions · Organizations/Teams switcher · Notifications center · Help Center ·
AI Studio (generative image/video/copy) · public advertiser-facing Screen Marketplace with
map/pricing/wishlist · SSO/OAuth login · self-serve signup + onboarding. Mark these clearly as
"future" so Stitch doesn't blend them into the real app.
