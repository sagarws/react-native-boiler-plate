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
- **Different units are never added together.** Rates are "periods met / periods
  judged", and quantity charts are per task in that task's unit.
- **Countdown:** the time left until local midnight after the period's last day.
  It refreshes every 30 s and whenever the app comes back to the foreground.

## Task and project detail pages (`services/progress.ts`)

Tap a task card on a project page to open **Task details** (`LifeTask` route). The
project page (`LifeProject`) now also has a progress calendar and a progress chart.

- **Calendar shading** (`taskDayCell`, `projectDayCell`, `levelFor`). Every day takes
  the target period that contains it, so a weekly or every-N-days target shades the
  whole period the same way.
  - *No target*: before start, after end, paused, before tracking began, or in the
    future. These days are neutral and never count as missed.
  - *Not reported*: a target was scheduled but nothing was logged. Neutral fill with a
    border and a "–" label.
  - *Under 34% / 34–66% / 67–99% / Met (100%+)*: four strengths of the task's or
    project's colour.
  - Each cell also shows its % as text, so the scale doesn't rely on colour alone.
- **Project day value:** the average, across the tasks that have a target scheduled
  that day, of each task's own completed / target, capped at 100%. An unreported
  period counts as 0%. Units are never added together.
- **Task chart:** target vs actual for each period, in the task's own unit, 7 periods
  per page. The % is shown as text, not on the axis.
- **Project chart:** each task's line is the share of its *planned total* reported so
  far.
  - A task's schedule runs from its start to its end date, or to the project deadline
    if it has no end date.
  - The planned target builds up evenly through each period (a weekly target adds
    1/7 per day). Paused periods plan nothing.
  - *Average actual*: the mean of the task lines (each capped at 100%) for tasks that
    have started.
  - *Average target*: the mean of the planned shares.
  - Every line can be shown or hidden. Task lines after the fifth start hidden.
- **Task counts:** completed = marked completed. Overdue = not completed and past its
  end date (or the project deadline). Pending = the rest.

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

## Tests

- `__tests__/periods.test.ts`: periods, versions, pauses, DST and streaks.
- `__tests__/lifeStore.test.ts`: CRUD, validation, duplicates, reviews,
  analytics and target help.
- `__tests__/recommendations.test.ts`: payload, parsing and local insights.
- `__tests__/progress.test.ts`: calendar levels, period handling, unit-safe averages,
  the target schedule, chart dates and line toggles.
- `__tests__/ManageLifeScreens.test.tsx`: screens, log flow, review flow, forms,
  AI flows, history filters/CSV, the task details page and the project calendar/chart.
- `android/.../LifeCoachTest.kt`: request body and schema.

## Known limitations

- There's no home-screen widget. The Today tab is the quick-entry surface.
- There are no reminders or notifications, because the project has no
  notification library.
- Milestones aren't implemented.
- Charts are drawn with plain views (bars, heatmaps and rotated line segments), not a
  charting library or SVG. Lines are straight between sampled dates (up to 10 per
  project).
- Data is only on the device. CSV export (History → Share) is the only way to
  get it out, and there's no import or cloud sync.
