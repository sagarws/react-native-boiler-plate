# TrackVid-CMS → Veylix look: UI-only Migration Plan

> **Source app:** `/Users/apple/Documents/Sagar/Trackvid/TrackVid-CMS` (read only). Copied from branch
> `feat/nykaa-ddr-bulk-claim` @ `65341f9` (working tree was clean on 2026-11-17).
> **UI template (look only):** `/Users/apple/Documents/Sagar/Other/veylix-next` (read only)
> **This folder:** `/Users/apple/Documents/Sagar/Other/react-native-boiler-plate/CMS`
> **Progress:** `PROGRESS.txt` · **Rules:** `CLAUDE.md`
> **Written:** 2026-11-17

---

## 0. Goal and the one rule

Make the TrackVid CMS desktop app **look like the Veylix template**. **Only the look changes. The technology
and the behaviour do not.**

| Stays exactly as it is | Changes |
|---|---|
| Electron 43.4.1, electron-vite, Vite 7.3.6, TypeScript 5.9.3, React 19, **MUI 7 + Emotion + Tailwind** | The theme layer (colours, font, corners, shadows, glass surfaces, component defaults) |
| `electron/main`, `electron/preload`, `shared/`, `packages/TrackVid-Automation-Core`, IPC channels, local DB, automations, API calls, socket events | Shell (sidebar, navbar, breadcrumb) and page layouts, to match the template's arrangement |
| Every screen's data, actions, validation, permissions and modals | Markup inside `electron/renderer/**` where a screen needs the template's layout (page heading, toolbar, table, cards, empty states) |
| Operator settings: light/dark/system, primary colour picker, font picker, skin | Their **defaults** (Veylix light, Veylix accent, Manrope) |

**Not allowed:** a new UI or CSS framework, importing the template's CSS files as they are (they are
plain-CSS classes for a different app), removing a feature, or changing anything outside `electron/renderer/**`
except what §6 lists.

---

## 1. Why this is feasible

The CMS already routes its whole look through **one override layer**:

```
@core/theme (vendored from Monitor)  →  deep-merged with  →  theme/vercelTheme.ts  →  operator overrides (primary, font, mode)
                                           (VuexyThemeProvider.tsx)
```

`vercelTheme.ts` (1,155 lines) sets palette, type, corners, edges and MUI component defaults for all ~70
screens. Replacing it with **`theme/veylixTheme.ts`** moves every screen at once. After that, the remaining work
is layout: the floating glass sidebar, the glass top bar, the template's page heading and table toolbar, and
the screens that hold their own hard-coded look.

Measured on 2026-11-17: 397 renderer files (~53k lines), 10 screens, 45 modals/dialogs, 15 shared `components/ui`
primitives, vendored trees `@core`, `@menu`, `@layouts`, `configs`.

---

## 2. The Veylix look, translated to MUI + Tailwind

Take the values from the template CSS (`veylix-next/src/styles/base/foundation.css`, `layout/shell-sidebar.css`,
`layout/topbar.css`, `components/commerce-ui.css`, `components/dialogs-search-toast.css`,
`base/document.css`). **Read the files; do not guess values.** First step of Phase 1 writes them into
`docs/veylix-tokens.md`.

| Template trait | Where it lives in the CMS |
|---|---|
| Warm cream page background with soft gradient | `palette.background.default` + `body` background in `styles/app.css` (through a CSS variable set by the theme) |
| Glass cards: `linear-gradient(135deg, #fffdf9ed, var(--glass-fill))`, 1px white border, `--card-radius: 16px`, soft shadow, `backdrop-filter: blur(16px)` | `MuiCard` / `MuiPaper` overrides in `veylixTheme.ts` |
| Floating glass sidebar, 30px radius, inset 16px, `--chrome-fill` gradient, `--sidebar-width: 248px` | `@layouts` vertical nav styles via the theme layer + `layout/navbarStyles.ts` (not by editing `@layouts`) |
| Glass top bar (`header-primary` / `header-tools` pills, `--topbar-height: 64px`) | `layout/AppShell.tsx` navbar slot + `navbarStyles.ts` |
| Manrope variable font | Vendor `manrope-latin-wght-normal-*.woff2` into `electron/renderer/assets/fonts/` (copy from the template's `public/assets`; no npm dependency), declare it in `styles/fonts.css`, add `manrope` to the font picker and make it the default |
| Text `#25251f`, secondary `#696b61`, gold-brown accent (hover `#805b12`) | `palette.text.*`, `mainColorChannels` (warm neutral), new first entry in `configs/primaryColorConfig.ts` |
| Page heading: breadcrumb "Workspace › Page", big title ending with an accent "." | `layout/PageBreadcrumb.tsx` + a shared `PageHeading` component |
| Status pills `c-status green / amber / red / blue` | `MuiChip` variants + `components/ui/Badge.tsx` |
| Table: toolbar (search, status filter, toggle), rounded scroll region, sticky header, pagination footer "1–8 of 40 records · Per page · Previous 1/5 Next" | `styles/table-chrome.css`, MUI `Table*` overrides, a shared `TableToolbar` + `TablePaginationBar` |
| Dialogs: rounded glass dialog, header with title + round close button | `MuiDialog` overrides + `components/ui/Modal.tsx` |
| Toast: dark pill with check icon, bottom | `react-toastify` theme in `components/feedback/ToastProvider.tsx` |
| Buttons: `primary-button` (filled accent, pill radius), `secondary-button` (white glass, hairline) | `MuiButton` overrides + `components/ui/Button.tsx` |
| Icon tiles (rounded square tinted tiles) on cards | `components/card-statistics/HorizontalWithAvatar.tsx` |
| Dark mode | The template has none. Derive a warm dark palette from the light tokens (dark espresso surfaces, cream text, same accent) so the existing light/dark/system setting keeps working |

Icons stay **Tabler** (`<i className='tabler-…' />`). Tabler and the template's Phosphor icons are both outline
sets; switching icon systems is a technology change and is out of scope.

---

## 3. Invariants that must survive (from the CMS's own rules)

1. **The theme layer must not define `palette.primary`.** The Veylix accent goes in as the **first entry of
   `primaryColorConfig`** so Settings → Theme keeps working. The test that pins this
   (`tests/*Theme*.test.ts`) is renamed to `veylixTheme`, and it keeps the same assertions.
2. **`mainColorChannels` stay neutral.** Veylix's are warm neutrals, not a hue.
3. **No raw colour in a component.** Every colour comes from the theme. `npm run verify:tokens` must pass.
4. **Vendored trees (`@core`, `@menu`, `@layouts`, `configs`) are not edited**, except the one documented
   `primaryColorConfig` entry. If a look cannot be reached through the theme layer, use the CMS's own escape
   hatches in this order: theme layer → `layout/*` (the app's own shell wrapper) → component. Log every escape in
   `PROGRESS.txt`.
5. **The renderer never reaches Node or Electron.** UI work never adds an IPC channel or changes one.
6. **No new dependency** unless a step cannot be done without one, and then only after the check in the CMS
   `CLAUDE.md` (maintenance, Node + Electron compatibility, Windows/macOS, x64 + ARM64, licence, CVEs) is written
   into `PROGRESS.txt`. The plan needs none.
7. **No pinned version changes.**

---

## 4. Work units and order

The counter in `PROGRESS.txt` counts **56 units**: 1 shell, 10 screens and 45 modals/dialogs.

### Phase 0: copy and baseline (not counted)
- **C1. Copy the app into this folder.** Copy from the source working tree, leaving out `node_modules`, `out`,
  `release`, `graphify-out`, `.env`, `*.tsbuildinfo`, `.DS_Store` and `.git`. **Keep** `packages/` but delete the
  copied `packages/TrackVid-Automation-Core/.git` file, because it points into the source repo's `.git/modules`.
  Do **not** overwrite this folder's `CLAUDE.md`, `MIGRATION_PLAN.md` or `PROGRESS.txt`: save the source
  `CLAUDE.md` as `CLAUDE.TRACKVID.md` (this `CLAUDE.md` imports it).
  ```bash
  rsync -a --exclude node_modules --exclude out --exclude release --exclude graphify-out \
    --exclude .env --exclude '*.tsbuildinfo' --exclude .DS_Store --exclude .git \
    --exclude /CLAUDE.md \
    /Users/apple/Documents/Sagar/Trackvid/TrackVid-CMS/ ./
  cp /Users/apple/Documents/Sagar/Trackvid/TrackVid-CMS/CLAUDE.md ./CLAUDE.TRACKVID.md
  rm -f packages/TrackVid-Automation-Core/.git
  ```
- **C2. Install and baseline:** `npm install`, then `npm run verify`. Write the result (pass/fail counts) into
  `PROGRESS.txt` as the **baseline**. A test that already fails before any UI change is not caused by the
  migration; list it and leave it alone.
- **C3. Screenshots of the current look:** `npm run dev` (UI preview: `electron/renderer/preview/PreviewRoot.tsx`)
  for later side-by-side comparison. No login against any backend (see §5).

### Phase 1: foundation (not counted, but required before any unit)
- **F1. Tokens:** read the template CSS and write `docs/veylix-tokens.md` (every colour, radius, shadow, blur,
  spacing, font size and weight, with the source file and selector).
- **F2. `theme/veylixTheme.ts`:** same shape and position as `vercelTheme.ts`. Wire it in `VuexyThemeProvider.tsx`
  in place of `vercelTheme`. Keep `vercelTheme.ts` in the tree until Z1, so switching back is one line.
- **F3. Accent and font:** Veylix accent as the first `primaryColorConfig` entry. Manrope vendored and the default
  font (Geist, Public Sans and Inter stay selectable).
- **F4. Dark mode:** warm dark palette in the same layer.
- **F5. Shared primitives restyled:** `components/ui/*` (Badge, Button, Card, Checkbox, ConfirmDialog,
  DateRangePicker, FilterTab, FormField, Input, Modal, PlatformLogo, Select, Switch, Tooltip, TruncatedText),
  `components/data/StateBlocks.tsx` (loading / empty / error in template style), `card-statistics`,
  `feedback/ToastProvider`, `feedback/NotificationBell`, `user/UserMenu`, `session/StaleSessionBanner`,
  `update/*`. Add `PageHeading`, `TableToolbar` and `TablePaginationBar` if the template pattern needs them.
- **F6. Tests:** rename and adapt the theme test (§3.1, §3.2). Run `npm run verify`.

### Phase 2: units (counted)
1. **Shell:** `layout/AppShell.tsx`, `Brand.tsx`, `Navigation.tsx`, `VerticalMenuContent.tsx`, `PageBreadcrumb.tsx`,
   `navbarStyles.ts`, `components/layout/*` (cron panels, sync button, session board), `BackgroundWork.tsx`,
   `CloseGuardDialog`, `DevModeModal`.
2. **Screens (10), in this order:** Login → Dashboard → Manage Claims → Create claim → Background Process (Jobs)
   → Login sessions → Local Database → Email Reply → Settings → User detail.
3. **Modals (45):** each with its screen (list in `PROGRESS.txt`).

### Phase 3: finish (not counted)
- **Z1.** Remove `vercelTheme.ts`, update `CLAUDE.TRACKVID.md` §UI/UX to say Veylix is the reference.
- **Z2.** Light + dark, 1280×800 and 1920×1080 window sizes, collapsed and expanded sidebar, keyboard focus.
- **Z3.** `npm run verify` + `npm run test:e2e` + `npm run build:unpack` (unsigned local package) pass.
- **Z4.** Final report at the bottom of `PROGRESS.txt`.

---

## 5. Running the app safely

This is a **real automation app**. Run it only to look at the UI.
- **Never copy or create `.env` with real values.** `.env.example` only. Without a backend URL, the app stops at
  the login screen. That is enough for Login; the other screens are checked in the UI preview (`preview/`) and
  by `npm run test:e2e`, which boots in an isolated `userData` dir.
- **Never log in, never run an automation, a backup, a claim, an email reply or a session capture.**
  Any of them reaches real marketplace accounts and TrackVid-BE.
- Never point anything at `api.trackvid.in`.
- If a screen can only be seen with live data, extend `preview/UiPreview.tsx` with static sample props for that
  screen's presentational parts (preview code only; nothing in the app's data path changes).

---

## 6. Definition of migrated (per unit)

- Looks like the template: surfaces, corners, edges, heading, toolbar, table, pills, dialog and empty states follow
  `docs/veylix-tokens.md`.
- Same behaviour: no change to props passed to logic, IPC calls, store reads/writes, validation or text the
  operator relies on (button labels may only change case if the template does).
- Light **and** dark both checked.
- `npm run verify` passes (typecheck ×2, lint, tokens, unit tests), or fails only on baseline failures from C2.
- `PROGRESS.txt` counter and status updated **before** the next unit starts.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| `backdrop-filter` blur is costly on low-end Windows machines with many rows | Glass only on shell, cards and dialogs, never per table row; check scroll performance on a 500-row table |
| Vendored `@layouts` / `@menu` CSS fights the floating sidebar | Override through the theme layer and `layout/navbarStyles.ts`; never edit the vendored tree |
| Hard-coded colours left in screens | `verify:tokens` + grep for hex in `pages/**` per unit |
| Operator settings (primary colour, font, skin, mode) stop working | Theme test (§3) + manual check of Settings → Theme in Z2 |
| Copy is behind the source repo | Source commit is recorded at the top; at the end, list source commits newer than `65341f9` in the final report |
| A step needs live data | Use the preview with static props (§5). Never log in |

---

## 8. Autonomous run

- Decide; do not ask. Log every decision in `PROGRESS.txt` → DECISIONS.
- A unit that fails 3 times → `BLOCKED: <reason>`, move to the next.
- **No git commands that change anything** in the parent repo (`react-native-boiler-plate`): another agent works
  on `../BE` in the same checkout. The final report says that `CMS/` is uncommitted.
- Never edit `../BE`, `../FE`, `../.env`, `../prompt.txt`, the TrackVid repos or `veylix-next`.
- Stop only when every unit is `MIGRATED` or `BLOCKED` and the final report is written.

### Commands

```bash
cd /Users/apple/Documents/Sagar/Other/react-native-boiler-plate/CMS
npm install
npm run dev            # Electron app (stops at login without a backend)
npm run verify         # typecheck ×2 + lint + tokens + unit tests
npm run test:e2e       # boots the built app in an isolated userData dir
npm run build:unpack   # local unsigned package (Z3 only)
grep -E "^MIGRATED" PROGRESS.txt
```
