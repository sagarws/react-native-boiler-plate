# Manage Life

Projects with measurable, recurring tasks, quick progress logging, period-end
reasons, a calendar, history and on-request Gemini recommendations. It's
offline-first: everything lives in MMKV on the device. The only network call is
the optional Gemini request, which goes through the existing native
`GeminiClient`.

Open it from the drawer under **Manage Life**. The tabs are Dashboard · Projects ·
Today · Calendar · History · Insights.

## Data model (`src/features/life/types.ts`)

| Record | Key fields |
|---|---|
| `Project` | name, icon / imageUri, color, startDate, deadline, priority, status (active/completed/archived), objective, successCriteria, category, notes |
| `Task` | projectId, name, unit, `targets: TargetVersion[]`, startDate, endDate?, status (active/paused/archived), `pauses[]`, focusDay, priority |
| `TargetVersion` | effectiveFrom, quantity, frequency (`daily` / `weekly` / `interval`), intervalDays |
| `ProgressReport` | taskId, day, quantity, note, `edits[]` (audit trail) |
| `PeriodReview` | taskId, periodStart, periodEnd, reason, note, snapshot of target/completed (one per task + period) |
| `RecommendationSet` | generatedAt, dataVersion, summary, items |

There's one MMKV key per collection (`StorageKeys.Life*`). `life.meta` holds
`schemaVersion` and a `version` counter that increases on every write. Records
are validated when they load, and invalid rows are dropped instead of crashing
the app.

## How the numbers are calculated (`services/periods.ts`, `services/analytics.ts`)

- **Days** are local calendar days (`"YYYY-MM-DD"`), and the arithmetic is done
  in UTC. That way DST and timezone changes never shift a period.
- **Periods aren't stored.** They're computed from the target version in force
  on that day:
  - **daily**: each day.
  - **weekly**: Monday to Sunday. The first week can be partial.
  - **interval**: every N days, counted from the version's start.
- **Target edits never rewrite history.** A new version starts at the next
  period start, and past periods keep the target they had.
- **Period state:** completed = the sum of reports in the period. The task is
  met when completed ≥ target. Over-achievement is shown, but the percent is
  capped at 100.
  - An ended, unmet period needs a reason (`report_required`) until one is
    given (`missed`).
  - Periods fully covered by a pause, or ending before the task was created,
    don't count.
- **Logging progress:** you can log on any day within the task's start and end
  dates, past (catching up) or future (pre-logging). Use the Today / Yesterday
  chips, the date picker in the Log progress sheet, or pick the day in the
  Calendar tab and tap Log progress. A future entry counts toward that day's
  period. Quick-add chips add +5 / +10 / +15 to the amount. Targets under 5 use
  +1 / +2 / +3, and targets of 1,000 or more scale by tens
  (`utils/format.ts` `quickAddSteps`).
- **Different units are never added together.** Rates are "periods met / periods
  judged", and quantity charts are per task in that task's unit.
- **Countdown:** the time left until local midnight after the period's last day.
  It refreshes every 30 s and whenever the app comes back to the foreground.

## Gemini recommendations

- The request only happens when you tap the button. There's a 15 s cooldown and
  an in-flight guard, and it needs at least 5 judged periods.
- **What gets sent:** a compact summary of your own data (names, units, targets,
  per-period results, reasons, notes). It contains no ids and is capped at 22k
  characters. The API key stays in native `SecureKeyStore`, and the payload and
  key are never logged.
- **Native code:** `LifeCoach.kt` sends a strict JSON schema. The JS side
  (`parseRecommendations`) re-validates the reply:
  - unknown categories are dropped
  - `taskName` must match an existing task
  - a proposed target must be valid and different from the current one
- **Caching:** the last result is cached with the `version` it came from, and a
  "stale" notice appears once the data has changed.
- **Target changes:** a suggestion changes nothing until you tap Review →
  Accept. Accepting adds a new target version from the task's next period
  start.
- **Offline fallback:** `localInsights` gives rule-based observations when AI
  isn't available.

## Task and project detail pages (`services/progress.ts`)

Tap a task (on a project, or on the Today tab) to open its **task page**. Tap a project to open its **project page**. All numbers come from saved targets and reports through the period service.

**Calendar shading** (`taskCalendar`, `projectCalendar`, `levelFor`):
- A day takes the evaluated state of the **target period** that contains it, so weekly and every-N-days targets shade their whole period, never a day on its own.
- Neutral: no target that day, a paused period, a future period, or nothing reported.
- Levels by reported completion (completed ÷ target): low < ⅓ ≤ partial < ⅔ ≤ high < 1 ≤ full.
- The scale uses the task's or project's own colour. Every cell also prints its percent and reads it out, so the meaning never depends on colour alone.
- Project day: the mean of min(ratio, 1) over the task targets scheduled that day. A scheduled task with no report counts as 0%, but the day stays neutral if none of them has a report. Units are never added together.

**Task chart** (`taskPeriodBars`): one bar per target period with the amount done in the task's unit, a marker at the period's target and the percent above it. Paused periods are left out, and the chart pages through periods ten at a time.

**Project chart** (`projectChart`): cumulative percent of each task's **whole plan**.
- **Plan:** every unpaused target period from the task's start to its end date, or to the project deadline when the task has none. Each period counts its own target version.
- **A task line:** Σ min(done in period up to the day, period target) ÷ plan total. The cap means over-achieving one period can't hide a missed one.
- **Average done:** the mean of the task lines that have started.
- **Average planned:** the mean of each task's planned share by that day. Ended periods count in full and the current one in proportion to its elapsed days, so 50% means half the planned work should be done.
- **Display:** up to 30 sample days from the project start to today (within the deadline). Each line toggles on its own; with more than 6 tasks, the extra task lines start hidden.

**Task counts** (`taskStanding`): completed = marked completed. Overdue = past its end date, or an ended period short of target still needs a reason. Pending = everything else.

Charts and calendars are drawn with plain views (no chart library or SVG), like the other Manage Life charts.

## Long-Term Planner

The Long-Term Planner tab plans decades as an interactive mind map. See
[LONG_TERM_PLANNER.md](./LONG_TERM_PLANNER.md), which also describes the full ZIP backup.

## Backup & restore (Excel)

Manage Life header → folder icon → **Backup & restore**.

- **Export to Excel** writes one `.xlsx` workbook (`akshar-manage-life-YYYY-MM-DD.xlsx`)
  to a place the user picks (system "Save to" screen, no storage permission). Sheets:
  About (format marker, version, counts), Projects, Tasks, Targets (every target
  version), Pauses, Progress, Progress edits, Reviews. Row 1 holds the column keys.
  Task/project names and units are added as readable helper columns and ignored on
  import. Pictures are not included (they are files on the phone), and neither is the
  cached AI advice.
- **Import from Excel** picks an `.xlsx`, shows what it holds, and changes nothing until
  the user chooses:
  - **Merge**: new ids are added, and an existing id is replaced only when the backup's
    copy is newer (`updatedAt`). Nothing is deleted.
  - **Replace all** (asks for confirmation first): current data is swapped for the
    backup's.
- Every imported row goes through the same validation as stored data
  (`lifeStore.restore`). Rows that are invalid, or whose project/task is missing, are
  skipped and counted.
- Files edited in Excel or Google Sheets still import: columns are matched by header
  (any order), Excel date serials become dates, and numbers typed as text are read.

| Layer | Code |
|---|---|
| Screen | `components/BackupSheet.tsx` (opened from `ManageLifeScreen`) |
| Hook | `hooks/useLifeBackup.ts` |
| Service | `services/backup.ts` (pure mapping, tested), `services/backup.service.ts` |
| Store | `lifeStore.restore` (merge / replace) |
| Native | `lifebackup/Xlsx.kt` (`.xlsx` writer and reader, java.util.zip + DOM, no library), `LifeBackupModule.kt` |

## Tests

- `__tests__/periods.test.ts`: periods, versions, pauses, DST and streaks.
- `__tests__/lifeStore.test.ts`: CRUD, validation, duplicates, reviews,
  analytics and target help.
- `__tests__/recommendations.test.ts`: payload, parsing and local insights.
- `__tests__/ManageLifeScreens.test.tsx`: screens, log flow, review flow, forms,
  AI flows, and history filters/CSV.
- `android/.../LifeCoachTest.kt`: request body and schema.

## Known limitations

- There's no home-screen widget. The Today tab is the quick-entry surface.
- There are no reminders or notifications, because the project has no
  notification library.
- Milestones aren't implemented.
- Charts are simple view-based bars and heatmaps, not a charting library.
- Data is only on the device. CSV export (History → Share) is the only way to
  get it out, and there's no import or cloud sync.
