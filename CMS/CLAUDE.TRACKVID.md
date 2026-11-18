# TrackVid-CMS — Development Rules

> **Orientation.** Read this header, then the rules below. Both are binding.

|  |  |
|---|---|
| **Tier** | **1 — desktop runner.** Runs automations on an operator's machine. |
| **Stack** | Electron + React + TypeScript + Vite + MUI + Emotion + Tailwind + electron-builder · puppeteer-core · selenium-webdriver · pino |
| **Targets** | Windows 10+/11 (x64 + ARM64), macOS (Intel + Apple Silicon) |
| **Dev** | `npm run dev` |
| **Verify** | `npm run verify` (typecheck ×2 + lint + unit) · `npm run test:e2e` for IPC/preload/storage/window changes |

## Layout

```
electron/main/        main process — platform/, database/, ipc/, services/, windows/
electron/preload/     controlled bridge
electron/renderer/    React UI — no Node/Electron imports (ESLint-enforced)
shared/               constants/ (channels.ts), types/, utils/, validation/
node_modules/@trackvid/automation-core/   installed from GitHub (main), pinned by package-lock — never edit here
```

## Cross-repo

| | |
|---|---|
| **Calls** | TrackVid-BE — `/cms`, `/cms/counts`, `/cms/find-by-awb`, `/cms/update-ticket`, `/cms/my-company-credentials`, `/cms/renew-session`, `/system-admin/setting/companies/automation-routing` |
| **Shares** | `@trackvid/automation-core` (git dependency) with Automated-Scripts · Mongo documents and socket events with TrackVid-BE |
| **Obeys** | settings written by Trackvid-Monitor — `desktopExecution`, `apiBasedAutomation`, `masterImportSyncTime`, `isAutoLoginOnActiveSession` |


## Do not

- **Do not introduce a UI or CSS framework beside MUI and Tailwind.** MUI 7 + Emotion for everything visual, Tailwind alongside it for layout and spacing, arranged as TrackVid-Monitor arranges them. The app's *look* is the Veylix template's, applied as one override layer (`theme/veylixTheme.ts`) over Monitor's ported theme — see the UI/UX rules.
- **Do not hard-code a filesystem path.** `app.getPath("userData")` + `path.join()`.
- **Do not add a native module.** Currently zero; adding one flips `npmRebuild` and needs the full review.
- **Do not add any dependency silently** — verify maintenance, Node + Electron compat, Windows/macOS, x64 + ARM64, licence, CVEs, and state the result.
- **Do not bump a pinned version** — TypeScript 5.9.3, Vite 7.3.6 and Electron 43.4.1 are held back for stated reasons.
- **Do not change the core** without running all three verifies and moving **both** consumers' pins.
- **Do not change a payload sent to TrackVid-BE** without checking the endpoint's other callers — several are shared with Automated-Scripts.
- **Do not let the renderer reach Node or Electron directly.** Everything goes through controlled IPC.

## This repo is one of five that move together

```
Trackvid-Monitor ──┐                                   ┌── Automated-Scripts ──┐
  (control plane)  │                                   │   (server runner)     │
                   ├──→  TrackVid-BE  ──────────────→  │                       ├─→ @trackvid/
Trackvid-CMS ──────┘   (API + Mongo + sockets)      ↑  └── Trackvid-CMS ───────┘   automation-core
  (desktop runner)                                  │      (desktop runner)          (shared code,
                                                    │                                 submodule)
                              *_SCRIPT_URL ─────────┘
                        BE forwards work to Automated-Scripts
```

| Repo | Role | What it can break |
|---|---|---|
| **TrackVid-BE** | API, Mongo schema, sockets, forwards work to the runner | everything |
| **TrackVid-Automation-Core** | shared automation code, pinned separately by each runner | both runners |
| **Automated-Scripts** | runs automations on the server; also the target of BE's `*_SCRIPT_URL` calls | BE flows that forward to it |
| **Trackvid-CMS** | runs automations on an operator's machine | itself |
| **Trackvid-Monitor** | writes the settings that decide how the runners behave | both runners, at runtime |

The core is shared with the Automated-Scripts server, and **each repo pins its own
commit of it**. Two consequences, both binding:

1. **Changing the core changes both consumers.** It is a git dependency here
   (`github:trackVid21/TrackVid-Automation-Core#main`, the exact commit held in
   `package-lock.json`), so it is edited in its OWN clone — e.g.
   `../TrackVid-Automation-Core` — never inside `node_modules`, which the next
   install overwrites. Before editing it, read that clone's `CLAUDE.md` — it is
   the contract, and it lists the checks. This is the trap to avoid: a bug shows up
   here, the core flow is changed to fix it, it is verified here, and the server
   breaks on its next run. `npm run verify` in this repo cannot see that.

2. **No hard-coded utilities here.** A helper that another runner could want —
   login, sessions, a platform API call, TrackVid write-back, parsing — belongs
   in the core, not in `electron/`. This repo holds the desktop app: windows,
   IPC, local stores, UI.

   When the core needs to behave differently for the desktop, **add a parameter
   with a default that preserves today's behaviour** rather than changing the
   flow. `loginSnapdealApi(credentials, { session })` is the pattern: this app
   supplies a jar it captured itself, and the server path is untouched.

**The core is not the only thing you share.** Three more surfaces couple these
repos, and none passes through it:

- **TrackVid-BE's API and Mongo schema.** Both consumers call BE endpoints and read
  or write the same documents — session records, `settings.desktopExecution`,
  `settings.apiBasedAutomation`, `settings.masterImportSyncTime`, `settings.isAutoLoginOnActiveSession`, `masterDataSync`,
  the CMS claim itself. A changed response shape or field name breaks whichever
  consumer was not checked.
- **A runtime chain, CMS → BE → Automated-Scripts.** The desktop app's "Re-capture"
  posts to `/cms/renew-session`, which the backend forwards to
  `{<PLATFORM>_SCRIPT_URL}/<platform>/renew-session` — code running in
  Automated-Scripts. Every `*_SCRIPT_URL` handler in the backend works this way.

- **Trackvid-Monitor writes the settings this repo obeys** —
  `settings.desktopExecution`, `settings.apiBasedAutomation`,
  `settings.masterImportSyncTime`. A toggle changed there alters behaviour here
  with no code change at all.

So "I did not touch the core" does not mean the other consumer is safe. Before
changing a shared response shape, a stored field, a socket event or an endpoint
either consumer calls, grep for it across Automated-Scripts, Trackvid-CMS,
TrackVid-BE and Trackvid-Monitor. Each has its own contract in its `CLAUDE.md`.

After any core change, all three must pass:

```bash
npm --prefix ../TrackVid-Automation-Core run build              # in the core's own clone
npm install @trackvid/automation-core@github:trackVid21/TrackVid-Automation-Core#main   # after pushing the core
npm run verify                                                  # typecheck ×2, lint, tests
cd ~/Documents/WS-Project/Automated-Scripts && node server.js   # boots and listens
```

Then move **both** pins — here that is `npm install @trackvid/automation-core@github:trackVid21/TrackVid-Automation-Core#main` and committing
`package-lock.json`. A commit in the core is invisible to a consumer until its
pin moves. Installing needs GitHub access to the private core repo: a machine
credential (`gh auth setup-git`, or a token in the global git config) — never a
token inside `package.json` or the lockfile.

## Mandatory reading

**[Cross-Platform Development Guidelines.md](./Cross-Platform%20Development%20Guidelines.md) is binding for all work in this repo.**

The project-specific rulebook — pinned versions, why each is pinned, the storage
decision, the release checklist — is
**[docs/CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md](./docs/CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md)**.
Read it before changing dependencies, storage, IPC, or packaging.

Read it before writing code, adding a dependency, touching IPC/filesystem/packaging,
or reviewing a change. The summary below is a reminder, not a replacement — when the
two disagree, the guidelines document wins.

## Non-negotiables

- **Targets:** Windows 10+/11 (x64 + ARM64) and macOS (Intel x64 + Apple Silicon ARM64).
  Never decide anything on "it works on my machine."
- **Stack:** Electron + React + TypeScript + Vite + MUI + Emotion + Tailwind CSS + Node.js + electron-builder.
  Do not introduce a third UI/CSS framework or a parallel build tool.
- **Dependencies:** Prefer built-in Electron/Node/browser APIs or existing project utilities.
  Before proposing any new package, verify: active maintenance, latest stable release,
  Node + Electron compatibility, Windows/macOS support, x64 + ARM64 support, native-module
  and electron-rebuild requirements, license, known CVEs. Never add deprecated or
  abandoned packages. State the verification result in the response — do not install silently.
- **Native modules:** Treat as high risk. Only after confirming Electron ABI compatibility,
  Windows x64/ARM64, macOS x64/ARM64, and production packaging support. Prefer a pure-JS
  alternative whenever one is sufficient.
- **Filesystem:** Never hard-code paths (`C:\Users\...`, `/Users/...`). Use
  `app.getPath("userData")` and `path.join()`.
- **Platform code:** Isolate behind a platform abstraction layer using `process.platform` /
  `process.arch`. No platform conditionals scattered through React components.
- **Electron security:** `contextIsolation` on, renderer Node integration off, secure preload,
  controlled IPC only. The renderer never gets unrestricted Node access.
- **IPC:** Every renderer↔main call goes through a controlled handler that validates input,
  handles errors, returns predictable results, and exposes the minimum capability needed.
- **Performance:** No polling, leaked listeners/timers, stray background processes, or
  duplicate requests. Always clean up listeners and timers.
- **Every automation announces itself:** a master import, a session capture and a claim each
  write one line when they start and one when they stop, built with
  `@main/automations/common/processLog` (a binding to the core, so this app and the server
  word an identical run identically). Wrap the process BOUNDARY — `masterImport.service`,
  `platformSession.service`, `claimProcessor.service` — never inside a per-platform runner.
  Most boundaries here return `Result`, so use `withProcessLogResult`: `withProcessLog` alone
  would announce "closed successfully" for a run that failed. Full rule, and the server-side
  half, in Automated-Scripts `RULES.md` §9.

## Commands

| Task | Command |
| --- | --- |
| Dev | `npm run dev` |
| Typecheck + lint + tokens + unit tests | `npm run verify` |
| Visual constants outside theme.css | `npm run verify:tokens` |
| End-to-end (boots the real app) | `npm run test:e2e` |
| Move the core pin to the tip of its `main` | `npm install @trackvid/automation-core@github:trackVid21/TrackVid-Automation-Core#main` — then verify, and commit `package-lock.json` |
| Production build | `npm run build` |
| Installers | `npm run build:win` / `npm run build:mac` |

Run `npm run verify` before reporting any change complete. Run `npm run test:e2e`
for anything touching IPC, preload, storage, or window configuration.

## Version pins that are NOT staleness

Two dependencies are deliberately held back. Do not "update" them without
checking the peer ranges first:

- **TypeScript 5.9.3, not 7.x** — typescript-eslint 8.x requires `<6.1.0`;
  TypeScript 7 silently disables type-aware linting.
- **Vite 7.3.6, not 8.x** — electron-vite 5.0.0 peer-depends on `^5 || ^6 || ^7`.

Electron is pinned to **43.4.1** (supported stable), not the three-day-old 44.0.0.

## Architecture invariants

- `process.platform` is read in exactly one file: `electron/main/platform/index.ts`.
- IPC channel names exist in exactly one file: `shared/constants/channels.ts`.
  A handler not listed there throws at registration; the preload refuses to forward it.
- Storage paths are resolved in exactly one file: `electron/main/database/index.ts`.
- Services and IPC depend on the `CrudRepository` interface, never on the storage
  engine. Swapping JSON for SQLite means one new class, nothing else.
- The renderer reaches Electron only through `renderer/services/ipcClient.ts`.
  ESLint blocks Node/Electron imports and `require`/`process` globals in
  `electron/renderer/**`.
- Zero native modules. Adding one requires the full review in the docs (§11) and
  flips `npmRebuild` in `electron-builder.yml`.

## Definition of done for a feature

Before calling a change complete, confirm and report on each item of the guidelines'
New Feature Checklist (§16): cross-platform compatible; no hard-coded paths; no unnecessary,
deprecated, or unsupported dependency; IPC secured; error/loading/empty states implemented;
TypeScript passes; ESLint passes; tests pass; production build passes; existing functionality verified.

Development-mode testing alone is never sufficient — say explicitly which of
(dev mode, production build, Windows, macOS, x64, ARM64) were actually verified and which were not.

## Dependency upgrades

Never bump dependencies automatically. A major upgrade requires the §15 sequence: release
notes → breaking changes → Electron compat → Node compat → native deps → tests → Windows
build → macOS build → test production installers.

## Packaging & signing

Windows: NSIS for x64 and ARM64. macOS: DMG for x64 and ARM64 (universal where appropriate).
Signing credentials are never committed to source control.

### Pre-build env check — before EVERY `npm run build*` (hard rule)

Before running any build or installer command (`build`, `build:win*`,
`build:mac*`, `build:unpack`), check these values and report them. Three are
baked into the installer at build time, so a wrong value ships to every
operator:

| Key | Required value | If wrong |
|---|---|---|
| `TRACKVID_OBFUSCATE` | `true` | main/preload ship as readable source |
| `MAIN_VITE_DISABLE_SUBMIT` | `false` | claims run but are never submitted on the platform |
| `MAIN_VITE_HEADLESS` | `true` | browser windows pop up on the operator's machine |

Check every place a value can come from:

1. `.env` — the main source.
2. `.env.production.local` / `.env.production` — Vite loads these **over**
   `.env` in a production build, so a key here wins.
3. The shell environment — `scripts/obfuscate.cjs` lets a `process.env` value
   (including the legacy `OBFUSCATE` key) override `.env`.
4. Per-platform headless overrides (`MAIN_VITE_<PLATFORM>_HEADLESS`, e.g.
   `MAIN_VITE_FLIPKART_HEADLESS`) — anything but `true`/unset is a mismatch.

Also report the API / update-feed target (`MAIN_VITE_API_BASE_URL`), and
whether a signing certificate is set (`WIN_CSC_LINK`/`CSC_LINK` + `CSC_KEY_PASSWORD`).

**If any value differs, do not build.** Show the key, the file it came
from, the current value and the value it needs, and suggest the fix (edit that
line in `.env`, or `unset` it in the shell). Build only after the user confirms.
Never print secret values while checking — only these keys.

Use the npm script that matches the target: `build:win` / `build:win:x64`,
`build:win:arm64`, `build:mac:x64` / `build:mac:arm64` / `build:mac:universal`
(Mac builds need a Mac). Output goes to `release/<version>/`.

---

## Folder structure is mandatory, not a suggestion

**Every automation file lives at a path that names its platform.** There is one
tree shape, and all three code repos use it:

```
platforms/<platform>/                       ajio | delhivery | flipkart | meesho
                                            myntra | nykaa | snapdeal | tatacliq | xbees
  common/                              L2   every automation on this platform
  <automation-type>/                        claim-management | master-import
                                            | ticket-download
    common/                            L3   both flows of this automation
    api-based-flow/    common/         L4   direct HTTP to the platform's APIs
    script-based-flow/ common/         L4   puppeteer / selenium UI driving
common/                                L1   platform-agnostic, used by 2+ platforms
```

**Shared functionality goes in a `common/` file — never copied into a second
platform's folder.** Push it as far *down* as it is true and lift it only when a
second caller actually appears; never pre-lift to L1 "because it might be shared".

Concretely, these are all wrong and must be fixed rather than extended:

| Wrong | Right |
|---|---|
| `services/snapdealClaim.ts` | `platforms/snapdeal/claim-management/api-based-flow/runClaim.ts` |
| Meesho logic inside `platforms/snapdeal/` | `platforms/meesho/...` |
| The same helper pasted into two platform folders | one file in the nearest shared `common/` |
| `if (platform === 'nykaa') { … }` in a shared file | one entry in the platform registry |
| A platform name in a filename instead of a folder | the folder carries the name |

**A `switch` or `if` on a platform name outside the registry is a structural
bug.** Dispatch is a lookup in one map (`CLAIM_RUNNERS`, `pickRunner`,
`PLATFORM_AUTOMATIONS`); adding a platform must be one folder plus one entry, and
must not require editing any shared file.

Before writing a new file, answer both:

1. **Which platform is this true for?** If exactly one → its platform folder. If
   two or more → the nearest `common/` above them, not a copy in each.
2. **Would the other runner want it?** If yes it belongs in
   `@trackvid/automation-core`, not in a consumer. Consumers hold orchestration
   only — routes, controllers, cron wiring, queues, workers, IPC, env config.

**Root in this repo:** `electron/main/automations/platforms/`, with
`electron/main/automations/common/` as L1 and `registry.ts` as the only
platform→code map. `electron/main/services/` is orchestration (queue, socket,
session, IPC) and must contain no marketplace-specific logic.

## UI/UX maintenance rules

**The Veylix template's design language is the reference. Monitor's is the substrate.**

This app is dressed in the Veylix look — a warm cream page with a soft
gradient, glass cards (white-to-cream gradient, white edge, 16px corner, soft
warm shadow, backdrop blur), a floating glass sidebar and a top bar of two glass
pills, a gold accent used as a FILL with dark-brown text, pastel status pills,
tables whose rows are tinted bands, heavy tight headings with a gold full stop.
Every value comes from the template CSS and is recorded, with its source
selector, in **`docs/veylix-tokens.md`** — take values from there, never from
memory. The template has no dark scheme; the warm dark palette is derived and
recorded in the same file. (This replaced the earlier Vercel re-dress; the CMS
and Monitor still do not look like the same product, and that is the decision.)

What is still Monitor's, and still literal, is everything *underneath* the
paint: the ported `@core` / `@menu` / `@layouts` trees, the MUI theme object's
shape, the vertical shell, the type and spacing scales. Those remain copies,
and the rules about not editing them are unchanged — the divergence is expressed
as one override layer on top, never as edits to the port. (The ported spacing
unit is 4px: `p: 3` is 12px, not 24px.)

**That layer is `electron/renderer/theme/veylixTheme.ts`**, deep-merged over
`@core/theme` in `VuexyThemeProvider.tsx`. It is where a colour, a corner, an
edge or a component default belongs. Change it there and all ~70 screens move
together; change it in a component and you have made the one screen that drifts.
It also publishes the template's surfaces as CSS variables (`--veylix-*`, both
schemes); hand-written panels use those through `styles/veylix.css`
(`.veylix-glass`, `.veylix-tile`, `.veylix-note`, `.veylix-card-title`).

Two invariants in that file are pinned by `tests/renderer/veylixTheme.test.ts`:

- **It must not define `palette.primary`.** The accent ships as a preset in
  `primaryColorConfig` (the Veylix gold, `primary-veylix`), so it reaches the
  theme through the operator's own setting, and every accent in the layer is a
  `--mui-palette-primary-*` variable. Put a primary in the layer and Settings →
  Theme silently stops working.
- **`mainColorChannels` must stay neutral** — Veylix's warm neutrals (its ink
  and the derived cream), not a hue. The ported theme derives text, divider and
  every action state as an opacity on those channels.

**Shipped defaults.** `DEFAULT_THEME_SETTINGS` in `shared/types/appearance.ts`
still ships the near-black accent and Geist; making the gold and Manrope (already
vendored and declared in `styles/fonts.css`) the defaults is a three-line change
there plus moving `primary-veylix` first in `primaryColorConfig`
(`tests/defaultPrimaryColour.test.ts` pins the two together).

Dialogs that only open from a live run are checked through the preview-only
`electron/renderer/preview/DialogGallery.tsx` (`#dialog-gallery=<name>`).

When this document and Monitor disagree **on colour, type or chrome**, this
document wins. On structure — the shell, the nav, the layout primitives — open
Monitor and copy what it does.

The old system (a hand-written `theme.css` of semantic Tailwind tokens, seven
themes, then two, and a thirteen-seed colour customiser) is **retired**. If you
are reading a component that still uses `bg-surface` or `text-muted`, you are
reading something that has not been migrated yet — see *The bridge*, below.

### The system is MUI, and Tailwind sits alongside it

**MUI 7 + Emotion is the primary framework.** Colours, elevation, typography,
density and every component's default look come from the theme object, which is
assembled in `electron/renderer/theme/VuexyThemeProvider.tsx` out of
`@core/theme`. Tailwind is still here and still used — for layout, for
one-offs, for spacing — exactly as Monitor uses it. That is not a second
framework; it is the arrangement being copied.

Practically, for a component:

| you need | you write |
|---|---|
| a colour | `color='text.secondary'`, `sx={{ color: 'primary.main' }}`, `text-textPrimary`, `bg-backgroundPaper` |
| a surface | MUI `Card` / `Paper`, never a hand-rolled `div` with a border and a radius |
| type | MUI `Typography` with a `variant`, or Monitor's Tailwind steps |
| spacing | Tailwind logical utilities — `plb-4`, `mbe-6`, `gap-4`, `is-full`, `min-is-0` |
| an icon | `<i className='tabler-…' />` |

**Never write a raw colour in a component** — no hex, no `rgb()`, no
`oklch()`, and no Tailwind palette name (`text-slate-500`, `bg-red-50`). Raw
colours belong to the theme files under `@core/theme`, which are vendored and
which you do not edit (see below). A colour that is not in the theme is a
colour the operator's primary-colour choice and the dark scheme cannot reach.

`npm run verify:tokens` still runs, but its scope is now narrow: it skips the
ported trees (`@core`, `@menu`, `@layouts`, `configs`, `theme`, `navigation`,
`layout`, `preview`) and guards what has not yet moved off the old tokens. It
is a transitional check, not the rule. The rule is the paragraph above.

### The vendored trees are copies, and must stay copyable

```
electron/renderer/@core/       theme, MUI component overrides, styles, hooks
electron/renderer/@menu/       the vertical nav (vertical only — no horizontal, no RTL)
electron/renderer/@layouts/    the shell
electron/renderer/configs/     themeConfig.ts, primaryColorConfig.ts
```

These are copied from TrackVid-Monitor, and the whole point is that the next
copy is a `cp`, not a merge. **Do not edit a file in them to fix something in
this app.** The escape hatches, in order of preference:

1. **Change the theme object we assemble**, in `theme/VuexyThemeProvider.tsx` —
   it deep-merges our overrides on top of the ported core theme.
2. **Add a rule in `styles/`**, which is ours.
3. **Wrap, don't patch** — a component of ours that composes the ported one.

Monitor is a Next.js app, so the copies import `next/link`, `next/navigation`
and `react-use`. Those are **aliases in `electron.vite.config.ts`** pointing at
shims in `navigation/` and `@core/hooks/` — which is what keeps the files
byte-identical to Monitor's. `react-use` is deliberately *not* installed: it
pulls a vulnerable `js-cookie`, and exactly one hook was needed.

Deliberately dropped from the port: horizontal layout, RTL, and the `semiDark`
skin. Do not re-add one because a ported file references it.

### Themes — light, dark, system

MUI colour schemes, selected by `data-` attribute on `<html>`
(`colorSchemeSelector: 'data'`). **Three choices, and only three:** Light, Dark,
and System, which follows the OS. There is no third palette and no seventh
theme; a new tone is a primary colour, not a scheme.

The mode is persisted inside the appearance record
(`shared/types/appearance.ts` → `ThemeSettings`) precisely because the preload
already hands that record to the renderer at first paint — so a restart opens in
the right palette with no flash. Anything you add to the customiser goes in the
same place for the same reason.

**Test both schemes after any UI change.** Toggle it, look at the screen. A
component that has only been seen in Light is not finished.

### The customiser

Settings → Theme (`pages/settings/ThemeCustomizerCard.tsx`) is Monitor's
customiser, as a settings card rather than a drawer. It owns five things:

- **Primary colour** — six presets plus a picker, near-black first. Every
  accent in the app derives from it, which is why a hard-coded accent anywhere
  is a bug. The first entry in `primaryColorConfig` is what ships, what Reset
  returns to, and what `DEFAULT_THEME_SETTINGS.primaryColor` must equal — three
  places pinned together by `tests/defaultPrimaryColour.test.ts`.
- **Mode** — Light / Dark / System.
- **Skin** — `default` or `bordered`.
- **Typeface** — Geist, Public Sans, Inter, or the system stack.
- **Content width** — `compact` or `wide`.

`ThemeSettings` is sanitised in `electron/main/services/preferences.service.ts`
on the way in and out. An unknown value must fall back, never throw: a
downgrade, a hand-edited `preferences.json` and a machine that has never opened
Settings all have to land on the shipped defaults.

### Fonts and icons are bundled — no network at runtime

The app must look right offline and on a locked-down machine.

- **Fonts:** Geist, Public Sans and Inter ship as woff2 and are declared in
  `styles/fonts.css`. No Google Fonts link, no `@import` over the wire. Geist is
  the default and the only one with an italic face declared, because it is the
  face an `<em>` anywhere in the app will be set in.
- **Icons:** one set, Tabler, as a **generated subset**. `npm run icons` runs
  `scripts/build-icon-subset.cjs`, which scans the renderer for `tabler-*` class
  names and emits rules for only those — 32 of 6,011 at the time of writing,
  13 KB against 2.8 MB. **Run it after adding an icon**, or the class renders
  as nothing.

No Unicode glyphs as icons (`▣`, `◔`, `▸`) — they render differently on Windows
and macOS, carry no consistent stroke weight, and cannot be sized reliably.

### Layout

The shell is `layout/AppShell.tsx` over `@layouts/VerticalLayout` — rail,
navbar, content. Page width is the layout's business, driven by the content-width
setting; **do not write a `max-w-*` on a page wrapper.** A wide page is right; a
wide line of text is not, so cap prose inside cards with `max-w-prose`.

The navbar and the nav header are **drag strips** (`.app-drag`), and everything
interactive inside them opts out (`.app-no-drag`). Monitor has no opinion about
this because a web page cannot be dragged. On macOS the nav header carries
padding for the traffic lights; that is in `styles/window.css`.

Two fixes in `styles/behaviour.css` are load-bearing and easy to undo by
accident:

- `body { min-inline-size: 0; flex: 1 1 auto }` — `html` is `display: flex`, so
  the body is a flex item whose default `min-inline-size: auto` let a wide table
  push the whole layout past the window. `flex: 1 1 auto` stops the opposite
  failure, a sparse page shrinking to fit its content.
- The `min-inline-size: 0` override on the layout classes is inside
  `@layer theme` **on purpose**: for `!important` declarations, cascade-layer
  order reverses, so an unlayered `!important` would lose to the layered one it
  is trying to beat.

Do not set `overflow: hidden` on the body. The ported rail and navbar are
`position: sticky` and rely on the document scrolling.

### Components

- **Reuse before adding.** `components/ui/` holds `Button`, `Badge`, `Card`,
  `Modal`, `Input`, `Select`, `Checkbox` and `Switch`, all rebuilt on MUI with
  their props unchanged. Reach for the MUI component directly when there is no
  wrapper; do not write a third card shape.
- **Tables** follow Monitor: TanStack React Table with `@core/styles/table.module.css`.
- **New component ⇒ both schemes on day one.**

### Messages on screen

- A **toast is a glance**: one line, clamped, at most three at once. Never put a
  stack trace in one — a batch of failures once covered the whole window and
  then vanished, unreadable either way.
- The **full text belongs in the notification centre**, which keeps it, and
  expands on the row the operator picks.
- A list of near-identical errors is **grouped by cause and collapsed**, with
  the cause as the headline — that is the part someone can act on.

### The bridge (temporary)

`styles/theme.css` and `styles/legacy.css` re-point every old token name at a
MUI variable, so a screen that has not been migrated still renders correctly
next to one that has. Three surfaces still sit inside a `.legacy-ui` wrapper:
the login screen, the session splash and the mandatory-update screen.

**This is scaffolding with a demolition date.** Do not build on it — a new
component uses MUI and Monitor's names. When the last three surfaces move, both
files and the wrapper go, and `verify:tokens` is replaced by the inverse check:
no raw hex outside the ported theme files.

### Do not

- Change business logic in a UI-only change.
- Edit a file under `@core`, `@menu`, `@layouts` or `configs` to fix this app.
- Hard-code a hex, an `rgb()`, an `oklch()` or a Tailwind palette colour in a
  component.
- Add a UI or CSS framework beside MUI and Tailwind, or a third colour scheme.
- Ship a component that has only been looked at in one scheme.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->

<!-- BEGIN trackvid-review-rules v1 — identical in every TrackVid repo under D:\Sagar. Edit all copies together. -->
## Git & review gate — hard rules (read before the review rules below)

These close the gaps that let a Blocker reach `main` even though the review
rules below already existed (BE `8811062c`, 2026-11-02: `desktopExecution`
default flipped to ON with no migration, pushed straight to `main`, no PR,
runner still defaulting to OFF). Text in a CLAUDE.md does not stop anything on
its own — so these rules attach the review to **commit** and **push**, which
are moments that always happen, instead of to "done", which can be skipped.

### Git
1. **Never push to `main`/`master`** — not directly, not via `HEAD:main`,
   `+main`, `--all` or `--mirror`, not by pushing while `main` is checked out.
   **Do not ask for permission to push to main.** The answer is always no;
   main changes only through a PR merged on GitHub.
2. **Never push any branch without explicit permission in the current
   conversation.** One approval covers one push. Commit locally, report, wait.
3. **Never commit on `main`.** If `git branch --show-current` is `main`, create
   a feature branch first.
4. Enforced on this PC by `~/.claude/hooks/git-push-guard.js`: pushes to
   main/master are denied, all other pushes prompt. If it blocks you, report
   and stop — never work around it.

### Review gate — runs before EVERY commit, not only at "done"
5. Before each `git commit`: run LAYERS 1–10 on the staged diff **and** on the
   whole branch (`git diff origin/main...HEAD`), fix every Blocker and High,
   and run this repo's verify command. **If a Blocker remains, do not commit.**
   Report it instead.
6. **An empty branch diff is not "nothing to review".** If
   `git diff origin/main...HEAD` is empty, run `git log -10 origin/main` and
   review any commit that reached main without a merged PR. Those are the
   riskiest commits of all, not out of scope.
7. **A changed default, fallback, enum meaning or interpretation is a contract
   change, even when no name changes.** Grep for the reader in every sibling
   repo and compare its default and fallback with yours. They must match, or
   the change moves across repos together (migration plus consumer change).
   Grepping a field name and finding it unchanged proves nothing.
8. **An edited test expectation is a behaviour change.** If you change an
   existing assertion's expected value, list it in the report as a deliberate
   behaviour change with the reason and the consumers you checked. Never edit a
   test just to make it pass.
9. **A deleted "why we don't do X" comment is a Blocker** until the risk it
   names is handled in code (migration, guard, flag). That comment was the
   review, written in advance.
10. **Commit hygiene.** The message must say what changed — no placeholder
    messages ("Implement feature X…"). Formatting-only changes go in their own
    `style:` commit and are never mixed with logic.
11. **Prod data.** Before running the app, a script or a migration locally,
    check the DB / API target in `.env`. If it names prod (`prod`,
    `production`, `api.trackvid.in`), say so before anything that writes.

## Review rules — applied WHILE developing, not after

These rules bind every change made in this repo, from the first line written.
The goal is that a finished feature needs no separate review pass.

**While writing code:** apply LAYERS 1–10 below as you go. When a choice would
violate one (unguarded route, unindexed query, listener without teardown,
renamed contract field…), make the compliant choice instead and say why in one
line. Do not leave a known Blocker or High in code you hand back.

**Before saying a feature is done** — every time, without being asked:

1. Diff the whole branch, not just the last edit:
   `git fetch origin && git diff origin/main...HEAD` plus `git status` for
   uncommitted work. Commits already on `main` that came through a merged PR are not part of the review;
   commits that reached `main` without a PR are (see Review gate rule 6).
2. Run every LAYER below against that diff. Layers marked (BE) apply to
   TrackVid-BE; in other repos, apply their intent to whatever plays that role
   (IPC handlers, local DB, socket handlers) or mark them N/A.
3. Fix every Blocker and High in place. Leave Medium/nits listed, not fixed,
   unless trivial.
4. Run this repo's verify command (build + tests). Report real results.
5. Check sibling repos for any contract you touched (LAYER 7). They sit next
   to this one under `D:\Sagar\` — TrackVid-BE, TrackVid-FE, Trackvid-CMS,
   Trackvid-Monitor, TrackVid-app, Argos-Watch-TrackVid-App,
   TrackVid-Mobile-app, TrackVid-Print-Agent, Automated-Scripts,
   TrackVid-Automation-Core. Grep them; don't assume.
6. Report in the OUTPUT FORMAT below.

For each LAYER, state what you actively verified, what you skipped and why,
and what you couldn't verify without runtime access.

### OUTPUT FORMAT
- Verdict: MERGE / MERGE WITH FIXES / DO NOT MERGE
- Blockers (critical): each with file:line + failure scenario + 1-line fix
- High: same shape
- Medium / nits: brief
- What looks good: table of key design decisions worth preserving
- Deploy checklist: pre-deploy blockers, post-deploy monitoring, deploy order

### LAYER 1 — CODE QUALITY (FE + BE)
- Silent breakage: trace every changed function through every caller.
  No unrelated behavior change without callout.
- CPU/RAM: no new loops over large arrays in render, no cloning of big
  objects per keystroke, no unbounded state/collection growth.
- Memory leaks: every addEventListener, setInterval, setTimeout,
  URL.createObjectURL, AbortController, subscription has matching teardown.
- Race conditions: unmount guard, AbortController, seqRef for out-of-order
  network responses, effect keys for stale closures.
- Error handling: undefined/null/empty/network-fail/stale-token/perm-denied
  all have defined behavior. No silent `catch {}` without comment explaining
  why swallowing is correct.
- Security: no `dangerouslySetInnerHTML` with untrusted input, no `eval`,
  no shell string building, no `javascript:` URL reaches `<a href>`/`<img src>`.
- Duplication: grep for existing helper before adding new one.

### LAYER 2 — AUTH & ROUTES (BE)
For every new/modified route:
- Middleware present? Which tier?
  - `authMiddleware` = any logged-in user (weakest)
  - `adminAuth(["permission"])` = admin with permission
  - `systemAdminAuth, adminOnly` = system admin (strongest, use for
    destructive/cross-company writes)
- Destructive endpoint (delete, bulk update, cross-company mutate) MUST
  be sysadmin-gated.
- Every read/write scoped by `companyId` from `req.user`?
- Blast radius: single-tenant / multi-tenant / global? Match to auth tier.

### LAYER 3 — DB QUERIES (BE)
For every new find/findOne/updateMany/aggregate:
- Which index serves it? Explicit — name the index.
- `$regex` — indexable only if anchored `^` AND no `i` flag. Otherwise
  collscan. Case-insensitive → use `collation({strength:2})` + collation
  index, not regex.
- `$or` — each branch needs its own compound index.
- `$expr` with `$toLower`/`$toUpper` → collscan, not sargable.
- Compound index prefix: equality fields first, then range/sort.
- `.lean()` on read-only queries.
- `.select()` on large docs (avoid full-doc reads).
- `bulkWrite({ordered:false})` — check per-op errors, don't just report
  queued count as success.

### LAYER 4 — MODELS / MIGRATIONS (BE)
- New schema field: existing rows still validate? Default value sensible?
- Enum expansion: grep every `switch` consumer for missing case handling.
- Field rename: migration script included OR legacy shape preserved via
  fallback lookup?
- Snapshot vs live-lookup: if you snapshot at create time, changes to
  source data after don't propagate. Confirm intent.
- Legacy row shapes on hydration — reconstruct don't overwrite.
  Common bug: `typeof x[0] !== 'string'` check on array → treats legacy
  string[] as unseeded → wipes data on next save.

### LAYER 5 — BULK / BATCH OPS
- Batch size cap declared as constant.
- Per-row error accumulation, not silent drop.
- Atomicity guarantee stated (all-or-nothing, best-effort, transactional).
- Mock Response objects (if invoking a handler in-process) stub the
  FULL Response surface, not just status/json — future handler edits
  reaching for setHeader/write/pipe must not throw TypeError.

### LAYER 6 — BUSINESS INVARIANTS
- Status transition gates preserved (e.g. don't demote RESOLVED → PENDING).
- Silent overwrites: does new code stomp operator-set fields
  (remark, status, notes) that user typed manually?
- Bulk paths respect the same gates single-row paths enforce.

### LAYER 7 — CROSS-FILE WIRING
- Hook consumers destructure every prop they need.
  Regression pattern: hook adds new field, half the callers pick it up.
- Duplicate lookups: same BE endpoint called from two places for same
  keystroke? Consolidate.
- BE contract change: verify App/scripts/other repos still match.
- Route ordering: `/foo/:id` before `/foo/bulk` catches "bulk" as id.
- Duplicate route registrations (dead code but confusing).

### LAYER 8 — PR DISCIPLINE
- Own CLAUDE.md rules — does THIS change violate them? (Common: PR that
  adds "no regex" rule uses regex 3 places.)
- Deleted UX affordances (Cancel button, banner, exit path) — was
  the deletion intentional? Left user stuck?
- Prior-review findings — did the developer actually fix them or
  just add optional chaining and call it fixed?
- Constants / slug tables: dead OR-arms (`x === "a" || x === "a"`),
  typos (`naykaa` vs `nykaa`), duplicate map entries.

### LAYER 9 — DEPLOY RISK
- Blast radius per blocker: single user / single company / all companies.
- Deploy order: BE before FE if contract change; App last (or
  simultaneously via version-gate) if App relies on new BE fields.
- What breaks between "merge now" and "fix tomorrow"? If any
  overnight-damage scenario exists (unauth destructive endpoint,
  silent data corruption, silent data loss), block the merge.
- Feature flag / dark launch option for risky features.

### LAYER 10 — REPORTING
For each blocker: state exact fix, not vague direction.
Bad: "Add auth to this endpoint."
Good: "Line 1064: replace `router.post("/sync-spf-tat-to-companies", handler)`
       with `router.post("/sync-spf-tat-to-companies", systemAdminAuth,
       adminOnly, handler)`."

For each fix: state 1 concrete failure scenario ("bot scans public URL,
finds /sync-spf-tat-to-companies, POSTs empty body, TAT wiped on 500
companies").

Never say "looks good overall" without listing what specifically you
verified. If you didn't check indexes, say so.
<!-- END trackvid-review-rules -->
