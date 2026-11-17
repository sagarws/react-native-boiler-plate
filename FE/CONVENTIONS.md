# TrackVid UI — conventions for route work

Read `CLAUDE.md` first (hard rules). This file says *how* to build a route on the foundation that exists.

## Folders you own (per domain)
- `src/features/<domain>/**` — page component(s), sub-components, dialogs, hooks.
- `src/services/<domain>-service.ts` — mock of TrackVid-FE `src/api/<x>-service.ts`: **same exported object
  name and function names** (e.g. `export const CmsService = { getCms, updateCms, … }`), async, returns the
  response body type (`Promise<T>`), never axios. Keep state in module-level variables so edits persist
  for the page session. Use `delay()`, `clone()`, `newId()`, `paginate()`, `daysAgo()`, `seeded()` from `@/mocks/delay`.
  Throw `new Error("message")` for failures (validation, not found).
- `src/mocks/<domain>.ts` — typed sample data (realistic Indian e-commerce: Ajio, Myntra, Flipkart, Amazon,
  Meesho, Snapdeal, Nykaa, Tata CliQ, Delhivery, Xbees; AWB numbers, order IDs, ₹ amounts).
- `src/types/<domain>.ts` — types copied from TrackVid-FE (`helper/types/types.ts`, slices, components). Same field names.
- `src/styles/trackvid/<domain>.css` — already created and imported. Only `var(--tv-*)` tokens and template
  colours; no new UI kit. Prefix classes `tv-<domain>-…`.
- `src/app/(dashboard)/<route>/page.tsx` — already exists with a `ComingSoon` placeholder; replace its body.

**Do not edit** shared files (`src/components/**`, `src/lib/**`, `src/store/**`, `src/config/**`, `src/styles/index.css`,
`src/styles/trackvid/components.css|tokens.css`, other domains' files, `PROGRESS.txt`). If you need a change there,
put a small local helper in your feature folder instead and mention it in your report.
Exception: you may add **new** functions to `src/services/user-service.ts` only if your brief says so.

## Route file pattern
```tsx
// src/app/(dashboard)/vms/page.tsx  (server component: metadata only)
import type { Metadata } from "next";
import { VmsPage } from "@/features/vms/vms-page";
export const metadata: Metadata = { title: "VMS" };            // renders "VMS | TrackVid"
export default function Page() { return <VmsPage />; }
```
Feature components start with `"use client"`. Dynamic params: `useParams()` from `next/navigation`.
Query strings: `useSearchParams()` — wrap the component that calls it in `<Suspense>` inside page.tsx.
`useRouter().push/replace`, `usePathname()` from `next/navigation`; links with `next/link`.
Next 16 docs: `node_modules/next/dist/docs/`.

## Page layout (template look)
```tsx
<div className="tv-page">
  <PageHeading title="VMS" subtitle="…" actions={<button className="primary-button">…</button>} />
  <SummaryList items={[["Videos", "1,240", "this month"]]} />          // optional KPI tiles
  <section className="glass-card tv-table-card">
    <div className="c-toolbar"><SearchInput … /><FilterSelect … /><DateRangePicker … /></div>
    <BulkSelectionBar count={selected.size} onClear={…}>…actions…</BulkSelectionBar>
    <DataTable … />
  </section>
</div>
```
Cards: `glass-card`; card titles: `<CardHeading title=… extra=… />`. Grids: `tv-grid-2|3|4`, `tv-stack`, `tv-row`,
`tv-row-between`. Buttons: `primary-button`, `secondary-button`, `danger-button`, `icon-button`, add `compact-button`
for small. Status chips: `<StatusPill value="Approved" />` (auto tone) or `tone="red"`. Badges: `<ToneBadge>`.
Forms: `<form className="c-form-grid">` with `TextField`, `PasswordField`, `SelectField`, `TextareaField`
(`full` spans both columns), `PhoneField`, `Combobox`, `MultiCombobox`, `Switch`, `ToggleRow`, checkbox
`<label className="tv-check"><input type="checkbox"/>…</label>`. Key/value: `<dl className="tv-kv">`.

## Shared building blocks (import paths)
| Need | Import |
|---|---|
| Icons | `Icon` from `@/components/icons/icon` (names: see `filled-icon-paths.ts` + `stroke-icon-paths.ts`) |
| Dialog | `AppDialog` (`size: sm/md/wide/xl`, `footer`, `locked`), `ConfirmDialog` — `@/components/ui/app-dialog`, `confirm-dialog` |
| Table | `DataTable`, `BulkSelectionBar`, type `DataColumn` — `@/components/ui/data-table` (server paging: `pagination="server" total page pageSize onPageChange onPageSizeChange`; sort: `sort onSortChange`; select: `selected onSelectedChange isRowSelectable`; `loading error onRetry`) |
| Fields | `TextField PasswordField SelectField TextareaField SearchInput FilterSelect FieldShell` — `@/components/ui/form-field` |
| Others | `Tabs` (`tabs`), `DateRangePicker`/`defaultDatePresets`/`formatRange` (`date-range-picker`), `Switch`/`ToggleRow` (`switch`), `Combobox`/`MultiCombobox` (`combobox`), `Skeleton`/`SkeletonCard` (`skeleton`), `Banner` (`banner`), `PhoneField` (`phone-field`), `OtpInput` (`otp-input`), `Stepper` (`stepper`), `LoadingState`/`EmptyState`/`ErrorState`/`Spinner` (`states`), `PageHeading` (`page-heading`), `StatusPill` (`status-pill`), `CardHeading`/`ToneBadge`/`IconTile`/`ProgressBar`/`MetricCard` (`card-primitives`), `SummaryList` (`summary-list`), `RowActionsMenu` (`row-actions-menu`), `TablePagination` (`table-pagination`), `PlatformLogo`/`platformLogoUrl` (`platform-logo`), `VideoPlayer` (`video-player`), `Carousel` (`carousel`), `FileDrop` (`file-drop`), `Avatar` (`avatar`), `useDismiss` (`use-dismiss`) — all under `@/components/ui/` |
| Rich text | `RichTextEditor` from `@/components/editor/rich-text-editor` (`value` HTML, `onChange`, `copyTrigger`, `readOnly`) |
| Charts | `ChartCanvas` from `@/components/charts/chart-canvas` (`config: ChartConfiguration`, `label`, `height`), `chartPalette()` from `chart-setup` |
| Data loading | `useAsync(() => Service.fn(args), [args])` → `{ data, loading, error, reload, setData }` from `@/lib/use-async` |
| Toast | `toast.success("…")`, `toast.error("…")` from `@/lib/events`; `errorMessage(err)` |
| Format | `formatCurrency formatNumber formatCompact formatDate formatDateTime formatRelative formatBytes formatDuration` — `@/lib/format` |
| Files | `downloadBlob downloadText toCsv copyText` — `@/lib/download` |
| HTML | `sanitizeHtml(html)` from `@/lib/sanitize` before any `dangerouslySetInnerHTML` (only for untrusted HTML that must render) |
| Permissions | `hasPermission(user, "cms::edit")`, `canAccess(user, roles, perms)` — `@/lib/permissions`; current user: `useSelector((s) => s.profile.userProfile)` from `@/store` (never null inside the dashboard shell, but type-guard it) |
| Constants | TrackVid `helper/constant.ts` = `@/config/constant`; TrackVid `config/constant.ts` = `@/config/app-constant`; routes = `@/config/route` |
| Store | `useDispatch`, `useSelector` from `@/store`; CMS script progress actions in `@/store/script-progress-slice`, OTP in `@/store/otp-prompt-slice`, profile `setUserProfile` in `@/store/profile-slice` |

## Lint / type rules that bite (the build runs React Compiler lint rules)
- `npm run lint` has `--max-warnings 0`. No `any`, no `@ts-ignore`, no `@ts-nocheck`.
- **Never call `setState` synchronously inside `useEffect`** (`react-hooks/set-state-in-effect`). Instead:
  - derive values during render; or
  - reset state when a prop changes with the "adjust during render" pattern:
    `const [prev, setPrev] = useState(x); if (prev !== x) { setPrev(x); setFoo(initial); }`; or
  - set state in event handlers / promise callbacks / timer callbacks (those are fine); or use `useAsync`.
- Don't read/write `ref.current` during render. Don't mutate props/state. Avoid `useMemo`/`useCallback` whose
  deps the compiler can't preserve — plain computation is usually fine.
- Every `addEventListener`, `setInterval`, `setTimeout`, `URL.createObjectURL`, `AbortController`, subscription →
  cleanup in the effect return (or revoke right after use).
- No `catch {}` without a comment saying why. Unused vars/imports fail lint.
- `<img>` is allowed (rule off). Use `alt`.

## Behaviour to keep from TrackVid
For each screen, read the TrackVid page and **all** its child components/modals. Rebuild every tab, sub-view,
dialog, filter, bulk action, row action, empty / loading / error state and permission check (`*::edit` hides or
disables edit buttons). Keep the same labels, validations (port the yup schemas from `src/validations` as plain
TS validation or yup — `yup` and `formik` are installed), and toasts. Live updates (sockets/SSE) are simulated
with timers in the service (always cleared). Anything that uploads/downloads works locally (object URLs, sample
files in `public/assets/sheets`, `public/assets/...`). Videos: use public sample MP4 URLs such as
`https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4` in mocks (the player shows a
fallback if offline).

## Verify (do NOT run `npm run build` — the coordinator runs it; parallel builds collide)
```bash
cd /Users/apple/Documents/Sagar/Other/react-native-boiler-plate/FE
npx tsc --noEmit --incremental false -p . 2>&1 | grep -E "src/(features/<domain>|services/<file>|mocks/<file>|types/<file>|app/.*<route>)" 
npx eslint --max-warnings 0 src/features/<domain> src/services/<file>.ts src/mocks/<file>.ts src/types/<file>.ts "src/app/(dashboard)/<route>"
```
Other agents work in parallel: ignore errors in files you do not own. Your files must be clean.
No git commands. Do not touch `../BE`, `../.env`, the TrackVid repos or veylix-next (read only).

## Report back (final message)
1. Routes done and the files you created.
2. Every TrackVid sub-view / tab / dialog you rebuilt (checklist), and anything you could not match + why.
3. Any change you needed in a shared file (you did not make it) — exact suggestion.
4. Output of the tsc grep and eslint commands (must be clean).
