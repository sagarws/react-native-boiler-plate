# Cross-Platform Development Guidelines

The permanent development rulebook for TrackVid CMS. Every change to this
repository is held to this document. It expands on the project-level
[Cross-Platform Development Guidelines.md](../Cross-Platform%20Development%20Guidelines.md)
with the concrete versions and procedures this codebase actually uses.

Last verified: 2026-08-27.

---

## 1. Supported operating systems

| OS | Versions | Status |
| --- | --- | --- |
| Windows | 10 (1809+), 11 | Supported target |
| macOS | 12 Monterey and newer | Supported target |
| Linux | — | Not a target. A fallback platform adapter exists so `npm run dev` works, but Linux is never tested or shipped. |

Minimum OS versions are dictated by the bundled Chromium and must be re-checked
against the Electron release notes at every major Electron upgrade.

## 2. Supported CPU architectures

| Platform | Architectures |
| --- | --- |
| Windows | x64, arm64 |
| macOS | x64 (Intel), arm64 (Apple Silicon), universal |

No architecture-specific code or binary exists in this project. Nothing is
compiled per-architecture, because there are no native modules (§11).

## 3–7. Runtime and language versions

| Component | Version | Why this version |
| --- | --- | --- |
| Electron | 43.4.1 | Stable and inside the supported window (Electron supports the latest three majors). 44.0.0 was available but is three days old with no patch releases — not a base for production. |
| Chromium (bundled) | 150.0.7871.224 | Ships with Electron 43. |
| Node.js (bundled in Electron) | 24.18.1 | Ships with Electron 43. |
| Node.js (development) | >= 22.12.0 | Required by electron-vite 5. Enforced by `engines` in package.json. |
| React | 19.2.8 | Current stable. |
| TypeScript | 5.9.3 | **Deliberately not 7.0.2.** typescript-eslint 8.x declares `typescript >=4.8.4 <6.1.0`; TypeScript 7 would silently disable type-aware linting. Revisit when typescript-eslint supports TS 7. |
| Tailwind CSS | 4.3.3 | Used via the first-party `@tailwindcss/vite` plugin — no PostCSS or Autoprefixer needed. |
| Vite | 7.3.6 | **Deliberately not 8.2.2.** electron-vite 5.0.0 declares `vite ^5 \|\| ^6 \|\| ^7`. Vite 8 support is expected in electron-vite 6 (currently beta). |
| electron-vite | 5.0.0 | Build orchestration for the three Electron targets. |
| electron-builder | 26.15.3 | Packaging and installers. |
| Vitest | 4.1.11 | Unit tests. |
| ESLint | 10.9.1 + typescript-eslint 8.68.0 | Type-aware linting. |

Both version pins above are **compatibility constraints, not staleness**. Do not
"update" past them without first confirming the peer ranges have moved.

## 8. Build system

`electron-vite` builds three separate bundles:

| Target | Entry | Output | Format |
| --- | --- | --- | --- |
| main | `electron/main/main.ts` | `out/main/main.js` | CommonJS |
| preload | `electron/preload/preload.ts` | `out/preload/preload.js` | CommonJS (**required** — a sandboxed preload cannot be an ES module) |
| renderer | `electron/renderer/index.html` | `out/renderer/` | ES modules |

Minification is enabled explicitly in `electron.vite.config.ts`; electron-vite
leaves output unminified by default, which tripled the renderer bundle.

## 9. Packaging strategy

Configured in `electron-builder.yml`.

| Platform | Target | Architectures | Artifact |
| --- | --- | --- | --- |
| Windows | NSIS | x64, arm64 | `TrackVid CMS-<version>-<arch>-setup.exe` |
| macOS | DMG | x64, arm64 | `TrackVid CMS-<version>-<arch>.dmg` |
| macOS | DMG (universal) | universal | via `npm run build:mac:universal` |

`asar: true`, `npmRebuild: false` (nothing to rebuild — no native modules).

**Apple Silicon note:** building the Windows NSIS installer on an arm64 Mac
requires Rosetta 2 — electron-builder's `makensis` is an x86_64 binary and fails
with `spawn Unknown system error -86` without it. Install with
`sudo softwareupdate --install-rosetta --agree-to-license`.

**Cross-compilation limits:** macOS artifacts can only be produced on macOS
(code signing and notarisation require Apple tooling). Windows artifacts can be
produced on macOS only unsigned; signed Windows builds require Windows or a
Windows CI runner. Plan CI accordingly — one runner per target OS.

## 10. Dependency rules

Before adding any package, complete the review template in §22 and record the
result in the PR description. A dependency is only acceptable if it is actively
maintained, has a recent stable release, supports Node and Electron, works on
Windows and macOS on both x64 and arm64, and is not deprecated.

Prefer, in order: an Electron API → a Node.js API → a browser API → an existing
project utility → a new dependency.

The full runtime dependency list is three packages. Every one is justified in
`README.md`.

## 11. Native dependency rules

**This project currently ships zero native modules, and that is a deliberate
architectural asset.** It means no `electron-rebuild` step, no ABI pinning, no
per-architecture prebuilds, no packaging surprises, and no signing complications.

A native module may only be introduced after documenting, in the PR:

1. Why no pure-JavaScript alternative is sufficient.
2. Electron ABI / Node ABI compatibility for the pinned Electron version.
3. Prebuilt binary availability for win32-x64, win32-arm64, darwin-x64, darwin-arm64.
4. Whether `@electron/rebuild` is required, and the resulting build-time cost.
5. Verified production packaging on both platforms (`asarUnpack` needs, `npmRebuild: true`).
6. Signing and notarisation impact (unsigned nested binaries fail notarisation).

Adding one flips `npmRebuild` to `true` in `electron-builder.yml` and requires
one CI runner per target OS.

## 12. Electron security rules

Non-negotiable, enforced in `electron/main/windows/mainWindow.ts`:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`

Additional measures:

- **Content Security Policy** is set twice: a `<meta>` tag in `index.html` and a
  response header in `main.ts`. `object-src 'none'`, `base-uri 'none'`,
  `form-action 'none'`.
- **Navigation is locked down.** `will-navigate` rejects any URL outside the app;
  `setWindowOpenHandler` sends every external link to the system browser and
  denies in-app windows.
- **Permissions are denied by default** via `setPermissionRequestHandler` — this
  app needs no camera, microphone, geolocation or notifications.
- **Single instance lock** prevents two processes writing the same data files.

The renderer has no access to `require`, `process`, `module`, `fs` or
`child_process`. This is verified automatically by `tests/e2e/smoke.cjs`, and
enforced at author time by `no-restricted-imports` / `no-restricted-globals`
rules scoped to `electron/renderer/**` in `eslint.config.mjs`.

## 13. IPC rules

- Channel names live **only** in `shared/constants/channels.ts`. A handler that
  is not listed there throws at registration time, and the preload bridge
  refuses to forward it. Both sides read the same list, so they cannot drift.
- The preload exposes exactly one function, `invoke(channel, payload)`, plus
  static platform data. `ipcRenderer` itself is never exposed.
- Every handler is wrapped by `registerHandler` (`electron/main/ipc/handler.ts`),
  which verifies the sender frame, catches everything, and logs failures.
- Every payload is validated with a Zod schema in the main process. Renderer-side
  validation exists for fast feedback and is **never** treated as a trust boundary.
- Every call resolves to a `Result<T>` — `{ success: true, data }` or
  `{ success: false, error }`. Errors are values; they are never thrown across
  the boundary, and internal details never reach the renderer.

## 14. Filesystem rules

- Never hard-code a path. Never concatenate `/` or `\`.
- Application data: `app.getPath('userData')` + `path.join()`, resolved in
  exactly one place, `electron/main/database/index.ts`.
- Logs: `app.getPath('logs')`.
- Writes are atomic — temp file plus `fs.rename`, which replaces the destination
  on both Windows and POSIX. An interrupted write can never truncate the store.
- Never assume the current working directory or the shape of the user's home
  directory.

## 15. Platform abstraction rules

All operating-system differences live in `electron/main/platform/`:

```
platform/
├── types.ts      PlatformAdapter interface
├── windows.ts    Windows implementation
├── macos.ts      macOS implementation
├── fallback.ts   Linux/unknown, development only
└── index.ts      selects one via process.platform
```

`process.platform` is read **once**, in `index.ts`. No other file in the project
branches on the operating system, and React components never do.

Current differences captured by the adapter: title-bar style (macOS uses
`hiddenInset`), whether closing the last window quits the app (macOS does not),
and the modifier-key label shown to users.

## 16. Database rules

**Current choice: a JSON collection store, not SQLite.**

Rationale: the CRUD workload is a small local record set. The only mainstream
SQLite options for Electron are native modules, which would introduce ABI
pinning, per-architecture prebuilds, an `electron-rebuild` step and notarisation
complications — the single largest cross-platform risk category in an Electron
app — for a workload that does not need a query engine.

Implementation: `electron/main/database/`

- `jsonStore.ts` — atomic, serialised, cached file persistence.
- `queryEngine.ts` — search / filter / sort / paginate over in-memory records.
- `jsonRepository.ts` — generic CRUD with a unique-constraint check.
- `repository.ts` — the `CrudRepository<TEntity, TInput>` interface.

**Migration seam:** services and IPC handlers depend only on `CrudRepository`.
Replacing the storage engine means writing one new class that implements that
interface — no service, IPC or UI code changes.

**When to revisit:** the JSON store loads the whole collection into memory and
rewrites the whole file per mutation. That is correct up to roughly the low tens
of thousands of records. Past that, or as soon as multi-table joins, transactions
or full-text search are needed, move to SQLite and complete the §11 native
module review first.

## 17. API rules

The app currently makes no network requests, and the CSP forbids them
(`connect-src 'self'`).

If a backend is added:

- One centralised API service. No `fetch` calls scattered through components.
- Handle timeout, offline, auth failure, and retry with backoff explicitly.
- Requests are made from the **main process**, not the renderer, so credentials
  never enter renderer memory and the CSP stays closed.
- Never store secrets in renderer code or in a `.env` file shipped inside the
  app — anything inside an asar archive is readable by the user.

## 18. Logging rules

- One logger: `electron/main/services/logger.ts`.
- Writes to `app.getPath('logs')` — never a hard-coded location.
- A single append stream is reused; a logging failure disables file logging
  rather than crashing the app.
- Level is `debug` in development, `info` in packaged builds.
- Console output only when not packaged.
- Errors are logged with detail; the renderer receives only a safe message.

## 19. Performance rules

- No polling anywhere in the codebase.
- Every timer and listener is cleaned up: the toast provider clears all pending
  timeouts on unmount; the debounce hook clears its timer; the list effect
  invalidates superseded requests with an `active` flag.
- Search input is debounced (300 ms) so typing is not one IPC call per keystroke.
- Stale IPC responses can never render: `useCrudResource` tags each snapshot with
  its request key and derives `loading` from it, rather than calling `setState`
  synchronously inside an effect.
- The renderer bundle is minified and measured (see README).
- Pagination caps `pageSize` at 200 server-side, so no query can return an
  unbounded result set.

## 20. Testing rules

| Layer | Command | Covers |
| --- | --- | --- |
| Type safety | `npm run typecheck` | Main/preload/shared and renderer, both strict |
| Lint | `npm run lint` | Type-aware rules, renderer Node-access bans |
| Design tokens | `npm run verify:tokens` | Fails when a colour, size or radius is written outside `electron/renderer/styles/theme.css` |
| Unit | `npm test` | Query engine, validation schemas, atomic store, repository, the palette derivation |
| End-to-end | `npm run test:e2e` | Boots the real app; asserts no Node leakage into the renderer, and a full create/duplicate/invalid/update/search/delete round trip through the real preload + IPC + storage path |

`npm run verify` runs typecheck + lint + tokens + unit.

**`test:e2e` needs a global `WebSocket`.** Node 22 has one; on Node 20 the script
passes `--experimental-websocket`, which a newer Node ignores.

### Appearance

The renderer's visual constants live in ONE file, `styles/theme.css`, and
`verify:tokens` is what keeps them there — see CLAUDE.md's UI/UX section for the
token vocabulary. Two rules matter outside the renderer:

- **Overrides persist through the preferences service**, never localStorage. On
  a packaged build the renderer runs from a `file://` origin where web storage is
  easy to lose, and the point of `userData` is that an auto-update does not touch
  it. Everything stored is sanitised on the way in and on the way out, because
  the file outlives the build that wrote it.
- **The window paints the operator's own page colour at launch** (`mainWindow`),
  hex only — Electron's `backgroundColor` rejects `oklch()`. A customised install
  that flashed the stock grey on every launch would be the same bug the stored
  theme already fixed, one layer further in.

**Development-mode testing is never sufficient.** Before merging, state
explicitly which of the following were exercised and which were not:

- [ ] Development mode
- [ ] Production build (`npm run build`)
- [ ] Packaged installer (`npm run build:win` / `build:mac`)
- [ ] Windows x64
- [ ] Windows arm64
- [ ] macOS Intel
- [ ] macOS Apple Silicon

## 21. Code signing rules

| Platform | Requirement |
| --- | --- |
| Windows | Authenticode. `CSC_LINK`, `CSC_KEY_PASSWORD` from environment/CI secrets. |
| macOS | Developer ID signing plus notarisation. `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. |

`hardenedRuntime: true` and `build/entitlements.mac.plist` are already
configured — both are prerequisites for notarisation. The entitlements grant
only `allow-jit` and `allow-unsigned-executable-memory`, which Electron requires.

**Credentials are never committed.** Not in this repo, not in `.env`, not in
`electron-builder.yml`.

## 22. Auto-update rules

Not yet implemented. The architecture is ready for it and the decision is
recorded here so it is not made ad hoc later.

**Selected updater when it is built: `electron-updater`** (the electron-builder
companion), because it consumes the NSIS and DMG artifacts this project already
produces, is maintained by the same project as the packager, and is pure
JavaScript.

Platform requirements to verify at that point:

- Windows: NSIS differential updates; the installer must be signed or Windows
  SmartScreen will block it.
- macOS: updates require a signed **and notarised** app; Squirrel.Mac will refuse
  an unsigned update. A universal build updates as one artifact.
- Both: a release feed (GitHub Releases, S3, or a generic server) must be
  configured in `electron-builder.yml` under `publish`.

The update flow must support version checking, download, user notification,
installation on quit, and explicit error handling with rollback. Never implement
updates with ad-hoc download-and-replace scripts.

## 23. Dependency upgrade procedure

Dependencies are pinned to exact versions on purpose. Never bulk-upgrade.

For a major upgrade:

1. Read the release notes and the migration guide.
2. Identify breaking changes affecting this codebase.
3. Verify Electron compatibility (and the peer ranges in §3–7).
4. Verify Node compatibility.
5. Check for new or changed native dependencies.
6. `npm run verify`
7. `npm run test:e2e`
8. `npm run build:win` on Windows.
9. `npm run build:mac` on macOS.
10. Install and launch both production installers.

For an **Electron** major upgrade, additionally re-check the minimum supported
Windows and macOS versions (§1) and update this document.

### Dependency review template

Paste into the PR for any new package:

```
Package:
Purpose:
Version:
Maintainer status:
Last release:
Node compatibility:
Electron compatibility:
Windows support:
macOS support:
Native dependency:
Architecture support (x64 / arm64):
Alternative considered (Electron / Node / browser API / existing utility):
Reason the alternative is insufficient:
```

## 24. Release checklist

**Pre-release**

- [ ] `npm run verify` passes
- [ ] `npm run test:e2e` passes
- [ ] Version bumped in `package.json`
- [ ] `build/icon.ico` and `build/icon.icns` present (see `build/README.md`)
- [ ] No credentials committed; signing secrets present in the CI environment

**Per feature in the release** (the §16 checklist from the root guidelines)

- [ ] Cross-platform compatible
- [ ] No hard-coded paths
- [ ] No unnecessary, deprecated, or unsupported dependency
- [ ] IPC validated and on the shared channel allowlist
- [ ] Error, loading and empty states implemented
- [ ] Listeners and timers cleaned up

**Build**

- [ ] `npm run build:win` on Windows → x64 and arm64 NSIS installers
- [ ] `npm run build:mac` on macOS → x64 and arm64 DMGs
- [ ] Windows artifacts Authenticode-signed
- [ ] macOS artifacts signed and notarised (`xcrun stapler validate`)

**Verify the packaged artifacts, not the dev build**

- [ ] Installs and launches on Windows 10/11 x64
- [ ] Installs and launches on Windows arm64
- [ ] Installs and launches on macOS Intel
- [ ] Installs and launches on macOS Apple Silicon
- [ ] Full CRUD round trip works in the installed app on each platform
- [ ] Data persists across restart, in the correct per-platform userData location
- [ ] Uninstall leaves no orphaned processes

## 25. Golden rule

Never decide anything on the basis of "it works on my computer."

Every decision weighs: Windows + macOS, x64 + arm64, Electron compatibility,
Node compatibility, package maintenance, security, performance, production
packaging, and long-term maintainability.
