# Follow Up — personal CRM

Contacts, scheduled follow-ups, one-tap call / WhatsApp, outcomes and a
timeline. Everything is stored on the device (MMKV); nothing is uploaded.

Sidebar → **Follow Up**. Settings → **Follow Up** tab.

## Screens

| Screen | What it does |
|---|---|
| `FollowUpScreen` | Summary cards (contacts, due today, overdue, done today, upcoming), birthdays in the next 14 days, search (name / number), filters (category, tag, date range), sort, and the lists **Pending · Today · Overdue · Upcoming · Follow-up done · All contacts**. One card per contact even with several follow-ups (“+N” shows the rest). |
| `ContactFormScreen` | New / edit contact. Name + mobile required; country code kept separately (or type `00…` for any country); birth date, email, organisation, location, category, tags, notes, photo; optional first follow-up. Categories/tags can be created from the form without losing it. Duplicate numbers warn and offer the existing contact — never merged. |
| `ContactDetailScreen` | Details, call / WhatsApp / schedule / note, open follow-ups (mark done, change, cancel), full timeline, active/inactive, delete (confirmed). |
| `FollowUpSettings` (Settings tab) | Reminders, defaults (country code, type, start view), categories & tags (create, rename, colour/icon, activate, delete), export CSV/JSON, delete all. |

## Fill from phone contacts

The contacts button at the right end of the Name field opens the phone’s
contacts (`components/DeviceContactsModal.tsx`), searchable by name or number.
Choosing one — or one of its numbers when it has several — fills name, country
code + number (`+44 …` is split using the known codes; unknown codes use the
`00…` form), email, organisation and birthday (only when it has a year).
Contacts already in Follow Up are marked. `READ_CONTACTS` is asked only on tap;
if refused, **Pick one contact instead** opens the system picker, which needs no
permission. The list is read on the phone and held only while the screen is
open; only the chosen contact is saved, after the usual duplicate check.

## Data model (`src/features/followup/types.ts`)

- **Contact** — `dial` + national `phone` + normalised `e164` digits (used for `tel:` and `wa.me`).
- **FollowUpActivity** — one per follow-up: `day`, optional `time`, `type`, `purpose`, `reminder`, `cancelled`, `completedAt`, `outcome`, `completionNote`, `nextActivityId`. Completing never overwrites; “schedule next” creates a new record linked from the old one.
- **ContactNote** — user-recorded notes and logged calls / WhatsApp chats / meetings, with an optional private attachment.
- **ContactEvent** — what the app itself observed: dialer opened, WhatsApp opened, follow-up moved. The timeline shows these as “recorded by the app”, apart from “recorded by you”.
- **Category / Tag** — user-defined; deleting one clears it from contacts (count shown first).

Status (Scheduled / Due / Overdue / Completed / Cancelled) is **derived**, never stored
(`services/status.ts`): untimed follow-ups are Due all day and Overdue from the next
day; timed ones turn Overdue once the time passes.

Storage keys: `followup.*` in `src/store/mmkv.ts`. Records are validated on load.

## Calling and WhatsApp

- Call → `tel:+<e164>` opens the dialer; the user presses Call. No `CALL_PHONE`.
- WhatsApp → `https://wa.me/<digits>` (no `+`), optional pre-filled text; never sent automatically. Without WhatsApp the link falls back to a browser, or an error is shown.
- When the user comes back to the app, a “How did it go?” sheet offers **record outcome & mark done**, **log as interaction**, or nothing — opening an app is not treated as a completed call/message.

## Reminders

`hooks/useReminderSync.ts` (mounted in `App.tsx`) rebuilds the full reminder set
(`services/reminders.ts`) after every change and hands it to Android
(`followup/Reminders.kt`), which cancels everything it armed before and arms the
new set — so date changes reschedule and completed / cancelled / deleted
follow-ups drop out with no duplicates.

- Per follow-up with a reminder: at its time (or the preferred time) minus the lead time.
- Overdue nudge (optional): next morning at the preferred time if still open.
- Birthdays (optional): on the day at the preferred time.
- Uses `setAndAllowWhileIdle` (no exact-alarm permission): may be a few minutes late in Doze.
- Re-armed after reboot / app update (`RECEIVE_BOOT_COMPLETED`).
- Notification permission is asked when reminders are switched on; if blocked, nothing is scheduled and Settings says so. The lock screen shows only “Follow-up reminder”.
- Tapping a reminder opens `rnboilerplate://followup/contact/<id>`.

## Native module

`src/specs/NativeFollowUp.ts` ↔ `android/.../followup/FollowUpModule.kt`
(`syncReminders`, `saveTextDocument` via the system “Save to…” picker,
`openAttachment` via FileProvider). Only `features/followup/services` imports the spec.

## Known limitations

- Country picker lists the app’s existing countries; others work by typing `00` + code.
- Reminder timing is approximate in battery-saving modes.
- Attachments are private copies in app storage; the JSON backup references them but doesn’t embed them.

## Tests

`src/features/followup/__tests__/` — phone normalisation, contacts/labels CRUD,
duplicates, status maths, completion history, lists/filters/summary, reminders,
call/WhatsApp links and failures, CSV safety, restart persistence, and the
screens. Kotlin: reminder parsing in `UtilityMathTest`.
