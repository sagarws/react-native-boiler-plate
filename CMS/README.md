# TrackVid CMS

A cross-platform Electron desktop CMS with a reusable CRUD architecture, built
for Windows (x64/arm64) and macOS (Intel/Apple Silicon) from day one.

The permanent rulebook for this project is
[`docs/CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md`](docs/CROSS_PLATFORM_DEVELOPMENT_GUIDELINES.md).
Read it before changing anything.

---

## Quick start

```bash
npm install
npm run dev
```

> **Note:** this npm version gates package install scripts. If `npm run dev`
> fails with a missing Electron binary, run `node node_modules/electron/install.js`
> once, or approve the scripts with `npm approve-scripts`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development with hot reload |
| `npm run typecheck` | Strict type-check, main and renderer separately |
| `npm run lint` | Type-aware ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Boots the real app and drives a full CRUD round trip |
| `npm run verify` | typecheck + lint + unit tests |
| `npm run build` | Verify, then build all three bundles |
| `npm run build:unpack` | Unpacked app directory (fast packaging check) |
| `npm run build:win` | Windows NSIS installers, x64 + arm64 |
| `npm run build:mac` | macOS DMGs, x64 + arm64 |
| `npm run build:mac:universal` | macOS universal DMG |

Per-architecture variants also exist: `build:win:x64`, `build:win:arm64`,
`build:mac:x64`, `build:mac:arm64`.

macOS artifacts can only be built on macOS. Signed Windows artifacts require
Windows. Use one CI runner per target OS.

### Building the Windows installer on an Apple Silicon Mac

electron-builder packages the Windows app fine, but the final NSIS step runs
`makensis`, which ships as an **x86_64** binary. On Apple Silicon without
Rosetta 2 it fails with `spawn Unknown system error -86` (EBADARCH). Install
Rosetta once:

```bash
sudo softwareupdate --install-rosetta --agree-to-license
```

Note this only produces an **unsigned** installer. Authenticode signing requires
Windows or a Windows CI runner.

### Installing an unsigned macOS build

Local builds are unsigned, so Gatekeeper blocks the first launch. Either
right-click the app → **Open**, or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/TrackVid CMS.app"
```

## Architecture

```
electron/
├── main/                  Node/Electron process
│   ├── main.ts            Entry: security, lifecycle, bootstrap
│   ├── windows/           BrowserWindow factory
│   ├── ipc/               Channel registration + validation wrapper
│   ├── services/          Logger, generic CrudService
│   ├── database/          Store, query engine, repositories
│   └── platform/          The ONLY place that reads process.platform
├── preload/               contextBridge: one invoke() function, nothing else
└── renderer/              React + Tailwind, no Node access
    ├── components/{ui,data,feedback}
    ├── pages/members/
    ├── hooks/             useCrudResource, useDebouncedValue, useToast
    ├── layouts/
    ├── services/          ipcClient, generic crudClient
    └── utils/

shared/                    Imported by BOTH processes
├── types/                 Result, ListQuery, Member, IPC contract
├── constants/             Channel allowlist (single source of truth)
└── validation/            Zod schemas used by both sides

tests/                     Unit tests + tests/e2e/ harness
build/                     Packaging assets (icons, entitlements)
docs/                      Development rulebook
```

### Data flow

```
React component
  → hooks/useCrudResource        list state, debounce, stale-response guard
  → services/crudClient          typed per-namespace client
  → services/ipcClient           the one place touching window.trackvid
  → preload bridge               channel allowlist check
  → ipc/handler.ts               sender check, error containment
  → ipc/crud.ipc.ts              generic CRUD channel registration
  → services/crudService.ts      Zod validation, error mapping, logging
  → database/jsonRepository.ts   CRUD + unique constraint
  → database/jsonStore.ts        atomic, serialised file writes
```

### Adding a new CRUD module

The CRUD layer is generic; a new entity needs no new plumbing.

1. `shared/types/<entity>.ts` — the entity and its input type.
2. `shared/validation/<entity>.schema.ts` — the Zod input schema.
3. `shared/constants/channels.ts` — add the namespace to `IPC_CHANNELS`.
4. `electron/main/database/index.ts` — one `JsonRepository` with its searchable,
   sortable and filterable fields.
5. `electron/main/services/<entity>.service.ts` — one `CrudService`.
6. `electron/main/ipc/index.ts` — one `registerCrudIpc(namespace, getService)`.
7. `electron/renderer/services/<entity>.service.ts` — one `createCrudClient`.
8. A page that calls `useCrudResource` and renders `DataTable`.

Steps 4–7 are one line each. The reusable components (`DataTable`, `Modal`,
`ConfirmDialog`, `Pagination`, `SearchInput`, `FilterSelect`, `FormField`,
`Button`, `Input`, `Select`, `Badge`, loading/empty/error states) are entity-agnostic.

## Dependencies

Runtime — three packages, each with a reason:

| Package | Version | Why | Native? |
| --- | --- | --- | --- |
| `react` | 19.2.8 | UI framework (required by the brief) | No |
| `react-dom` | 19.2.8 | React renderer for the DOM | No |
| `zod` | 4.4.3 | Schema validation shared by both processes. Validated IPC input is a security requirement; hand-rolled validators duplicated across the boundary are the error-prone alternative. Zero transitive dependencies. | No |

**No native modules.** No `electron-rebuild` step, no per-architecture
prebuilds, no ABI pinning, no notarisation complications.

Deliberately **not** installed, with the built-in used instead:

| Not installed | Used instead |
| --- | --- |
| `electron-log` | ~70-line logger over `app.getPath('logs')` + `fs` |
| `better-sqlite3` / `sql.js` | Atomic JSON store behind a swappable repository interface |
| A UI component library | Tailwind components in `components/ui/` |
| A modal/focus-trap library | Native `<dialog>` (focus trap, Escape, top layer built in) |
| A toast library | ~60-line provider with timer cleanup |
| `uuid` | `node:crypto` `randomUUID()` |
| `axios` | Nothing — the app makes no network requests |
| `electron-updater` | Not needed yet; the decision is recorded in the guidelines |

## Storage

Records live in `<userData>/data/members.json`:

- Windows: `%APPDATA%\trackvid-cms\data\members.json`
- macOS: `~/Library/Application Support/trackvid-cms/data/members.json`

Resolved via `app.getPath('userData')` — never hard-coded. Writes are atomic
(temp file + rename) and serialised, so concurrent operations cannot interleave
and an interrupted write cannot truncate the file.

## Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP set in
both the document and response headers, navigation locked to the app, external
links routed to the system browser, all permission requests denied, single
instance lock.

The renderer cannot reach `require`, `process`, `module`, `fs` or
`child_process`. This is asserted by `npm run test:e2e` and enforced at author
time by ESLint rules scoped to `electron/renderer/**`.

## Verified on this machine

macOS 15 (Darwin 25.5.0), Apple Silicon (arm64), Node 24.19.0, 2026-08-27:

- `npm run typecheck` — passes
- `npm run lint` — passes, 0 problems
- `npm test` — 27 tests passing
- `npm run test:e2e` — passes (app boots; no Node leakage; create, duplicate
  rejection, validation rejection, update, search+filter, unknown-channel block,
  delete, and persistence all verified through the real IPC path)
- `npm run build` — passes; renderer bundle 275 kB raw / 84 kB gzip

Not yet verified — no access to these platforms from this machine:

- Windows x64, Windows arm64 (development or packaged)
- macOS Intel
- Packaged installers on any platform (`build:win`, `build:mac`)
