# Long-Term Planner (Manage Life → Long-Term Planner)

Plans that span decades, mapped as an interactive mind map: a project, its
goals, sub-goals of any depth, and milestones. Lives inside the Manage Life
feature (`src/features/life/planner/`), uses the same MMKV persistence, theme,
pickers and backup, and adds no third-party libraries.

## Architecture

| Layer | Code |
|---|---|
| Screens | `planner/screens/PlannerMapScreen.tsx` (canvas + toolbar + sheets), `PlannerProjectFormScreen.tsx`; the tab is `planner/components/PlannerTab.tsx` |
| Components | `MindMapCanvas` (gestures, camera, culling), `NodeCard` (+ `ProgressRing`), `NodeFormSheet`, `NodeDetailSheet`, `NodeMenus` (action menu, move picker, search), `Chips` |
| Hooks | `planner/hooks/usePlanner.ts`: `usePlannerData`, `useProjectMap` (nodes, progress and layout memoised on data version + style + focus), `useLabels`, `usePlannerReminderSync` |
| Services (pure, tested) | `hierarchy.ts` (tree ops, cycle checks, repair), `layout.ts` (four layouts), `plannerProgress.ts`, `plannerQueries.ts` (dashboard, milestones, search, templates, move targets), `plannerFormat.ts`, `plannerReminders.ts` |
| Store | `planner/store/planner.store.ts`: validated load, single `commit`, per-project undo/redo, `restore` |
| Native | `lifebackup/ZipBackup.kt` (ZIP with SHA-256 manifest, path checks), `LifeBackupModule.kt` (save/read ZIP, staging, open attachment, planner reminders) |

Routes: `PlannerMap {projectId, focusNodeId?}` and `PlannerProjectForm {projectId?}`.
Deep link: `rnboilerplate://planner/<projectId>/<nodeId>` (used by reminders).

## Data model (`planner/types.ts`)

| Record | Notes |
|---|---|
| `LongTermProject` | name, vision, dates (`targetEstimated`), `deadlineHistory` (every target-date change), colour/icon/picture/cover, `preferredStyle`, `progressModel`, `optionalMode`, `rootNodeId` |
| `LongTermNode` | `parentId` (null only for the root), `kind` node / milestone, status, category, dates (`dateEstimated`, `rangeConfirmed`), `actualCompletedAt`, `progress`, `weight`, `sortOrder`, `collapsed`, `offsets` (dragged position per style), `link` (Manage Life project/task id), `attachments`, `reminderAt` |
| `LongTermStatus` | system pending / running / completed / ignored plus saved custom ("Other") statuses with colour |
| `LongTermCategory` | system mandatory / optional plus saved custom categories with colour |
| `LongTermNote` | dated note or progress update (a progress update also sets the node's %) |
| `PlannerSettings` | per-project canvas view (zoom + pan) |

Every project has exactly one root node, which mirrors the project's name, dates
and colour. Milestones are nodes, so they appear on every map style, the timeline
and the milestone lists. Colours are theme palette keys, which keeps them readable
in light and dark mode. Dates are `YYYY-MM-DD` with any year.

**Integrity.** Moves are refused when the target is the node itself or inside its
branch (`canMove`). Loading or restoring runs `repairTree`, which re-attaches
orphans, cycles and extra roots to the root instead of dropping them. Child dates
are never changed when a parent's dates change. A child outside its parent's range,
or a target before its start, needs an explicit confirmation (`rangeConfirmed`,
`allowReversed`).

## Progress (`plannerProgress.ts`)

Progress is computed bottom-up in one pass, so each node counts exactly once
towards its parent:

- **Leaves:** completed = 100%, pending = 0%, running or a custom status = its recorded %, ignored = excluded.
- **Parents:** completed = 100%, ignored = excluded; otherwise the mean of their eligible children (equal, or weighted by `weight`). A parent with no eligible children uses its own leaf value.
- **Optional goals:** count like mandatory ones by default. A project can set `optionalMode: 'exclude'`.
- **Counts:** completed, active (not ignored) and overdue descendants. A node is overdue when its target date has passed and it isn't completed or ignored.

## Map styles (`layout.ts`)

All four styles lay out the same visible tree (collapsed branches hidden, focus
mode applied). Switching style never changes data; the choice is saved per project.

- **Classic tree:** a top-down tidy tree where each subtree gets the width it needs. S-curve connectors.
- **Roadmap:** the same, left to right.
- **Radial:** the root in the centre, with angular share proportional to leaves. Ring radius grows so cards fit. Curved connectors.
- **Timeline:** x = date (260 px per year), one row per node, with a date bar per node (solid = completed, tinted = running, outlined = planned), year lines and a today line. Elbow connectors.

Dragging the selected node stores an offset for the current style, and its branch
moves with it.

## Canvas and performance (`MindMapCanvas.tsx`)

- **Gestures:** `PanResponder` handles one-finger pan and two-finger pinch around the pinch point. Taps go to nodes; tapping the background clears the selection.
- **Camera:** an `Animated` transform (`transformOrigin: top left`). Panning and zooming never re-render cards. Zoom, fit and centre animate.
- **Culling:** after each gesture, only cards and connectors within about one screen of the viewport are rendered.
- **Level of detail:** below 45% zoom, cards render as plain coloured blocks.
- **Layout cost:** computed only when the data, style or focus changes. Tested: 1,200 nodes in under 1.5 s per style on the JVM test runner (much less on device).
- **Saved view:** zoom and pan are saved per project and restored when the map reopens. Detail sheets open over the canvas, so closing them keeps the position.

## Backup (`services/fullBackup.ts`, `fullBackup.service.ts`)

Backup & restore (Manage Life header) now offers a full backup next to the
existing Excel export:

```
ManageLife_Backup_YYYY-MM-DD.zip
├── manifest.json        format "akshar-manage-life-backup", schemaVersion 1, appVersion,
│                        exportedAt, modules, includesAttachments,
│                        attachments [{uri, path}], files [{path, size, sha256}]
├── manage-life/         projects.json · tasks.json · reports.json · reviews.json · settings.json
├── long-term-planner/   projects.json · nodes.json · statuses.json · categories.json ·
│                        milestones.json · notes.json · settings.json
└── attachments/         <n>-<name> (optional)
```

- **Planner-only export:** one JSON file, `LongTermPlanner_YYYY-MM-DD.json`, format `akshar-long-term-planner`.
- **Export:** written through the system "Save to" screen. IDs, `parentId` links and ISO dates are kept exactly.
- **Restore, step 1 (read):** the native reader rejects absolute paths, `..`, backslashes, drive letters, unknown top-level folders, duplicate entries, more than 5,000 entries or 512 MB, and JSON parts over 32 MB. Staged files must stay inside the staging folder.
- **Restore, step 2 (check):** JS checks the format, the schema version and every checksum, parses each JSON file and runs the stores' validation. The preview shows counts, duplicates and repairs.
- **Restore, step 3 (apply):** attachments move into app storage and their locations are rewritten. Manage Life is restored, then the planner; if the planner step fails, Manage Life is rolled back. Merge adds new ids and replaces existing ones only when the backup copy is newer; Replace asks for confirmation. Cancelling deletes the staged files.

## Reminders

A node can carry a reminder (day + HH:MM). Planner reminders share Follow Up's
alarm scheduler but use their own key group (`plan:`), notification channel and
lock-screen text. Each sync only replaces its own group, so neither feature
cancels the other's alarms. Tapping one opens the plan focused on the node.

## Known limitations

- Pan and pinch are implemented with `PanResponder`, not a native gesture library. They work well, but they don't do momentum ("fling") scrolling.
- Connector curves are drawn as short straight segments (no SVG). They look smooth at normal zoom, but the angles show when zoomed in close.
- Node dates have no time of day; only reminders have a time.
- Undo/redo covers node edits on the map, kept in memory per project (50 steps), and is cleared on restore or app restart. Project-level changes (name, dates) aren't undoable.
- The timeline uses one row per visible node, so very large expanded plans make tall timelines. Collapse branches or use focus mode.
- Rendering speed with 500–1,000+ visible nodes has only been tested for layout time. Check it on your device.
