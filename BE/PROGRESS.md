# Migration Progress

See [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md) for the plan.
Status: ⬜ not started · 🟡 in progress · 🧪 contract-tested · 🚦 staging cutover · ✅ prod cutover

**API counter:** see [`PROGRESS.txt`](./PROGRESS.txt) (`APIs migrated: X / 497`, per module + full endpoint checklist; regenerate with `node scripts/api-progress.js`)
**Current phase:** 2 — pilot modules (Phase 1 core done in-process; HTTP harness run waits for a non-prod DB)
**Last updated:** 2026-11-17

## Decisions log
| Date | Decision | Notes |
|---|---|---|
| 2026-11-17 | Target assumed NestJS + `@nestjs/platform-fastify` | Waiting for client confirmation |
| 2026-11-17 | Code sharing = option A: submodule `BE/legacy` pinned at legacy `origin/main` d52efb6e | Plan default. `.gitmodules` URL is the credential-free GitHub URL (cloned from the local legacy checkout) |
| 2026-11-17 | NestJS **11** (not 12) | Nest 12 is ESM-only; legacy code is CommonJS and jest/ts-node run CJS. Nest 11.2 already uses Fastify 5.12 |
| 2026-11-17 | Own Mongo connect in `src/core/db/mongo.ts` (same pool/timeouts), not legacy `connectDB()` | legacy `connectDB()` also runs `runMigrations()`; migrations must run in one process only |
| 2026-11-17 | New app refuses DB name `prod` unless `ALLOW_PROD_DB=true` | Stricter than legacy (warn only); prod host sets the flag at cutover. Prevents dev writes to prod |
| 2026-11-17 | Query parser = `qs.parse(s, {allowPrototypes:true, arrayLimit:1000})` | Exact options of Express 4 `parseExtendedQueryString` |
| 2026-11-17 | Imports from legacy via `@legacy/*` alias (tsc-alias rewrites at build, jest moduleNameMapper in tests) | Legacy files compile into `dist/legacy/src`; legacy deps must be installed in `BE/` with the same versions (mongoose 8.24.8, ioredis 5.11.1, …) so there is one mongoose instance |
| 2026-11-17 | Reuse Express's own packages (body-parser 1.20.9, cors 2.8.6, finalhandler 1.3.2, etag 1.8.1, fresh 0.5.2) inside Fastify hooks instead of Fastify plugins | Byte-identical behaviour (error pages, 413/400, preflight headers, ETag) with no reimplementation; verified against a real Express app |
| 2026-11-17 | `Post` wrapper with `HttpCode(200)` | Nest @Post defaults to 201; Express sends 200 |
| 2026-11-17 | Auth guards execute the legacy middleware functions (from the submodule) through an Express req/res adapter instead of re-typed copies | Bodies/status/`req.user` shape identical by construction (incl. quirks like `jwt.verify` errors, `?token=` only on authMiddleware); legacy fixes arrive with the pin bump; one adapter to test |
| 2026-11-17 | Legacy deps installed in `BE/` at the exact versions legacy has installed; `@types/*` limited to legacy's set (no `@types/jsonwebtoken`) | Legacy files compile with our tsc only with the same typings |
| 2026-11-17 | Tests mock Mongoose model reads (`test/support/fake-models.ts`) | Installing mongodb-memory-server (downloads a mongod binary) was denied by the permission system; mocks need no DB |
| 2026-11-17 | Adapter gives raw req/res Express's real prototypes (`express` 4.22.3 is a runtime dep, settings-only app, never listens) | Same as Express's `expressInit`; needed for multer, express-rate-limit (`res.on('finish')`, trust proxy) and streams. Fastify's own reply methods are untouched |
| 2026-11-17 | Ordinary endpoints: native Nest handlers that call legacy models/services; streaming/SSE/download endpoints may run the legacy controller via `runLegacyHandler` | Plan §2 (only HTTP layer rewritten) + §3 item 16; record any other delegation per module with a reason |
| 2026-11-17 | Counter `[x]` = native Nest port + in-process parity spec (`test/modules/<m>.parity.spec.ts`) mounting the REAL legacy router in Express vs the Nest module, 0 diffs, build+tests green | The HTTP harness run against a staging DB is blocked (Blocked #1); in-process parity runs the same legacy code. DB-backed modules use fake model reads; the staging harness run is still required before each cutover (🚦) |
| 2026-11-17 | Tests: jest + ts-jest, Fastify `inject()` for in-process HTTP tests | No DB/network needed for compat tests |
| 2026-11-17 | New app lives in `react-native-boiler-plate/BE`, base branch `nestjs` | User's choice. `FE/` is a sibling folder (not ours); `prompt.txt` + root `.env` are unrelated leftovers, untouched |

## Phase 0–1 (foundation)
| Item | Status | Notes |
|---|---|---|
| Nest scaffold + Fastify adapter | 🧪 | Nest 11.2 / Fastify 5.12, `src/main.ts`, `src/bootstrap.ts`, `GET /` = legacy "Hello World!" |
| Legacy submodule + path aliases | 🧪 | `BE/legacy` @ d52efb6e; `@legacy/*` verified at runtime (`runtimeGuard` import) |
| Staging env (both servers + nginx) | ⛔ | Blocked: needs user (see Session log) |
| core/http (qs, body limits, cors, headers, trust proxy, trailing slash) | 🧪 | `src/core/http/*`. Runs legacy's own middleware (legacy `securityHeaders`, `cors()`, body-parser urlencoded+json 5mb) on raw req/res in legacy order; Fastify body parsers removed. Express weak ETag + 304. Ported controllers must use `Post` from `core/http/routes` (200 default) and set `text/html; charset=utf-8` when legacy does `res.send(string)`. Parity test `test/e2e/express-parity.spec.ts`: 25 cases × prod/dev env, all identical to a real Express app |
| core/errors + envelope | 🟡 | `LegacyExceptionFilter`: 404 → Express `Cannot GET /x` page, body-parser errors/escaped throws → Express finalhandler page, `LegacyResponseException(status, body)` → exact body. Envelope helpers: todo (with first module) |
| core/auth guards (all 11 middlewares) | 🧪 | `src/core/auth`: `@Auth() @NormalAuth() @AdminAuth([..]) @SystemAdmin('system-admin') @SupportAgentAuth() @ExternalClientAuth() @EasyEcomAuth() @GetVideoAuth() @Validate(schema)`, `@Legacy(mw1, mw2)` for mixed chains, `@LegacyReq()` = Express-shaped req (`user`, `companyId`, `role`, …). Guards execute the legacy middleware via `core/legacy/express-adapter`. Parity test `test/e2e/auth-parity.spec.ts`: 40 cases identical to Express. `encryption.middleware` is unused by routes (not wrapped) |
| core/rate-limit (login, forgot-password, generic) | 🧪 | Legacy limiter instances used as-is via `@Legacy(loginRateLimiter, ...)` (express-rate-limit 7.5.1 on native Express res). Create `rateLimiter({...})` once per route at class load, like legacy routes. Parity: login 10-fail + skipSuccessful, forgot 5/h, generic 6/min → identical 429s and RateLimit headers |
| core/upload (multer-compatible) | 🧪 | Legacy `fileUploader`/`logoUploader`/`supportAttachmentUploader` (multer 1.4.5-lts.2) used as-is via `@Legacy(fileUploader.single('file'))`; `req.file(s)` via `@LegacyReq()`. Disk storage writes `./uploads` relative to cwd (same as legacy → run the new server with its own cwd and the same cleanup). Parity: 11 upload cases incl. multer errors |
| core/sse | 🧪 | `runLegacyHandler(req, reply, fn)` hijacks the reply and runs an Express-style handler on native req/res (SSE, download, pipe, redirect). Parity: SSE framing/headers/close teardown, download, redirect, sync throw |
| Contract harness + CI | 🟡 | `test/contract` (`npm run test:contract`, LEGACY_URL/NEW_URL/CONTRACT_DB; write cases refused unless CONTRACT_DB is non-prod). Not run yet: needs both servers on a non-prod DB (Blocked #1). CI: todo (no CI config in repo yet). Meanwhile each module gets an in-process parity spec (legacy Express router vs Nest, fake models) |

## Modules (route counts measured 2026-11-17 by quick grep; exact per-endpoint counts are in PROGRESS.txt, total 497 incl. OrderServer 7 + MasterImportServer 20)
| Phase | Module | Prefix | Routes | Special | Status | Contract cases | Cutover |
|---|---|---|---|---|---|---|---|
| 2 | Common | /api/common | 1 | public, no DB | 🧪 | 6 (parity) | |
| 2 | BaseLink | /api/base-link | 1 | public GET that inserts (legacy quirk, kept) | 🧪 | 7 (parity) + saved-doc check | |
| 2 | plan | /api/plan | 4 | | ⬜ | | |
| 2 | Role | /api/role | 4 | | ⬜ | | |
| 2 | Contact | /api/contacts | 3 | | ⬜ | | |
| 2 | StorageHistory | /api/storage-history | 3 | | ⬜ | | |
| 2 | CreditHistory | /api/credit-history | 1 | | ⬜ | | |
| 2 | ClaimHistory | /api/claim-history | 1 | | ⬜ | | |
| 2 | Account | /api/account | 1 | | ⬜ | | |
| 2 | VideoLink | /api/video-link | 1 | | ⬜ | | |
| 2 | Referral | /api/referrals | 1 | | ⬜ | | |
| 2 | Credits | /api/credit | 2 | | ⬜ | | |
| 3 | Dashboard | /api/dashboard | 11 | | ⬜ | | |
| 3 | Feed | /api/feed | 9 | | ⬜ | | |
| 3 | User | /api/user | 17 | | ⬜ | | |
| 3 | Company | /api/companies | 4 | | ⬜ | | |
| 3 | AppSetting | /api/app-settings | 5 | | ⬜ | | |
| 3 | Notification | /api/notifications | 6 | SSE | ⬜ | | |
| 3 | Template | /api/templates | 8 | | ⬜ | | |
| 3 | TDS | /api/tds | 5 | | ⬜ | | |
| 3 | eCommercePlatform | /api/ecommerce-platform | 5 | | ⬜ | | |
| 3 | ProductSkucodeMap | /api/product-skucode-map | 3 | upload? | ⬜ | | |
| 3 | MasterImportSetting | /api/master-setting | 6 | | ⬜ | | |
| 3 | MarketingSite | /api/marketing-site | 4 | public | ⬜ | | |
| 3 | manualPayment | /api/manual-payment | 8 | | ⬜ | | |
| 3 | razorpay | /api/razorpay | 9 | raw body / signature | ⬜ | | |
| 3 | Files | /api/files | 5 | upload / stream | ⬜ | | |
| 3 | Imports | /api/external-imports | 5 | upload + SSE | ⬜ | | |
| 3 | Webhook | /api/webhooks | 3 | raw body? | ⬜ | | |
| 3 | Email | /api/emails | 19 | | ⬜ | | |
| 3 | Mailbox | /api/mailboxes, /api/mailbox/password | 27 | stream | ⬜ | | |
| 3 | WhatsApp | /api/whatsapp | 16 | | ⬜ | | |
| 3 | SupportChat | /api/support-chat | 15 | SSE + upload | ⬜ | | |
| 3 | GoogleDrive | /api/drive | 4 | stream | ⬜ | | |
| 3 | EasyEcom | /api/easy-ecom | 1 | easy-ecom auth | ⬜ | | |
| 4 | Ajio | /api/ajio | 2 | platform | ⬜ | | |
| 4 | Myntra | /api/myntra | 2 | platform | ⬜ | | |
| 4 | Flipkart | /api/flipkart | 2 | platform | ⬜ | | |
| 4 | TataCliq | /api/tatacliq | 2 | platform | ⬜ | | |
| 4 | Snapdeal | /api/snapdeal | 2 | platform | ⬜ | | |
| 4 | Delhivery | /api/delhivery | 2 | platform | ⬜ | | |
| 4 | Xbees | /api/xbees | 2 | platform | ⬜ | | |
| 4 | Meesho | /api/meesho | 2 | platform | ⬜ | | |
| 4 | Nykaa | /api/nykaa | 2 | platform | ⬜ | | |
| 4 | MasterImport | /api/master | 24 | SSE reports, v2 | ⬜ | | |
| 4 | Order | /api/order | 19 | | ⬜ | | |
| 4 | Auth | /api/auth | 24 | rate limits, all clients | ⬜ | | |
| 5 | CMS | /api/cms | 80 | Trackvid-CMS contract | ⬜ | | |
| 5 | SystemAdmin | /api/system-admin | 74 | Monitor contract | ⬜ | | |
| 5 | Realtime | /internal, /api/internal | 1 | sockets | ⬜ | | |
| 5 | View | /view | 1 | | ⬜ | | |
| 5 | DesktopApp | / (catch-all) | 2 | static downloads, mount last | ⬜ | | |
| 5 | bull-board | /admin/queues | — | | ⬜ | | |
| 5 | Socket.IO (realtime + cms-realtime) | — | — | event contract | ⬜ | | |
| 6 | OrderServer | (separate process) /order | — | uploads | ⬜ | | |
| 6 | MasterImportServer | (separate process) | — | | ⬜ | | |
| 6 | Email-Automation server | (separate process) | — | | ⬜ | | |
| 6 | Workers + crons → Nest worker process | — | — | stop in legacy same deploy | ⬜ | | |
| 6 | Decommission legacy | — | — | | ⬜ | | |

## Session log
| Date | Who | What was done | Next step |
|---|---|---|---|
| 2026-11-17 | Claude | Wrote plan + tracker from legacy analysis; set up in `react-native-boiler-plate/BE` | Phase 0: scaffold Nest + Fastify in `BE/`, legacy submodule, DB connection |
| 2026-11-17 | Claude | Phase 0: branch `migrate/phase0-scaffold`; legacy submodule; Nest 11 + Fastify scaffold; Mongo connector with prod guard; HTTP compat options (qs, trailing slash, case-insensitive, trust proxy, 5MB). `npm run build && npm test` green (10 tests); compiled app smoke-run OK | Phase 1: finish core/http (formbody, empty body, cors, securityHeaders), then core/errors+envelope, core/auth guards |

| 2026-11-17 | Claude | Phase 1 (branch `migrate/phase1-core`): Express-compat pipeline + legacy exception filter; parity test vs real Express app (50 cases) green; build + 60 tests green. APIs migrated: 0 / 497 | core/auth guards (port 11 legacy auth middlewares), then rate-limit, upload, sse |
| 2026-11-17 | Claude | Phase 1: core/auth guards via legacy middleware adapter; auth parity 40 cases green; build + 101 tests green. APIs migrated: 0 / 497 | core/rate-limit (authRateLimit + rateLimit middlewares), core/upload (multer), core/sse; then the trivial-endpoint exit check and Phase 2 pilot |
| 2026-11-17 | Claude | Phase 1: adapter switched to native Express req/res; rate-limit, upload, SSE/stream parity green; build + 120 tests green. APIs migrated: 0 / 497 | Contract harness (`test/contract`, HTTP legacy vs new, needs DB for real runs), then Phase 2 pilot starting with Common |
| 2026-11-17 | Claude | Phase 2: Common ported (native) + Root; parity specs green; build + 134 tests green. APIs migrated: 2 / 497 | BaseLink, then plan, Role, Contact… (Phase 2 order) |
| 2026-11-17 | Claude | BaseLink ported (native); `fakeSave` test helper (validation runs, write stubbed). APIs migrated: 3 / 497 | plan module |

### Blocked (needs user)
1. **No non-prod MongoDB.** No local mongod/docker; legacy `.env` `MONGO_URI` targets DB `prod`. Contract harness and any DB-touching run need a staging/dev DB. Options: (a) put a `dev`-database `MONGO_URI` in `BE/.env.development.local` (legacy notes the `dev` DB lives on the same Atlas cluster), or (b) install MongoDB locally (`brew install mongodb-community`) + seed snapshot. Redis is available locally (PONG).
2. **Staging env + nginx** (both servers side by side) — deployment step, user does it.
