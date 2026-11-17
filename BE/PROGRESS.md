# Migration Progress

See [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md) for the plan.
Status: ⬜ not started · 🟡 in progress · 🧪 contract-tested · 🚦 staging cutover · ✅ prod cutover

**API counter:** see [`PROGRESS.txt`](./PROGRESS.txt) (`APIs migrated: X / 497`, per module + full endpoint checklist; regenerate with `node scripts/api-progress.js`)
**Current phase:** 5 done in-process (except Realtime/sockets, which move at the coordinated socket cutover); MasterImport blocked; next Phase 6 secondary servers. Cutovers wait for staging (Blocked #1/#2) (Phase 1 core done in-process; HTTP harness run waits for a non-prod DB)
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
| 2026-11-17 | Parity specs for DB modules run on `test/support/memory-db.ts`: Mongoose driver-collection methods replaced by an in-memory store (mingo 6.4.15 for query/update/aggregate) | Real Mongoose casting/defaults/hooks/hydration run on both sides; each case starts from the same snapshot and compares the DB state legacy vs new left behind |
| 2026-11-17 | `core/envelope` `ok()/fail()` keep legacy key order `isSuccess, message, displayMessage, data` | Key order changes body bytes and ETag |
| 2026-11-17 | Delegation rule: when a legacy controller's logic sits in large non-exported helpers (StorageHistory: ~800 lines), the Nest route keeps routing/guards and runs the legacy handler via `runLegacyHandler` instead of copying it | Copying forks the code; extracting a service needs a legacy PR (user approval). Listed under "Legacy PRs wanted" below |
| 2026-11-17 | `express` moved to runtime dependencies | It was dev-only by mistake; `npm ci --omit=dev` would have crashed at boot (adapter imports it) |
| 2026-11-17 | Global jest setup fakes `nodemailer.createTransport` | Legacy `utils/mail.ts` opens an SMTP connection at import (`transporter.verify`); no test may reach a mail server or send mail |
| 2026-11-17 | Delegation widened: large legacy controllers (aggregation-heavy, module-level state such as caches) are delegated by default via `core/legacy/delegate.ts`; native rewrites only where small or where Nest-specific behaviour is needed | Two copies of thousands of lines would drift during a months-long migration (plan §8 risk). Routing, auth guards, parsing, errors are Nest/Fastify. Phase 6 moves handler code in when the submodule goes away. Reversible per module |
| 2026-11-17 | `main.ts` imports `@legacy/utils/logger` | Same console→winston override as legacy server.ts, so log lines look the same to ops |
| 2026-11-17 | Fastify `clientErrorHandler` = Node's built-in raw responses (400/408/413/431, `Connection: close`, empty body) | Express adds no clientError listener; Fastify's default sends JSON. Raw-socket parity test added |
| 2026-11-17 | Nest `main.ts` starts legacy `startNotificationStream()` (read-only Mongo change stream → SSE clients of this process) | Without it SSE clients on the new server get the initial list but no live inserts. It writes nothing and runs no jobs, so it is not a worker/cron; legacy keeps its own for its own clients. Read/archive pushes (`notifyCompany`) are per-process — fine because the whole /api/notifications prefix cuts over together |
| 2026-11-17 | **Nest process cwd = legacy root equivalent** (`BE/dist/legacy` compiled, `BE/legacy` in dev), set in main.ts | Legacy mixes cwd-relative paths (multer `uploads/`, uploadsCleanup) with `__dirname`-relative ones (`utils/files.ts` → `__dirname/../../uploads`). With cwd = BE they diverge and every upload flow would 500 (ENOENT) in prod; tests hid it because both sides failed identically. Unit test checks both layouts; TDS upload success path now covered |
| 2026-11-17 | main.ts installs legacy's `uncaughtException`/`unhandledRejection` loggers | Without them Node crashes the process on any unhandled rejection inside delegated legacy code |
| 2026-11-17 | Async rejection in a delegated handler/middleware leaves the request open + logs `[UNHANDLED REJECTION]` (was: 500 page) | Exactly Express 4 behaviour (contract). Parity runner treats "both sides hung" as a match |
| 2026-11-17 | main.ts runs legacy `runUploadsCleanupOnBoot` + `startUploadsCleanupInterval` | Per-process scratch cleanup of this server's own uploads/ dir (legacy's filled a disk to 169 GB once); no shared state, nothing duplicated |
| 2026-11-17 | Importing legacy BullMQ **producers** (`new Queue(...)`) is allowed; **workers** are not | A producer only enqueues into the shared Redis queue; legacy's worker still consumes each job once. Workers would double-process |
| 2026-11-17 | Jest safety net: loopback-only network guard (`net.Socket.connect`), `puppeteer.launch` refused, nodemailer faked; S3 `uploadObject` and `Queue.add` stubbed per spec | Delegated legacy code calls marketplaces, GitHub, Meta, S3, SMTP; no test may reach them |
| 2026-11-17 | razorpay: no `rawBody` capture | Plan §5 assumed raw-body signatures, but legacy HMACs `JSON.stringify(req.body)` after body-parser. Same body-parser here ⇒ identical digest; tested with a pretty-printed signed body |
| 2026-11-17 | Express wildcard params (`/:key(*)`) rebuilt from the raw URL (`core/http/express-wildcard.ts`) | Fastify's `*` decodes/matches differently; Express gives `{0, key}`, decodes `%2F`, matches the bare prefix with key "" and needs the slash after a sub-prefix |
| 2026-11-17 | Fastify `frameworkErrors` → Express behaviour for malformed URLs (after running the legacy app middleware) | Express only decodes params: bad escape in a param → 400 URIError page, elsewhere → 404 page |
| 2026-11-17 | Realtime: new server owns no sockets; legacy `realtime.service` forwards emits to `REALTIME_INTERNAL_URL` (legacy /internal/realtime/broadcast) | Plan §2 mechanism; env keys added to `.env.example` |
| 2026-11-17 | Tests connect to the local Redis (REDIS_PORT default 6379); ioredis clients tracked and closed per test file | Legacy modules open Redis connections at import. Suite now ~70 s |
| 2026-11-17 | Route controllers generated from legacy route files (`scripts/gen-nest-controller.js`), cross-checked against PROGRESS.txt (`scripts/check-generated-routes.js`) | Same paths/methods/middleware chains by construction; the generator refuses wildcard/regex paths, Express order shadowing, duplicates and router.use (reported for hand-porting). Run over all remaining route files: no warnings |
| 2026-11-17 | Route-smoke parity (`test/support/route-smoke.ts`): every route × {anon, admin, sysadmin, other token} vs legacy, response + DB | Broad coverage for generated modules; targeted success-path specs on top where data matters |
| 2026-11-17 | Automated guard `test/e2e/no-legacy-workers.spec.ts` + `scripts/scan-import-side-effects.js` | Fails the suite if anything the Nest app imports starts a worker/cron/socket at import (hard rule). Found masterImportWorker.ts |
| 2026-11-17 | `express.static('public')` runs in the legacy app-middleware chain (after body parsers, before routes) | Exact legacy order and serve-static headers/ETag/304 (compat item 18). Parity-tested |
| 2026-11-17 | Build copies `legacy/views` + `legacy/public` into `dist/legacy` (`scripts/copy-legacy-assets.js`) | Legacy renders `ejs.renderFile("views/…")` and serves `public/` relative to cwd (= dist/legacy). Without it, register/forgot-password/payment/book-demo mails and invoices would fail in prod |
| 2026-11-17 | `test/e2e/generated-controllers-fresh.spec.ts` + `scripts/regen-controllers.js` | Regenerating from the current legacy route files must reproduce every generated controller; a pin bump that changes routes/middleware/helpers fails the suite until regenerated |
| 2026-11-17 | XLSX downloads compared by parsed workbook content in parity tests | ZIP entries carry 2-second timestamps; byte comparison was flaky |
| 2026-11-17 | Express compat is per-app (`registerExpressCompat(fastify, { chain, expressApp })`) | OrderServer has different app middleware and Express settings than the main server; both apps can run in one process (tests) |
| 2026-11-17 | OrderServer HTTP ported as a separate Nest entry point, workers excluded | Plan §6; nginx can move /order to it while legacy OrderServer keeps running only for its workers |
| 2026-11-17 | **User decision: no changes to the legacy project.** The "Legacy PRs wanted" list stays informational only | User, 2026-11-17. Consequence: MasterImport goes with option (b) — a constants shim on the Nest side, guarded by a test; legacy security issues remain in legacy and are reproduced by the port unless the user asks to change them on the new side |
| 2026-11-17 | Worker shims: `src/core/runtime/shims` redirects `require` of legacy files that start a worker at import (today: masterImportWorker.ts) to a constants-only shim; loaded first in main.ts, same mapping in jest | User chose no legacy changes. Verified on the built app: the real worker file is never loaded. `test/e2e/worker-shims.spec.ts` compares the shim with the real module (BullMQ stubbed) |
| 2026-11-17 | Parity runner: when only ONE side looks hung, rerun the case once with an 8× longer wait | Slow handlers under full-suite load were reported as hangs (flaky); real hangs never answer |
| 2026-11-17 | Local contract setup: legacy runs from the submodule via `npm run legacy:local` with a hand-built local-only env (never the legacy prod `.env`; refuses non-local/prod DBs); `npm run seed:local` seeds `trackvid_dev` + tokens; cases = every migrated main-server endpoint (`test/contract/cases/AllMigrated.cases.ts`) | User provided local MongoDB; no prod credentials in any process |
| 2026-11-17 | Env loaded by a first-import module (`src/config/load-env.ts`) in both entry points | Found by the live contract run: legacy modules read process.env at load time (S3 bucket/region…); loading env in main() body was too late. Order guarded by `src/config/load-env.spec.ts` |
| 2026-11-17 | Graceful shutdown in both entry points (`installGracefulShutdown`) | Found by the live run: legacy config/redis.ts adds SIGINT/SIGTERM listeners, so without an exiting handler the process ignored stop signals (PM2 reload would hang) |
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
| Contract harness + CI | 🧪 (CI todo) | `test/contract` (`npm run test:contract`, LEGACY_URL/NEW_URL/CONTRACT_DB; write cases refused unless CONTRACT_DB is non-prod). Not run yet: needs both servers on a non-prod DB (Blocked #1). CI: todo (no CI config in repo yet). Meanwhile each module gets an in-process parity spec (legacy Express router vs Nest, fake models) |

## Modules (route counts measured 2026-11-17 by quick grep; exact per-endpoint counts are in PROGRESS.txt, total 497 incl. OrderServer 7 + MasterImportServer 20)
| Phase | Module | Prefix | Routes | Special | Status | Contract cases | Cutover |
|---|---|---|---|---|---|---|---|
| 2 | Common | /api/common | 1 | public, no DB | 🧪 | 6 (parity) | |
| 2 | BaseLink | /api/base-link | 1 | public GET that inserts (legacy quirk, kept) | 🧪 | 7 (parity) + saved-doc check | |
| 2 | plan | /api/plan | 4 | adminAuth read, systemAdmin writes | 🧪 | 22 (parity, response + DB state) | |
| 2 | Role | /api/role | 4 | adminAuth manage_roles; lazy system-role upsert | 🧪 | 24 (parity, response + DB) | |
| 2 | Contact | /api/contacts | 2 | authMiddleware; legacy validateRequest via @Legacy (PUT update commented out in legacy) | 🧪 | 10 (parity) | |
| 2 | StorageHistory | /api/storage-history | 3 | systemAdmin reports; **delegated** to legacy handlers (private helpers); ⚠ public mass-write `GET /add-storage-history` | 🧪 | 11 (parity) + success-path asserts | |
| 2 | CreditHistory | /api/credit-history | 1 | authMiddleware; aggregation ($lookup/$facet) | 🧪 | 10 (parity) | |
| 2 | ClaimHistory | /api/claim-history | 1 | adminAuth cms::view; populate | 🧪 | 5 (parity) | |
| 2 | Account | /api/account | 1 | authMiddleware | 🧪 | 3 (parity) | |
| 2 | VideoLink | /api/video-link | 1 | adminAuth + per-user rate limiter (same options, redeclared: not exported in legacy) | 🧪 | 8 + 429 check | |
| 2 | Referral | /api/referrals | 1 | authMiddleware; lazily writes referralCode | 🧪 | 3 (parity) | |
| 2 | Credits | /api/credit | 1 | ⚠ legacy route hangs (adminAuth factory used as middleware) — reproduced | 🧪 | hang check | |
| 3 | Dashboard | /api/dashboard | 11 | delegated (2,190 lines aggregation; insights per-process cache) | 🧪 | 16 (parity) | |
| 3 | Feed | /api/feed | 9 | delegated; ⚠ legacy scoping issues (see Legacy PRs) | 🧪 | 17 (parity, response + DB) | |
| 3 | User | /api/user | 17 | delegated; ⚠ /members + /delete hang (factory bug), /upload-logo has no auth | 🧪 | 22 + 2 hang checks | |
| 3 | Company | /api/companies | 4 | delegated; ⚠ public PUT /update-claims rewrites all companies | 🧪 | 7 + risk check | |
| 3 | AppSetting | /api/app-settings | 5 | delegated; increff-qc-mapping chain authMiddleware+systemAdminAuth (no token passes both) | 🧪 | 8 (parity) | |
| 3 | Notification | /api/notifications | 6 | SSE (?token=); delegated; change stream started in main.ts | 🧪 | 11 + SSE initial/push | |
| 3 | Template | /api/templates | 8 | delegated; handlers lack try/catch → async errors hang (reproduced) | 🧪 | 13 (parity) | |
| 3 | TDS | /api/tds | 5 | delegated; upload + Joi chains; S3 stubbed in tests | 🧪 | 8 (parity, incl. upload success path) | |
| 3 | eCommercePlatform | /api/ecommerce-platform | 5 | delegated; logo upload | 🧪 | 5 (parity) | |
| 3 | ProductSkucodeMap | /api/product-skucode-map | 3 | delegated; BullMQ producer (worker stays in legacy); upload before auth (legacy quirk) | 🧪 | 3 (parity) | |
| 3 | MasterImportSetting | /api/master-setting | 6 | delegated (1,718 lines, puppeteer/axios logins) | 🧪 | 7 (parity) | |
| 3 | MarketingSite | /api/marketing-site | 4 | public; per-route 6/min limiters; Meta/GitHub calls | 🧪 | 3 + 429 check | |
| 3 | manualPayment | /api/manual-payment | 8 | delegated (1,772 lines); xlsx/invoice downloads | 🧪 | 10 (parity) | |
| 3 | razorpay | /api/razorpay | 8 | delegated; signatures = HMAC(JSON.stringify(parsed body)) → no raw body needed; signed webhooks parity-tested | 🧪 | 14 (parity) | |
| 3 | Files | /api/files | 5 | delegated; Express `:key(*)` params rebuilt from raw URL; public get/delete (legacy) | 🧪 | 17 (parity) | |
| 3 | Imports | /api/external-imports | 5 | delegated; BullMQ producers; public SSE polls shared Redis | 🧪 | 5 + SSE | |
| 3 | Webhook | /api/webhooks | 3 | public; realtime emits forwarded to legacy via REALTIME_INTERNAL_URL | 🧪 | 4 (parity) | |
| 3 | Email | /api/emails | 19 | generated + delegated | 🧪 | route-smoke 19×4 | |
| 3 | Mailbox | /api/mailboxes, /api/mailbox/password | 27 | generated + delegated; imports mailboxWorker module (workers only start via startMailboxWorkers — not called) | 🧪 | route-smoke 27×4 | |
| 3 | WhatsApp | /api/whatsapp | 16 | generated + delegated | 🧪 | route-smoke 16×4 | |
| 3 | SupportChat | /api/support-chat | 26 | generated + delegated; SSE registry is per-process — whole prefix must cut over together | 🧪 | route-smoke 26×4 | |
| 3 | GoogleDrive | /api/drive | 4 | generated + delegated (OAuth) | 🧪 | route-smoke 4×4 | |
| 3 | EasyEcom | /api/easy-ecom | 1 | generated + delegated | 🧪 | route-smoke 1×4 | |
| 4 | Ajio | /api/ajio | 2 | generated; `modules/platforms/ajio/` | 🧪 | route-smoke | |
| 4 | Myntra | /api/myntra | 2 | generated; `modules/platforms/myntra/` | 🧪 | route-smoke | |
| 4 | Flipkart | /api/flipkart | 2 | generated; `modules/platforms/flipkart/` | 🧪 | route-smoke | |
| 4 | TataCliq | /api/tatacliq | 2 | generated; `modules/platforms/tatacliq/` | 🧪 | route-smoke | |
| 4 | Snapdeal | /api/snapdeal | 2 | generated; `modules/platforms/snapdeal/` | 🧪 | route-smoke | |
| 4 | Delhivery | /api/delhivery | 2 | generated; `modules/platforms/delhivery/` | 🧪 | route-smoke | |
| 4 | Xbees | /api/xbees | 2 | generated; `modules/platforms/xbees/` | 🧪 | route-smoke | |
| 4 | Meesho | /api/meesho | 2 | generated; `modules/platforms/meesho/` | 🧪 | route-smoke | |
| 4 | Nykaa | /api/nykaa | 2 | generated; `modules/platforms/nykaa/` | 🧪 | route-smoke | |
| 4 | MasterImport | /api/master | 25 | generated; legacy masterImportWorker.ts replaced by a constants shim in the Nest process (`src/core/runtime/shims`, drift-tested) so no worker starts | 🧪 | route-smoke 25×3 | |
| 4 | Order | /api/order | 19 | generated + delegated | 🧪 | route-smoke 19×3 | |
| 4 | Auth | /api/auth | 24 | generated; login/rate-limit/revocation targeted tests; ⚠⚠ DO NOT CUT OVER until legacy fixes user-profile token leak | 🧪 | route-smoke 24×3 + 8 targeted | |
| 5 | CMS | /api/cms | 81 | generated + delegated; route-file helpers copied verbatim (freshness test guards drift); Trackvid-CMS desktop must be coordinated at cutover | 🧪 | route-smoke 81×3 | |
| 5 | SystemAdmin | /api/system-admin | 71 | generated + delegated; Monitor contract | 🧪 | route-smoke 71×3 | |
| 5 | Realtime | /internal, /api/internal | 2 | NOT ported: the broadcast receiver must live with Socket.IO (new server forwards emits here; moving it alone would loop). Moves with the socket cutover | ⏸ | | |
| 5 | View | /view | 1 | generated + delegated | 🧪 | route-smoke | |
| 5 | DesktopApp | / (catch-all) | 2 | generated; `/:filename` reads `<cwd>/cmsapp` → on the new server `BE/dist/legacy/cmsapp` must hold (or symlink) the installers | 🧪 | route-smoke + catch-all cases | |
| 5 | bull-board | /admin/queues | — | | ⬜ | | |
| 5 | Socket.IO (realtime + cms-realtime) | — | — | event contract | ⬜ | | |
| 6 | OrderServer | (separate process) /order | 7 | second Nest app `src/order-server` (`node dist/src/order-server/main.js`, ORDER_SERVER_PORT, default 8101); its own Express settings (x-powered-by on, no trust proxy, 100kb bodies); orderWorker/whatsappWorker/bull-board stay in legacy OrderServer until the worker cutover | 🧪 | 14 smoke + 8 edge/stream | |
| 6 | MasterImportServer | (separate process) | 20 | ⛔ same worker-import blocker as MasterImport; its v2 HTTP routes also drive in-process pipeline state (triggerDeferredFile, file trackers) → likely must move together with its workers/crons in the worker cutover | ⛔ | | |
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
| 2026-11-17 | Claude | plan ported (native) + memory-db harness for DB modules + envelope helpers. Jest gotcha: `it.each` rows shorter than the callback arity get jest's `done` → use defaults (`opts = {}`). APIs migrated: 7 / 497 | Role module |
| 2026-11-17 | Claude | Role ported (native). Legacy issues kept as-is (contract), for a later legacy PR: `GET /api/role/get-role/:id` is not company-scoped (returns another company's role); `get-roles?email=` filters Role on a non-existent `email` field. APIs migrated: 11 / 497 | Contact module |
| 2026-11-17 | Claude | Contact ported (native, 2 live routes). APIs migrated: 13 / 497 | StorageHistory |
| 2026-11-17 | Claude | ClaimHistory + CreditHistory ported (native). memory-db: all mingo operators loaded, `seedRaw` for $lookup sources, `$count` rewritten to Mongo semantics (empty → no doc). APIs migrated: 15 / 497 | StorageHistory (3 routes, 998-line controller) |
| 2026-11-17 | Claude | StorageHistory ported (route+guards native, handlers delegated). memory-db: `$lookup` with let/pipeline + `$facet` implemented. APIs migrated: 18 / 497 | Account, VideoLink, Referral, Credits (rest of Phase 2) |
| 2026-11-17 | Claude | Account, VideoLink, Referral, Credits ported (native). memory-db fix: RegExp filter values were dropped (regex queries matched nothing). Known memory-db limits: collation ignored, no indexes/transactions. Phase 2 complete in-process. APIs migrated: 22 / 497 | Phase 3: Dashboard, Feed, User, Company, AppSetting… |
| 2026-11-17 | Claude | Dashboard (11 routes, delegated). memory-db `useAll()`. APIs migrated: 33 / 497 | Feed (9) |
| 2026-11-17 | Claude | Feed (9 routes, delegated). Found + fixed compat gap: malformed-HTTP responses. APIs migrated: 42 / 497 | User (17) |
| 2026-11-17 | Claude | ⚠ The Feed merge (ee1445f) went in with 1 intermittently failing test: my verify step grepped the test output instead of checking `npm test`'s exit code. Cause: parallel jest workers each load the whole legacy model graph → 5s timeouts under load (auth/middleware parity specs, 75–114s suites). Fix: `maxWorkers: '50%'`, `testTimeout: 30000`; 6/6 full runs green (7–10s). Verify step now uses the exit code | User (17) |
| 2026-11-17 | Claude | User (17 routes, delegated). memory-db `seed()` now stores docs shaped by mongoose (subdoc _ids/defaults) like real data. APIs migrated: 59 / 497 | Company (4), AppSetting (5) |
| 2026-11-17 | Claude | Company (4) + AppSetting (5), delegated. APIs migrated: 68 / 497 | Notification (6, SSE), Template (8), TDS (5) |
| 2026-11-17 | Claude | Notification (6, delegated, SSE incl. live push). APIs migrated: 74 / 497 | Template (8), TDS (5) |
| 2026-11-17 | Claude | Template (8) + TDS (5), delegated. Found + fixed 3 runtime gaps: uploads path (cwd), missing process-level error handlers, async-rejection behaviour. APIs migrated: 87 / 497 | eCommercePlatform (5), ProductSkucodeMap (3), MasterImportSetting (6), MarketingSite (4) |
| 2026-11-17 | Claude | eCommercePlatform (5), ProductSkucodeMap (3), MasterImportSetting (6), MarketingSite (4), delegated; network guard for tests. APIs migrated: 105 / 497 | Phase 3 rest: manualPayment (8), razorpay (8, raw body), Files (5), Imports (5), Webhook (3)… |
| 2026-11-17 | Claude | manualPayment (8) + razorpay (8), delegated; signed-webhook parity. APIs migrated: 121 / 497 | Files (5), Imports (5, upload+SSE), Webhook (3) |
| 2026-11-17 | Claude | Files (5), Imports (5), Webhook (3), delegated. Found + fixed: malformed-URL handling, Express wildcard params. APIs migrated: 134 / 497 | Email (19), Mailbox (27), WhatsApp (16), SupportChat (26), GoogleDrive (4), EasyEcom (1) |
| 2026-11-17 | Claude | Email group: Email (19), Mailbox (27), WhatsApp (16), SupportChat (26), GoogleDrive (4), EasyEcom (1) — generated controllers + route-smoke parity (374 cases). Phase 3 complete in-process. 812 tests green. APIs migrated: 227 / 497 | Phase 4: platforms (Ajio…Nykaa), MasterImport (25), Order (19), Auth (24) |
| 2026-11-17 | Claude | Phase 4: 9 platforms (`modules/platforms/<p>/`), Order (19), Auth (24) generated; MasterImport BLOCKED (worker at import). Found CRITICAL legacy auth bypass (user-profile). Worker-import guard test added. 1007 tests green. APIs migrated: 288 / 497 | Phase 5: CMS (81), SystemAdmin (71), Realtime, View, DesktopApp; check each for import-time starters |
| 2026-11-17 | Claude | Phase 5: CMS (81), SystemAdmin (71), View, DesktopApp generated; static/public + views assets fixed for prod layout; generated-controller freshness test. 1513 tests green. APIs migrated: 443 / 497 | Phase 6: OrderServer (7) as a second Nest app — check its workers first; MasterImport + MasterImportServer wait for the worker decision; Realtime waits for socket cutover plan |
| 2026-11-17 | Claude | Phase 6: OrderServer HTTP (7 routes) as a second Nest app; compat made per-app. 1535 tests green. APIs migrated: 450 / 497 | MasterImportServer (20) — check its worker imports; then wait on decisions (MasterImport, sockets, workers cutover) |
| 2026-11-17 | Claude | MasterImport (25) ported with the worker shim; 1615 tests green. APIs migrated: 475 / 497 | Run legacy + new on the local MongoDB and `npm run test:contract` |
| 2026-11-17 | Claude | **Live contract run on local MongoDB + Redis: 960 / 960 cases identical** (legacy :8000 from submodule, new :8100; 468 migrated main-server endpoints × identities). It found and I fixed 2 real bugs (env loaded too late; SIGTERM ignored). 1617 unit/parity tests green. APIs migrated: 475 / 497 | User: merge decision; staging + nginx; plan socket + worker moves |
| 2026-11-17 | Claude | Loop stopped: every remaining endpoint is waiting on a user decision. Done in-process: 450 / 497. Remaining 47 = MasterImport (25) + MasterImportServer (20) [worker-import decision], Realtime (2) [socket cutover]. | See "What needs the user" below |

### What needs the user (to continue)
1. ⚠⚠ Fix the legacy `GET /api/auth/user-profile` token leak (Blocked, top).
2. MasterImport worker import: option (a) legacy PR moving `invalidTransitions`/`IMPORT_PLATFORM` to constants, or (b) Nest shim. Then MasterImport (25). MasterImportServer (20) additionally needs a plan for moving its workers/crons with it.
3. Socket.IO + Realtime receiver move (Phase 5 socket cutover) — coordinate with Trackvid-CMS desktop/web.
4. ✅ Contract run done on local MongoDB: 960/960 identical. ✅ Non-prod MongoDB provided (2026-11-17): local `mongodb://localhost:27017`, new server uses DB `trackvid_dev` via gitignored `BE/.env.development.local`; new server boots and answers on :8100. Note: local Mongo is standalone → change streams (live notification push) need a single-node replica set. Next: run legacy on the same local DB (without the prod `.env`) and `npm run test:contract`; then staging + nginx; then cutovers.
5. Merge of the branch chain (`migrate/template-tds` … `migrate/phase6-order-server`, incl. your FE commit 1db4381) into `nestjs`.
6. Approval for the legacy PRs below (security first: user-profile token, public file delete, update-claims, add-storage-history, upload-logo).

### Legacy issues (informational — user decided 2026-11-17 not to change the legacy project)
0. ⚠⚠⚠ CRITICAL: `GET /api/auth/user-profile?email=` issues an access token for any email without auth (see Blocked).
1. StorageHistory: extract `getCompanyOverviewReport` / `getCompanyFeedDetailsReport` / `getCompanyList` / `getCompanyAggregatedData` into `services/storageHistoryReport.service.ts` (pure functions) so the Nest controller can stop delegating.
2. ⚠ Security (LAYER 2 Blocker in legacy): `GET /api/storage-history/add-storage-history` is unauthenticated and rebuilds storage history for every company's orders; its catch never responds. Suggest `systemAdminAuth, adminOnly` + a response in catch. Kept identical in Nest until legacy changes (contract rule).
3. Role: `GET /api/role/get-role/:id` not company-scoped; `get-roles?email=` filters a non-existent field.
4. Credits: `PUT /api/credit/upgrade-storage` uses `authAdmin` (the adminAuth factory) as middleware → every request hangs. Fix: `authAdmin([...perm])`. Reproduced as-is in Nest.
6. ⚠ Feed (LAYER 2): `POST /api/feed/add-update` takes `companyId` from the body; `DELETE /delete`, `POST /disable`, `POST /enable` update feeds by id without a company filter → an admin of company A with `feed::edit` can modify company B's feeds. Fix: scope by `req.user.companyId`.
7. User: `GET /api/user/members` and `DELETE /api/user/delete` use the adminAuth factory as middleware → hang (same bug as Credits). `POST /api/user/upload-logo` has no auth middleware.
8. ⚠⚠ Company (LAYER 2 Blocker, overnight-damage class): `PUT /api/companies/update-claims` has NO auth and overwrites `settings.eCommercePlatform[].typeOfClaims` for EVERY company (operator-customised claim types are lost). Also a platform `switch` outside automationRouting.ts (LAYER 11). `GET /api/companies/update-settings` lets any logged-in user reset tatPeriod=60 for every company. Fix: `systemAdminAuth, adminOnly` on both (or delete if they were one-off scripts).
9. AppSetting: `POST /api/app-settings/increff-qc-mapping` chains `authMiddleware` + `systemAdminAuth`; no single token passes both (users fail systemAdminAuth, system admins fail authMiddleware) → endpoint is unreachable.
10. Template: handlers have no try/catch → any async error (e.g. validation on upsert, bad id on delete) leaves the request hanging until the client times out. Wrap in try/catch → 4xx/500.
11. MasterImportSetting: `GET /api/master-setting/add-keys-settings` (any logged-in user) rewrites settings of every company; `POST /sync-spf-tat-to-companies` chains systemAdminAuth + authMiddleware → unreachable. ProductSkucodeMap `POST /` runs the file upload before auth (unauthenticated requests still write to disk).
12. razorpay: `POST /verify-signature` never responds when the signature is VALID (empty else); `POST /payment-event` destructures `req.body.payload` outside try → malformed body hangs; `POST /place-order` uses the adminAuth factory → every request hangs. Signature check over `JSON.stringify(parsed body)` instead of the raw bytes can reject genuine webhooks whose JSON is not byte-identical after re-serialisation (e.g. unicode escapes, number formats) — Razorpay recommends verifying the raw body.
13. ⚠ Files: `GET /api/files/:key(*)` (download any S3 object by key), `GET /get-file-link/:key(*)`, `GET /get-drive-link/:key(*)` and `DELETE /api/files/:key(*)` (delete any S3 object!) have NO auth. Imports `GET /import-status/:jobId` is public and creates a Notification when it sees a finished job.
5. `utils/mail.ts` loads `dotenv` from `<legacy>/.env` at import and verifies SMTP at import. In the Nest app that path is `BE/legacy/.env` (absent). Never copy the prod `.env` there.

### Blocked (needs user)
**⚠⚠ SECURITY — please read first.** Legacy `GET /api/auth/user-profile?email=<email>` has NO auth middleware and returns a valid access token for that user (`getUserProfile` → `generateTokenAccessToken(user)`). Anyone who knows an email (incl. admins) can obtain a session for that account. This is live in legacy prod now. Suggested fix (legacy PR, needs your approval): put `authMiddleware` on the route and drop `accessToken` from its response, or delete the route if no client uses it (grep TrackVid-FE / mobile apps first). The Nest port reproduces it (contract rule) and a test documents it; **Auth must not be cut over before this is fixed**.

**MasterImport blocked.** `controllers/MasterImport/masterImportOrderReports.controller.ts` imports `invalidTransitions` from `masterImportWorker.ts`, whose last line is `startWorker();` → importing the routes would start a BullMQ master-import worker inside the Nest process (hard rule). Note: this means legacy's main API process ALSO runs that worker today via the same import, although server.ts has the direct import commented out — include it in the Phase 6 worker inventory. Options: (a) legacy PR moving `invalidTransitions`/`IMPORT_PLATFORM` into a constants file (cleanest, needs approval); (b) a module-resolution shim in Nest that serves those constants without loading the worker (no legacy change, small drift risk, guarded by a test comparing the constants). Waiting for your choice.

0. **Merge into `nestjs` paused (2026-11-17).** Commit `1db4381` (by the user, 19:45) on `migrate/template-tds` adds the `FE/` project together with in-progress BE files, and `FE/` has uncommitted user changes. Switching to `nestjs` would overwrite them, and merging would carry `FE/` into `nestjs`. I did neither. BE work continues on stacked branches from that HEAD (`migrate/template-tds` → `migrate/phase3-batch2` → …). Question: OK to merge this chain (incl. 1db4381's FE/) into `nestjs`, or should FE be split out first?
1. ~~No non-prod MongoDB.~~ Resolved: local MongoDB (see "What needs the user" #4). No local mongod/docker; legacy `.env` `MONGO_URI` targets DB `prod`. Contract harness and any DB-touching run need a staging/dev DB. Options: (a) put a `dev`-database `MONGO_URI` in `BE/.env.development.local` (legacy notes the `dev` DB lives on the same Atlas cluster), or (b) install MongoDB locally (`brew install mongodb-community`) + seed snapshot. Redis is available locally (PONG).
2. **Deployment notes for the new server** (your steps): run `npm run build` (copies views/public), start `node dist/src/main.js` (cwd is switched to `dist/legacy` automatically), put/symlink the desktop installers into `BE/dist/legacy/cmsapp`, give the new server the SAME env keys as legacy (AWS_*, REDIS_*, JWT_*, RAZORPAY_*, EMAIL_*, GOOGLE_*, … — legacy modules read them at load time) plus `REALTIME_INTERNAL_URL`/`TOKEN`, start the OrderServer app with `npm run start:order-server` (ORDER_SERVER_PORT), and never place a `.env` inside `BE/legacy` or `BE/dist/legacy`.
3. **Staging env + nginx** (both servers side by side) — deployment step, user does it.
