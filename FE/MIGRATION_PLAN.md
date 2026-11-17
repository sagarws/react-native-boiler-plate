# TrackVid-FE → Veylix-template UI Migration Plan

> **Source app (logic + screens):** `/Users/apple/Documents/Sagar/Trackvid/TrackVid-FE` (Vite + React 18 + MUI 5 + Redux Toolkit)
> **UI template:** `/Users/apple/Documents/Sagar/Other/veylix-next` (Next.js 16 App Router + React 19, hand-written CSS, Chart.js, no UI library)
> **This folder:** `/Users/apple/Documents/Sagar/Other/react-native-boiler-plate/FE` (the new frontend)
> **Written:** 2026-11-17

---

> **Mode (decided 2026-11-17 by the user): UI only, not connected to any backend, kept separate from `BE/`.**
> See §12. Where earlier sections say "wire the same services", read: "call the mock service with the same
> function name and the same TypeScript response type". Wiring the real API is a later, separate project.

## 0. Goal and the one rule

Rebuild every TrackVid-FE screen using the **Veylix look**: Veylix's shell, CSS tokens, tables, dialogs,
forms, status pills, cards and charts. **Only the UI changes.** Behaviour stays the same:

- Same API calls, request/response shapes, auth header, 401 redirect, SSE and socket events.
- Same URLs (`/cms`, `/vms`, `/auth/reset-password`, `/auth/invitation`, `/oauth/zoho/callback`, …).
  BE emails and the Zoho OAuth app already contain these links, so they must keep working.
- Same permissions and role gating, form validation rules, and loading, empty and error states.

**Never change** a service call, a slice, or a validation schema to make the new UI easier to build.
If a screen needs different data, it goes through the TrackVid-BE contract rules (additive only, BE ships first).

---

## 1. Is it possible? Yes, with three caveats

Measured on 2026-11-17:

| Item | TrackVid-FE | Veylix template |
|---|---|---|
| Screens | 39 page files (~25k lines), 35 routes | 99 routes, 343 files (~78k lines incl. CSS) |
| UI layer | MUI in **169 files**, `x-data-grid` in 23 files | Plain CSS (`src/styles/**`), 11 UI primitives in `components/ui` |
| Logic layer | 39 `api/*-service.ts`, 19 Redux slices, formik/yup | `localStorage` mock store, no backend |
| Theming | Light / dark / system switch | Light only (21 CSS custom properties, no dark rules) |
| Auth screens | Login, register, sub-user register, forgot, reset, invitation | **None** |

**Caveat 1: the template code is not production-typed.** 297 of its 343 files start with `// @ts-nocheck`
(they were converted from a minified bundle). **Take the template's CSS, class names, DOM structure and
patterns, but do not copy its feature pages as they are.** Write each TrackVid component fresh in strict
TypeScript, using the template's markup and class names so the template CSS applies unchanged.

**Caveat 2: there is no MUI and no DataGrid.** Every MUI usage (169 files) is rewritten, not swapped.
DataGrid features TrackVid relies on (column resize via `useColumnResize`, row selection, server
pagination, sorting) have to be rebuilt on the template's `resource-table` / `products-table` pattern.
That is the largest single piece of work.

**Caveat 3: the template has no dark mode and no auth pages.** Both can be built in Veylix style (see §6),
but they are design decisions, not copies.

---

## 2. Stack decision

**Decided (2026-11-17, by the user): Next.js 16 App Router, same as the template, with a client-rendered dashboard.**

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict | Matches the template, so its CSS and shell drop in. Read `node_modules/next/dist/docs/` first: the template's AGENTS.md warns that this Next version has breaking changes |
| Rendering | Route files are server components. The dashboard shell and all pages are `"use client"`, loaded the way the template does it (`dashboard-shell.tsx` with `ssr: false`) | TrackVid reads the token from localStorage, opens SSE and sockets, and every screen is behind login. SSR gives nothing here and causes hydration problems |
| Routing | `next/link`, `next/navigation`. Same URL paths as TrackVid | Links in BE emails must not break |
| State | **Keep** Redux Toolkit + react-redux + redux-persist (wrap in a client `<StoreProvider>`) | The 19 slices are logic; they move unchanged |
| HTTP | **Keep** both axios instances (`axios.ts`, `masterAxios.ts`) and all 39 service files | Logic, moved unchanged |
| Forms | **Keep** formik + yup and all `src/validations` | Logic. Only the input components change (template `form-field.tsx`) |
| Charts | Chart.js 4 (already in both). Use the template's `chart-frame` + `chart-setup` + HTML tooltip. Drop `react-chartjs-2` and `@mui/x-charts` | One chart system, the template's look |
| Dates | Keep `date-fns`. Replace `react-date-range` with a template-styled range picker (see §6) | No second date library |
| Env | `VITE_APP_*` → `NEXT_PUBLIC_*` (same names otherwise) | Next only exposes `NEXT_PUBLIC_*` to the browser |
| Toasts | Template toast host (`veylix:toast` event) behind a `toast()` helper with the same signature as `react-hot-toast` calls | Lets you swap call sites with a find-and-replace |

**Removed dependencies:** `@mui/*`, `@emotion/*`, `@mui/x-data-grid(-pro)`, `@mui/x-charts`, `@mui/lab`,
`mui-tel-input`, `react-chartjs-2`, `react-date-range`, `react-helmet` (use Next `metadata`),
`react-hot-toast`, `react-image-gallery`, `@popperjs/core`, `react-quill`.

**Kept (they are behaviour, not look; style their output with template CSS):** `axios`, `@reduxjs/toolkit`,
`react-redux`, `redux-persist`, `formik`, `yup`, `date-fns`, `chart.js`, `chartjs-plugin-datalabels`,
`socket.io-client`, `crypto-js`, `lodash`, `millify`, `numbro`, `file-saver`, `jszip`, `jspdf`,
`browser-image-compression`, `qrcode.react`, `razorpay`, `react-player`, `screenfull`, `react-webcam`.

**Added:** Tiptap (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` + extensions) replaces `react-quill` (§6.1).
Check `react-player`, `react-webcam` and `qrcode.react` on React 19 in step 1; replace any that fail.

**Next.js-specific work when moving the logic over:**
- `react-router-dom` → `next/navigation`: `useNavigate()` → `useRouter().push()`, `useLocation().pathname` → `usePathname()`, `useParams()` / `useSearchParams()` from `next/navigation`, `<Navigate>` → `redirect()` or `router.replace()`.
- Every component that uses hooks, Redux, `localStorage`, `window`, SSE or sockets starts with `"use client"`.
- `LocalStorageService` and anything else that reads `window` must not run at module load (it breaks the server build). Read it inside effects or client-only code.
- The axios 401 redirect uses `window.location` (works as it is) or a router bridge like the template's `lib/navigation.ts`.
- Page titles move from `react-helmet` to `export const metadata` in each route's `page.tsx` (format: `<Page> | TrackVid`).

---

## 3. What to take from the template, and what to leave

| Take as-is (then type it) | Take as a pattern (rewrite for TrackVid) | Leave out |
|---|---|---|
| `src/styles/**` (all CSS, keep the order in `styles/index.css`) | `components/layout/*`: sidebar, topbar, profile menu, notifications menu, global search, overlay and toast hosts | `lib/store/*` (localStorage mock store) |
| Manrope font + `next/font/local` setup in `app/layout.tsx` | `features/resources/*`: config-driven table + toolbar + record dialog | `data/*`, `config/modules/*` seed data |
| `components/icons/*` (SVG icon set) | `features/orders/*`: list + detail dialog + status pills + bulk bar → CMS / RMS | Commerce-only pages (marketplace, online store, AI studio, checkout, …) |
| `components/ui/*` (dialog, form-field, pagination, status-pill, summary-list, card primitives, bulk selection bar, row actions menu, avatar) | `features/overview/*` cards → TrackVid dashboard | `i18n/*` (TrackVid is English only; keep the folder only if you want RTL later) |
| `components/charts/*` | `features/communication/chat-page` → Support chat | `lib/ai-client.ts`, `media-storage.ts` (IndexedDB mock) |
| | `features/access/permissions-page`, roles/users resource modules → Manage roles / users | |
| | `features/settings`, `features/profile`, `features/integrations`, `features/media` | |

---

## 4. Target structure (`FE/`)

```
src/
  app/
    layout.tsx                       html, Manrope, global CSS, #overlay-root, #toast-region
    (auth)/auth/login|register|subuser-register|forgot-password|reset-password|invitation/page.tsx
    (auth)/layout.tsx                centred auth card layout (new, Veylix style)
    (dashboard)/layout.tsx           sidebar + topbar + hosts, auth guard, StoreProvider, socket/SSE bootstrap
    (dashboard)/page.tsx             Dashboard ("/")
    (dashboard)/vms|cms|cms/create|cms/update|rms|manage-users|manage-roles|favorite|account-summary|
                profile|feed|emails|mailboxes/[mailboxId]/logs|master-data|sku|imports|integrations|
                pending-failed-orders|refer-and-earn|support|whats-new|system-admin|settings|video-link/page.tsx
    impersonate/[userId]/page.tsx
    oauth/zoho/callback/page.tsx
    not-found.tsx
  api/          ← copied from TrackVid-FE src/api (unchanged)
  slices/       ← copied (unchanged)
  validations/  ← copied (unchanged)
  helper/ utils/ types/ middleware/  ← copied; anything that imports MUI gets split (logic stays, UI moves to components)
  config/       axios.ts, masterAxios.ts, route.ts, constant.ts, store.ts (copied) + navigation.ts (new sidebar config)
  components/
    layout/     from template, typed
    ui/         template primitives + new ones from §6 (data-table, tabs, date-range, switch, skeleton, …)
    charts/     template chart-frame, line/bar/donut wrappers
    icons/      template icon set + TrackVid platform logos (Amazon, Flipkart, Meesho, Myntra, Ajio, …)
  features/<domain>/   cms, rms, vms, dashboard, accounts, master-data, email, support, integrations, settings, users-roles, feed, …
  styles/       template CSS (unchanged order) + styles/trackvid/*.css for new components + dark.css
```

**Rule:** a file in `api/`, `slices/`, `validations/` that differs from TrackVid-FE needs a reason in `PROGRESS.md`.

---

## 5. Screen mapping

**Fit:** **A** = template has the same kind of screen; restyle it. **B** = build it from template primitives (no new reference needed).
**C** = needs a component the template does not have at all (see §6).

| TrackVid route | Page (lines) | Template pattern to use | Fit | Notes |
|---|---|---|---|---|
| `/` Dashboard | DashboardMaster 889, DashboardInsightsRow 300, Dashboard/* | Overview page: metric cards, chart cards, top-regions table, period menu | A | Date range filter → template period menu + custom range (§6) |
| `/cms` | CMS 3989 + 12 modals | Orders page: table, filters, bulk bar, detail dialog, status pills, row actions | A + C | Rich text (claim notes), video and screenshot modals, OTP prompt, script progress modal |
| `/cms/create`, `/cms/update` | CreateCms 1296 + `Cms/create/*` | Product editor (two-column form + media workspace) | C | Webcam recorder, image capture, video list, rearrange. Biggest bespoke screen |
| `/rms` | RMS 2419 | Returns / order operations page | A | Tabs, socket updates |
| `/vms` | VMS 1409 | Media library (grid + detail dialog) | C | Video player with custom controls |
| `/favorite` (+ trash) | Favorite 884 | Media library grid | A + C | Video player |
| `/feed` | Feed 506 | Resource table + record dialog | B | Live feed preview if any |
| `/video-link` | VideoLink 175 | Resource table | B | |
| `/rtsp-url` (component) | RtspUrl/AddLinkForm | Resource record dialog | B | |
| `/manage-users` | ManageUser 515 + InviteUserModal | Team members (resource module) | A | |
| `/manage-roles` | ManageRole 219 + AddEditRoleModal, UserPermissions | Roles + Permission matrix | A | |
| `/account-summary` | AccountSummary + `Accounts/*` (10 files) | Transactions, settlements, summary cards, tabs | A + B | Plans / credit plans cards (pricing grid), Razorpay, TDS tabs, payment steps with QR |
| `/profile` | Profile 924 | Profile page | A | Phone input with country code (§6), company logo uploader |
| `/settings` | Settings 182 + `settings/*` (10 files) | Settings page (sectioned form, toggle rows) | A + C | Rich text in IntegrationsSettings, calculator, drag-drop area, WhatsApp tabs |
| `/integrations` | Integrations 871 + `Integrations/*` | Integrations page + provider connection dialog | A | Google Drive dialog, session details |
| `/emails` | Emails + `email/*` (EmailInbox, Zoho connect, manual fix) | Email workspace | A | HTML email body rendering, see §8 security |
| `/mailboxes/:id/logs` | MailboxLogsPage 731 | Resource table + activity list | A | |
| `/support` | SupportChat 1644 | Customer inbox (chat page) + tickets | A | SSE stream |
| `/master-data` | MasterData 2266 + `container/*Master` | Resource table + tabs + import dialog | A + B | Autocomplete / combobox (§6) |
| `/sku` | SkuData 309 | Products table | A | Video player |
| `/imports` | ExternalImports 333 + `common/ExternalImports/*` | Product import dialog | A | Scan-return-parcel flow |
| `/pending-failed-orders` | PendingFailedOrders 417 | Orders table | A | |
| `/refer-and-earn` | ReferAndEarn 543 | Summary cards + table | B | Referral link copy / share block |
| `/whats-new` | WhatsNew 1756, Slider 195 | Blog posts / store pages | B + C | Carousel / slider; HTML content, see §8 |
| `/system-admin` | SystemAdmin 63 + PaymentRequests | Resource table | A | |
| `/impersonate/:userId`, `/oauth/zoho/callback` | small | Template "loading" card | B | No real UI, just a spinner + redirect |
| `/auth/*` (6 screens) | Login 254, Register 428, SubUserRegister 266, Forgot 119, Reset 169, Invitation 128 | **None in template** | B | New auth layout in Veylix style (§6) |
| Shell | `common/Layout/Layout.tsx` (sidebar, header, notifications, theme switch, banners) | Template app shell | A | Sidebar groups = TrackVid nav; Notifications = template notifications menu; banners (unverified credentials, CMS app install) = new banner primitive |
| 404 | `pages/404` | Template in-shell "Page not found" | A | |

---

## 6. UI the template does not have: can it be built in template style?

**Short answer: yes, all of it can be built from the template's tokens and primitives without another reference,
except where marked "reference recommended".** These are visual design decisions, not technical blockers.

| Missing UI | Used by | How to build | Reference needed? |
|---|---|---|---|
| **Auth pages** (login, register, forgot/reset, invitation, sub-user register) | `/auth/*` | Centred card on the template background, template `form-field`, primary button, logo from `branding`. Split layout (form + illustration) optional | **Recommended** if you want a specific brand look. Without one I'll build a plain Veylix-style card layout |
| **Dark mode + theme switch** (light / dark / system) | Layout header, ThemeSwitch | Add `[data-theme="dark"]` overrides for the 21 tokens in `styles/base/foundation.css`, then fix hard-coded colours in feature CSS file by file | **Recommended:** a dark palette or a dark screenshot of a similar dashboard. Otherwise I derive one from the light tokens (works, may need tuning). Or drop dark mode in v1 |
| **Data table with column resize, server pagination, selection, sort** (replaces MUI DataGrid in 23 files) | CMS, RMS, Master data, SKU, histories, … | Extend template `resource-table` + `table-pagination` + `bulk-selection-bar` into one typed `<DataTable>` with column resize (port `useColumnResize`) | No |
| **Video player with custom controls** (play, seek, speed, fullscreen, download) | VMS, Favorite, SKU, CMS | Keep `react-player` + `screenfull` for behaviour; restyle `ControlIcons` with template icons and tokens | No |
| **Webcam video recorder + image capture** | CMS create | Keep `react-webcam`; template dialog + buttons around it | No |
| **Image carousel / screenshot viewer** (+ export to PDF) | Screenshots/Carousel | Template dialog + simple prev/next carousel, keep `jspdf` | No |
| **Rich text editor** | CMS claim email (EditorModal), IntegrationsSettings | **Replace `react-quill` with Tiptap.** See §6.1 | No |
| **Tabs** | RMS, Master data, Account summary, WhatsApp settings, TDS | Template has workspace navs (`payment-workspace-nav`, `shipping-workspace-nav`); make a generic `<Tabs>` from them | No |
| **Date range picker** | Dashboard, Purchase / credit history, Email inbox | Template `period-menu` for presets + a small two-month calendar for custom ranges (`date-fns`) | No |
| **Stepper** (payment steps) + **QR code** | PaymentStepsDialog | Numbered step list in a template dialog; keep `qrcode.react` | No |
| **Phone input with country code** | Register, Profile, SubUserRegister | Country `<select>` + text input styled as template `form-field` | No |
| **Autocomplete / combobox** | Master data (Myntra/Meesho/Snapdeal), ViewClaimModal | Template global-search dropdown pattern → typed `<Combobox>` | No |
| **OTP input** | OtpPromptModal | Template field row of single-digit inputs | No |
| **Switch / toggle** | Settings, integrations | Template `checkout-toggle-row` → generic `<Switch>` | No |
| **Skeleton loaders** | Dashboard cards, platform insights | Shimmer blocks using template radius and surface tokens | No |
| **Alert banners** (unverified credentials, CMS app install, mailbox disconnected) | Layout, email | Template card + status-pill colours | No |
| **Plans / pricing cards** | Plans, CreditPlans, StoragePlans | Template summary cards in a grid + "current plan" pill | Optional, only if you want a marketing-style pricing table |
| **What's new slider / release-notes feed** | WhatsNew, Slider | Template blog-post cards + carousel above | Optional |
| **Platform logos** (Amazon, Flipkart, Meesho, Myntra, Ajio, Snapdeal, …) | PlatformIcon, many tables | Reuse existing TrackVid SVGs | No (assets exist) |

**What I need from you:** only the two "Recommended" rows (auth design and dark mode). Everything else
I can build from the template.

### 6.1 Rich text editor: Tiptap replaces react-quill

**Why change:** `react-quill` 2.0 does not support React 19 (it uses `findDOMNode`, which React 19 removed),
and its "snow" theme looks nothing like the template.

**Choice: Tiptap** (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` + extensions; MIT).
- It works with React 19 and Next.js (`immediatelyRender: false` avoids hydration errors).
- It has no built-in look, so the toolbar is built from template buttons, icons and popovers and matches the rest of the app.
- Fallback if the HTML check below fails: `react-quill-new` (a Quill 2 fork that supports React 19), with its toolbar restyled.

**Same features as today's toolbar** (`components/common/TextEditor/TextEditor.tsx`):

| Quill toolbar item | Tiptap extension |
|---|---|
| header 1–6 | StarterKit `Heading` |
| size small / large / huge | `TextStyle` + `FontSize` |
| bold, italic, underline, strike, blockquote | StarterKit + `Underline` |
| text colour, background colour | `Color`, `Highlight` (multicolor) |
| font | `FontFamily` |
| align | `TextAlign` |
| ordered / bullet list, indent | StarterKit lists (indent = nest / lift list item) |
| link | `Link` (allow only `http`, `https` and `mailto`) |
| clean | `unsetAllMarks()` + `clearNodes()` |
| undo / redo (100 steps) | StarterKit `History` / `UndoRedo` |
| copy as plain text (`copyTrigger`) | `editor.getText()` → clipboard |
| read-only without `cms::edit` | `editor.setEditable(hasEditPermission)` |

**Keep the same component interface:** `<RichTextEditor value onChange copyTrigger />`. It takes and returns
an **HTML string**, so EditorModal, IntegrationsSettings and the API calls stay unchanged.

**HTML check (required before switching):** the editor loads the claim email HTML that the BE builds
(`createClaimEmailHtml`) and saves it back. Quill wrote **classes** (`ql-align-center`, `ql-size-large`,
`ql-font-serif`, `ql-indent-1`); Tiptap writes **inline styles**. Inline styles are actually safer for email
clients. Steps:
1. Collect real samples from staging: a fresh BE-generated template, and templates users have edited and saved.
2. Add parse rules so Tiptap reads the `ql-*` classes into the right alignment, size, font and indent.
3. Write a test that loads each sample, saves it without changes, and compares text, links, images, alignment and colours with the original.
4. If anything is lost (for example tables or images the BE puts in the email), add that extension or use the fallback editor.

**Security:** Tiptap keeps only the nodes and marks in its schema, so `<script>`, event handlers and
`javascript:` links are dropped, the same protection `ReactQuill` gave. The comment at `CMS.tsx:903`
depends on this; move it into the new editor file.

---

## 7. Implementation plan

Track each step in `FE/PROGRESS.md` (created in step 1). Each milestone ends with something you can open
in the browser, so you see your admin panel in the new look early and approve it before the bulk work.

### Milestone 1: first preview of your admin panel in the template look
**What you see:** TrackVid's login, then the Veylix-style shell with TrackVid's own sidebar menu
(Dashboard, CMS, RMS, VMS, Master data, …) and permission rules, the top bar with your profile and
notifications, a working Dashboard with real numbers, and a read-only CMS list with real data. Screens not
built yet show a "Coming soon" card inside the shell, so you can click through the whole menu.

1. **Project setup.** `create-next-app` in `FE/` with the template's `next.config.ts`, `tsconfig.json` (strict)
   and `eslint.config.mjs`. Scripts: `dev` (port 3002), `build`, `lint` (`--max-warnings 0`), `test` (Vitest).
2. **Template base.** Copy `styles/` (keep `styles/index.css` order), the Manrope font, `components/icons`,
   `components/ui`, `components/charts`. Add types and remove `@ts-nocheck` while copying.
3. **TrackVid logic.** Copy `api/`, `slices/`, `validations/`, `helper/`, `types/`, `utils/` and
   `config/{axios,masterAxios,route,constant,store}.ts`. Change `import.meta.env.VITE_APP_*` →
   `process.env.NEXT_PUBLIC_*`. Move anything there that imports MUI or `react-hot-toast` behind a small
   adapter (`lib/toast.ts`) so the logic files stay unchanged.
4. **Env.** `.env.local` points to **staging**, never `api.trackvid.in`. Commit `.env.example` with key names only.
5. **Providers.** `app/providers.tsx` (`"use client"`): Redux `Provider` + `PersistGate`, toast host, dialog host.
6. **Shell.** `(dashboard)/layout.tsx`: template sidebar + topbar, with the menu items and permission checks
   from TrackVid's `Layout.tsx` in a typed `config/navigation.ts`. Profile menu (logout, impersonation exit),
   notifications popover over the existing SSE, CMS script-progress indicator, credential and app-install banners.
7. **Auth guard.** Port `src/middleware` route guards: no token → `/auth/login`; permission missing → 404 card.
8. **Login page** in the `(auth)` layout, using the existing `auth-service` and validation.
9. **Dashboard** (`/`): template overview cards + Chart.js charts over the existing dashboard slice.
   Date range = template period menu + custom range.
10. **`DataTable`** primitive (template table markup + sorting, server pagination, selection, column resize),
    then the **CMS list in read-only mode** on top of it.
11. **"Coming soon" placeholder** route for every other menu item.

**Check:** `npm run build && npm run lint` pass, then you review it at 1440 / 1024 / 390 px.
**Your sign-off here locks the look** before the remaining ~30 screens are built.

### Milestone 2: shared parts + simple screens
12. Remaining primitives: `Tabs`, `DateRangePicker`, `Switch`, `Combobox`, `Skeleton`, `Banner`, `PhoneField`,
    `OtpInput`, `Stepper`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `RichTextEditor` (Tiptap, §6.1, with the
    HTML round-trip test).
13. Remaining auth pages: register, sub-user register, forgot password, reset password, invitation.
14. Profile, Manage users, Manage roles + permissions, Settings, Integrations (incl. Google Drive), Refer & earn,
    Video link, Feed, RTSP, Pending/failed orders, System admin, Impersonate, Zoho callback, 404.

### Milestone 3: data screens
15. Account summary (plans, credit plans, storage plans, purchase / credit / usage history, TDS, wallet,
    Razorpay, payment steps + QR).
16. Master data (Myntra / Meesho / Snapdeal containers), SKU, Imports (incl. scan return parcel), Emails
    (inbox, Zoho connect, manual fix) + Mailbox logs.

### Milestone 4: heavy screens
17. CMS full: filters, bulk actions, all 12 modals, claim email editor, history, OTP prompt, script progress,
    sockets.
18. RMS, VMS + video player, Favorite / trash, Support chat (SSE), What's new + slider.

### Milestone 5: CMS create / update
19. Webcam recorder, image capture, video list, rearrange, bulk claim, per-platform claim forms.

### Milestone 6: finish
20. Dark mode (if kept, §11), responsive and keyboard pass, bundle check, side-by-side QA with TrackVid-FE
    on staging, final report listing anything that could not be matched.

---

## 8. Per-screen procedure

For each screen:
1. Read the TrackVid page and all its child components. List API calls, slices used, permission checks, socket/SSE events, modals, and loading / empty / error states.
2. Pick the template pattern from §5. Copy its markup and class names; write new typed components.
3. Wire the **same** services and slices. No new endpoints. No guessed field names.
4. Port teardown for every listener, interval, timeout, `createObjectURL`, `AbortController`, socket and SSE subscription (TrackVid rule).
5. **Security:** `dangerouslySetInnerHTML` is used in EmailInbox, WhatsNew, CMS and IntegrationsSettings. Email bodies are untrusted. Sanitize them (DOMPurify) or render them in a sandboxed `<iframe srcdoc>`. Do not carry the raw HTML injection over.
6. Verify: `npm run build` + `npm run lint` with zero warnings. Click through against TrackVid-FE on the same account: every action, every modal, permission-hidden buttons, empty and error states.
7. Update `PROGRESS.md`.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Template code is `@ts-nocheck` | Hidden type bugs if copied | Take markup and CSS only, write new typed components |
| DataGrid replacement | CMS/RMS/Master data are table-heavy; missed features (resize, server paging) | Build `DataTable` in Milestone 1 and prove it on the read-only CMS list |
| React 19 compatibility | `react-quill` (replaced by Tiptap), maybe `react-player` 2, `react-webcam` | Check each kept library on React 19 in step 1; replace any that fail |
| Editor HTML round-trip | Claim emails lose alignment or formatting after the switch | §6.1 HTML check is a gate before the editor ships |
| CMS is 3989 lines in one file | Hard to port without breaking behaviour | Split into feature hooks first (logic) and views (UI). Keep the logic identical |
| Untrusted HTML | XSS from email bodies | §8 step 5 |
| Two frontends in parallel | Features added to TrackVid-FE during migration get missed | Re-check `git log` on TrackVid-FE at the start of every milestone |
| Dark mode | Template CSS has hard-coded colours outside tokens | Treat it as its own step (Milestone 6), or drop it in v1 |

---

## 10. Done when

- Every TrackVid route renders in the new FE with the Veylix look, at the same URL.
- Every action, modal and permission rule matches TrackVid-FE on staging.
- Loading, empty and error states exist on every screen.
- `npm run build` and `npm run lint` pass with zero warnings. No `@ts-nocheck`, no `any`.
- No MUI or emotion in `package.json`.
- No console errors or hydration warnings.
- Final report lists anything that could not be matched, with the reason.

---

## 11. Open decisions (owner: you)

1. ~~Framework~~: **decided, Next.js 16 App Router** (§2).
2. **Auth page design:** give a reference, or accept a Veylix-style centred card.
3. **Dark mode:** give a dark palette or reference, accept a derived palette, or drop it in v1.
4. **Deployment:** Next.js needs a Node server or static export. The dashboard is client-rendered, so `output: "export"` is possible if the current hosting serves static files only. This needs dynamic routes (`/mailboxes/[id]/logs`, `/impersonate/[userId]`) to use query params or a client-side catch-all.

---

## 12. Autonomous run (the user is away until it is finished)

### 12.1 Decisions made so the run never blocks
| Question | Decision | Reason |
|---|---|---|
| Backend | **None.** The FE does not call TrackVid-BE or `../BE`. No axios instance, no SSE, no socket connection | User: "this development is not connected to BE, keep it separate" |
| Data | Typed sample data in `src/mocks/<domain>.ts`, served by `src/services/<domain>-service.ts` with the **same function names and response types** as TrackVid-FE `src/api/*-service.ts` (async, small fake delay) | Later, swapping a mock service for the real axios call is a one-file change per domain |
| State | Redux Toolkit store with the TrackVid slices that screens share; thunks call the mock services | Same data flow as TrackVid-FE |
| Auth | Mock login: any email + password (min 6 chars) signs in as a sample admin. Token and user kept in `localStorage` under `trackvid-ui:` keys. Guard redirects to `/auth/login` | Lets every guarded screen be reached |
| Permissions | Sample user has all permissions; `config/permissions.ts` keeps TrackVid permission keys so the menu gating code is real | |
| Live updates (SSE / sockets) | Simulated with a timer in the mock layer where a screen shows live changes (notifications, CMS script progress, support chat) | Every timer is cleared on unmount |
| Auth page design | Veylix-style centred card | No reference given |
| Dark mode | Derived from the light tokens in Milestone 6, behind the light / dark / system switch | TrackVid has it today; removing it would be a regression |
| Hosting | `next build && next start` (Node) | Dynamic routes (`/mailboxes/[mailboxId]/logs`, `/impersonate/[userId]`) |
| Text editor | Tiptap (§6.1). The HTML round-trip test runs on sample claim email HTML copied from TrackVid-BE's template shape | No staging access in UI-only mode |
| Git | **No commits.** `FE/` stays untracked in the parent repo | A BE agent is working in the same checkout and switches branches there. Never run git commands that change branches, the index or the working tree of the parent repo |

### 12.2 Rules for the agent
1. Read `FE/CLAUDE.md`, then `FE/PROGRESS.txt`, then the plan sections the next step needs.
2. **Never stop to ask.** Pick the option in this plan, or the simplest one that keeps the TrackVid behaviour, and
   log it under DECISIONS in `PROGRESS.txt`.
3. Work route by route in the order of `PROGRESS.txt`. A route counts as **migrated** only when:
   the page renders in the shell, all its sub-views and dialogs from TrackVid exist, loading / empty / error states
   exist, it uses only the mock service layer, and `npm run build` + `npm run lint` pass.
4. After every route: update the counter line and the route's status in `PROGRESS.txt` **before** starting the next one.
5. Never edit `../BE`, `/Users/apple/Documents/Sagar/Trackvid/*`, or `/Users/apple/Documents/Sagar/Other/veylix-next`
   (read only). Never read or print `../.env`.
6. If a step fails 3 times, mark that route `BLOCKED: <reason>` in `PROGRESS.txt` and move to the next route.
7. The run ends only when the counter shows every route migrated (or the rest are BLOCKED with reasons) and the
   final report is written at the bottom of `PROGRESS.txt`.

### 12.3 Commands

```bash
# work folder
cd /Users/apple/Documents/Sagar/Other/react-native-boiler-plate/FE

# install / run / verify
npm install
npm run dev          # http://localhost:3002
npm run build        # must pass (typecheck included)
npm run lint         # must pass with 0 warnings
npm run start        # production preview after build

# progress at a glance
grep -E "^MIGRATED" PROGRESS.txt
```

**Resume the run in a new Claude Code session** (after a restart, or if a session ends):

```bash
cd /Users/apple/Documents/Sagar/Other/react-native-boiler-plate/FE
claude --permission-mode acceptEdits "Read CLAUDE.md, PROGRESS.txt and MIGRATION_PLAN.md §12. Continue the TrackVid UI migration from the next PENDING route. Do not stop and do not ask questions until PROGRESS.txt shows every route MIGRATED or BLOCKED, then write the final report."
```

**Keep it going inside a session** (self-paced loop, re-checks progress each turn):

```
/loop Continue the TrackVid UI migration in /Users/apple/Documents/Sagar/Other/react-native-boiler-plate/FE per CLAUDE.md and PROGRESS.txt. Stop the loop only when every route is MIGRATED or BLOCKED and the final report is written.
```
