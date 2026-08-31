# WhatsApp: milestone proof shots + welcome on link — design

**Date:** 2026-08-19 · **Repo:** `markai-signage-api` (+ one toggle in `markai-Web-cms`)
**Builds on:** `docs/superpowers/specs/2026-08-12-whatsapp-copilot-design.md`

## 1. What we are building

1. **Milestone photo → WhatsApp.** When a booking's milestone screenshot (start / mid / end)
   lands from the screen, the operator who made the booking gets that photo on WhatsApp
   automatically — whether the booking was made from WhatsApp or from the CMS. The trigger
   is the screenshot arriving, so the booking path is irrelevant.
2. **Welcome on first link.** The first time a number is linked to a CMS account — by the
   operator messaging us (`try_bind`) *or* by typing it into the CMS (`set_number`) — we
   send one welcome message explaining that this is Mark AI CMS on WhatsApp.

## 2. The constraint that shapes it: business-initiated messages

WhatsApp allows free-form messages only inside the 24-hour window after the operator's
last inbound message. A milestone photo arrives hours/days later; a CMS-typed number has
never messaged us. Outside the window Meta rejects the send (error 131047) unless it is an
**approved utility template** (~₹0.115 each in India).

**Rule:** `window_open(link.last_message_at)` → send free-form (free); otherwise → send the
template. Same picture, same words. Two templates, created once in WhatsApp Manager:

| Name | Category | Shape | Body |
|---|---|---|---|
| `milestone_proof` | UTILITY | header IMAGE, body 4 params | `📸 {{1}} on {{2}} just hit its {{3}} milestone. Here's the proof shot, captured {{4}} IST. Open the CMS for the full report.` |
| `cms_welcome` | UTILITY | body 1 param | `👋 Welcome to Mark AI CMS on WhatsApp, {{1}}. This number is now linked to your account — milestone proof shots and alerts arrive here, and you can message me anything you'd ask the co-pilot.` |

Template names/language are config (`WHATSAPP_MILESTONE_TEMPLATE`, `WHATSAPP_WELCOME_TEMPLATE`,
`WHATSAPP_TEMPLATE_LANG=en`). If a template name is unset, the closed-window path logs and
skips (dev without approved templates still works inside the window, and dry-run logs).

## 3. Components

| Unit | Responsibility |
|---|---|
| `app/whatsapp/window.py` (new, pure) | `window_open(last_message_at, now=None) -> bool` — 24h rule, tz-aware, None → False. `WINDOW = timedelta(hours=24)`. |
| `app/whatsapp/client.py` | `build_payload` gains `kind == "template"`: `{"name","lang","components"}` → Meta `{"type":"template","template":{"name","language":{"code"},"components":[...]}}`. `send()` unchanged. |
| `app/whatsapp/notify.py` (new) | `send_welcome(db, link, user) -> bool` and `send_milestone(db, record, job) -> bool`. Each: resolve recipient, check preference/guards, decide free-form vs template, call `client.send`, stamp the guard column, commit. Best-effort: catches `WhatsAppSendError`, logs, returns False. Never raises. |
| `app/whatsapp/link_service.py` | `set_number` and `try_bind_hash` unchanged in behaviour; callers send the welcome. New column `WhatsAppLink.welcomed_at`. |
| `app/whatsapp/inbound.py` | the bind branch calls `notify.send_welcome` instead of the bare `LINKED_REPLY`. |
| `app/whatsapp/router.py` | `PUT /cms/whatsapp/link` calls `notify.send_welcome` after `set_number`; new `PATCH /cms/whatsapp/preferences` `{milestone_photos: bool}`; `LinkStatusResponse.milestone_photos`. |
| `app/cms_users/models.py` | `whatsapp_milestones: bool` default True (migration). |
| `app/screenshots/service.py` | `ingest_screenshot`: after commit, for `milestone_*` frames, call `notify.send_milestone` (same best-effort block style as the on-demand delivery). |
| `markai-Web-cms` `LinkPanel.tsx` | a "Send milestone photos to WhatsApp" switch; `api.whatsapp.setPreferences`. |

## 4. Flows

**Milestone.** APK uploads frame → `ingest_screenshot` stores record, closes job, commits →
`notify.send_milestone(db, record, job)`:
1. `job.delivered_to_chat_at` set → return (already sent; retried upload).
2. booking.`booked_by` → user; user inactive or `whatsapp_milestones=False` → skip.
3. `WhatsAppLink` for that user → none → skip.
4. caption/params: booking name, screen name, milestone word (start/mid/end), captured time IST.
   URL = `ai_delivery.whatsapp_image_url(signed_url_for(record.cloudinary_url) or record.cloudinary_url)`.
5. `window_open(link.last_message_at)` → `{"kind":"image","link","caption"}`; else template
   `milestone_proof` with header image param + 4 body params. Unset template → log + skip.
6. `client.send(..., cms_user_id=user.id, media_ref={"url": record.cloudinary_url, "screenshot_record_id": record.id})`
   (`client.send` already records outbound rows; pass the `media_ref` through the message dict).
7. stamp `job.delivered_to_chat_at = now`, commit.

**Welcome.** `set_number`/bind → link → `notify.send_welcome(db, link, user)`:
1. `link.welcomed_at` set → return.
2. window open (bind path: the linking message just arrived) → free-form welcome text;
   closed (CMS-typed) → template `cms_welcome` with param = user's display (email local part).
3. send; stamp `welcomed_at`; commit. On the bind path the old `LINKED_REPLY` is replaced by the
   welcome (no double message).

## 5. Error handling
- All sends best-effort; a failure never fails the screenshot upload or the link request.
- `WhatsAppSendError` logged with the Meta body (template not approved / 131047 show up here).
- Guards (`delivered_to_chat_at`, `welcomed_at`) stamped only after a successful send; one success is
  final. A failed milestone send is NOT retried: a re-uploaded frame returns early on the existing
  record before the hook, so the photo is simply missing from WhatsApp (the CMS still has it). A
  failed welcome retries on the next link save.
- Milestone frames on GCS are re-encoded to a ≤4.5 MB, ≤2560 px derivative (`app/whatsapp/imaging.py`)
  under `screenshots/whatsapp/<booking>/<shot>.jpg` — Meta rejects images over 5 MB and annotated
  4K frames are 3–6 MB. Cloudinary frames use the URL transform.

## 6. Tests (written; user runs full suite)
- `window_open` edge cases; `build_payload` template shape; `notify` decisions (window/template/
  skip on preference/skip on no link/guard) with `client.send` monkeypatched; ingest hook fires
  for `milestone_*` only; router preference PATCH; bind path sends welcome once.

## 7. Setup (manual, once)
WhatsApp Manager → Message templates → create the two templates above (UTILITY, English), wait
for approval, set `WHATSAPP_MILESTONE_TEMPLATE=milestone_proof`, `WHATSAPP_WELCOME_TEMPLATE=cms_welcome`.
Image header templates need a sample image at creation time — any JPEG.

## 8. Out of scope
Sending to the screen's owner as well as the booker; per-milestone opt-out; retries beyond the
natural upload retry; marketing templates.
