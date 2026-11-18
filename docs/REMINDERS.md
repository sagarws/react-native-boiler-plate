# Reminders & alarms

Sidebar → **Reminders**. Birthdays, appointments, important events and personal
reminders that ring like an alarm, even when the app is closed.

## What it does

- **Create / edit:** title, optional description, date (calendar), exact time
  (quick times or HH:MM), category (Birthday, Personal, Meeting, Important event,
  Custom with your own label) and repeat (Never, Daily, Weekly, Monthly, Yearly).
  Choosing Birthday switches the repeat to Yearly. Reminders can be switched on or
  off, and deleted.
- **Alert** (shared `AlertSettings` component, also used by Utility timers):
  - Sound + vibration
  - Sound only
  - Vibration only
  - Silent notification
  - High priority

  You can also set the ringtone (system picker, with a preview), volume, vibration
  pattern (Standard / Short / Long / Heartbeat) and snooze (off / 5 / 10 / 15 /
  30 min).
- **Dashboard:**
  - "Next up" card with a countdown.
  - Month calendar with a dot per reminder (birthdays and important events first).
  - The selected day's reminders.
  - Upcoming / Past / Off lists.
- **When it rings:** an ongoing notification with **Snooze N min** and **Dismiss**.
  A high-priority alarm also opens a lock-screen alarm screen, when Android allows
  it.

## How it works

```
ReminderFormScreen → reminderActions → remindersStore (MMKV `reminders.items`)
                                     ↘ useReminderAlarmSync (App.tsx)
                                        → src/services/alarms → NativeAlarms (alarms/)
```

- **JS is the source of truth.** `useReminderAlarmSync` (mounted in `App.tsx`)
  hands every enabled reminder to the native engine after each change (debounced)
  and on every return to the foreground. Each sync replaces the whole `reminder`
  group, so there are never stale or duplicate alarms.
- **Reminders are local wall-clock times** (`date` + `time` + `repeat`), not
  instants.
  - The native side computes the next ring in the phone's current time zone each
    time it arms, so "09:00 daily" stays 09:00 across time-zone and daylight-saving
    changes.
  - Monthly on the 31st rings on the last day of shorter months. Yearly on 29 Feb
    rings on 28 Feb in other years.
  - The same rules exist in JS (`src/services/alarms/schedule.ts`) and Kotlin
    (`AlarmMath.kt`), and both are tested with the same cases.
- **Past:** a one-off whose time has gone. **Off:** switched off, with an occurrence
  still ahead.

## Shared alarm engine (`android/.../alarms/`, `src/services/alarms/`)

| Piece | Job |
|---|---|
| `AlarmScheduler` | Stores the alarms per group (SharedPreferences) and arms one `PendingIntent` per key. Remembers the last instant each key fired, so a late or repeated delivery is ignored. Re-arms repeats after each ring. |
| `AlarmReceiver` | Fires the alarm and hands it to `AlarmAlert`. |
| `AlarmRingService` | Foreground service that plays the ringtone (alarm stream, chosen volume, looped) and vibration pattern. Shows the Snooze / Dismiss notification. Stops after the ring time (60 s for reminders, 30 s for timers); the notification then stays as a plain one. |
| `AlarmActivity` | Lock-screen alarm screen for high-priority alarms. |
| `AlarmRestoreReceiver` | Re-arms everything after `BOOT_COMPLETED`, an app update, `TIME_SET` or `TIMEZONE_CHANGED`. |
| `AlarmsModule` | Bridge: `sync`, `dismiss`, ringtone picker / preview, exact-alarm and full-screen permission checks. |

- **Exact alarms.** With `SCHEDULE_EXACT_ALARM` granted:
  - Alarms use `setExactAndAllowWhileIdle`.
  - High priority uses `setAlarmClock`, which shows the clock icon.
  - The ring service starts as type `systemExempted`, which Android allows from an
    exact alarm.
- **Without exact alarms** (the Android 14+ default for new installs):
  - Alarms are inexact and may be delayed while the phone is idle.
  - The dashboard says so and links to the setting.
  - If the service can't start from the background, a high-importance notification
    plays the default alarm sound instead.
- **Do Not Disturb.** Alerts use the alarm audio stream. The app never changes
  system volume, never asks for DND access, and doesn't claim to bypass Do Not
  Disturb.

## Permissions

| Permission | Why |
|---|---|
| `POST_NOTIFICATIONS` | The alert notification. Asked when the first reminder is saved. |
| `SCHEDULE_EXACT_ALARM` | On-time alarms. Optional; the user grants it in system settings. |
| `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Keep ringing with the app closed. |
| `WAKE_LOCK` | Keep the CPU awake while ringing. |
| `USE_FULL_SCREEN_INTENT` | Lock-screen alarm screen. Android 14+ lets the user revoke it; high priority then shows a notification. |
| `RECEIVE_BOOT_COMPLETED`, `VIBRATE` | Already declared by the app. |

## Tests

- `src/services/alarms/__tests__/schedule.test.ts`: next occurrence (one-off,
  daily, weekly, monthly clamping, yearly / 29 Feb), ranges, and alert validation.
- `src/features/reminders/__tests__/remindersLogic.test.ts`: validation, upcoming /
  past / off, day lists, calendar dots, alarm entries and the store.
- `src/features/reminders/__tests__/RemindersScreens.test.tsx`: dashboard, toggle,
  form (birthday → yearly, errors), edit / delete and alarm sync.
- `android/.../alarms/AlarmMathTest.kt`: the same schedule cases plus daylight
  saving, and entry validation.
- **Verified on an Android 15 emulator:**
  - Rang with the app process killed.
  - Snooze re-armed the alarm 5 minutes later.
  - Re-armed after a reboot and rang.
  - The exact-alarm notice appeared until the setting was granted.

## Known limitations

- Force-stopping the app from Android settings cancels its alarms; this is Android
  policy. Opening the app again re-arms them.
- Some phone makers' battery savers can still delay or block alarms. The app can't
  override that.
- The volume is relative to the phone's alarm volume. At 0 the ringtone is silent;
  vibration still works.
- The lock-screen alarm screen needs the full-screen-intent permission on Android
  14+.
