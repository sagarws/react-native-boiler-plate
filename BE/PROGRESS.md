# Migration Progress

See [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md) for the plan.
Status: ⬜ not started · 🟡 in progress · 🧪 contract-tested · 🚦 staging cutover · ✅ prod cutover

**Current phase:** 0 → 1 (scaffold done; Phase 1 compat core next)
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
| 2026-11-17 | Tests: jest + ts-jest, Fastify `inject()` for in-process HTTP tests | No DB/network needed for compat tests |
| 2026-11-17 | New app lives in `react-native-boiler-plate/BE`, base branch `nestjs` | User's choice. `FE/` is a sibling folder (not ours); `prompt.txt` + root `.env` are unrelated leftovers, untouched |

## Phase 0–1 (foundation)
| Item | Status | Notes |
|---|---|---|
| Nest scaffold + Fastify adapter | 🧪 | Nest 11.2 / Fastify 5.12, `src/main.ts`, `src/bootstrap.ts`, `GET /` = legacy "Hello World!" |
| Legacy submodule + path aliases | 🧪 | `BE/legacy` @ d52efb6e; `@legacy/*` verified at runtime (`runtimeGuard` import) |
| Staging env (both servers + nginx) | ⛔ | Blocked: needs user (see Session log) |
| core/http (qs, body limits, cors, headers, trust proxy, trailing slash) | 🟡 | Done: qs (1), bodyLimit 5MB (2, JSON only so far), trailing slash + case-insensitive (6), trust proxy loopback (13), no x-powered-by. Todo: formbody/urlencoded (2), empty/unknown body (3), cors (11), securityHeaders (12) |
| core/errors + envelope | ⬜ | |
| core/auth guards (all 11 middlewares) | ⬜ | |
| core/rate-limit (login, forgot-password, generic) | ⬜ | |
| core/upload (multer-compatible) | ⬜ | |
| core/sse | ⬜ | |
| Contract harness + CI | ⬜ | |

## Modules (route counts measured 2026-11-17)
| Phase | Module | Prefix | Routes | Special | Status | Contract cases | Cutover |
|---|---|---|---|---|---|---|---|
| 2 | Common | /api/common | 1 | | ⬜ | | |
| 2 | BaseLink | /api/base-link | 1 | | ⬜ | | |
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

### Blocked (needs user)
1. **No non-prod MongoDB.** No local mongod/docker; legacy `.env` `MONGO_URI` targets DB `prod`. Contract harness and any DB-touching run need a staging/dev DB. Options: (a) put a `dev`-database `MONGO_URI` in `BE/.env.development.local` (legacy notes the `dev` DB lives on the same Atlas cluster), or (b) install MongoDB locally (`brew install mongodb-community`) + seed snapshot. Redis is available locally (PONG).
2. **Staging env + nginx** (both servers side by side) — deployment step, user does it.
