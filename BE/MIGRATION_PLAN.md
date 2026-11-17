# TrackVid-BE → NestJS + Fastify Migration Plan

> **Source repo:** `/Users/apple/Documents/Sagar/Trackvid/TrackVid-BE` (Express, "legacy")
> **This folder:** `/Users/apple/Documents/Sagar/Other/react-native-boiler-plate/BE` (new NestJS + Fastify app, "new"). The git root is the parent folder, branch `nestjs`.
> **Progress tracker:** [`PROGRESS.md`](./PROGRESS.md). Update it after every step.
> **Written:** 2026-11-17

---

## 0. Goal and non-negotiable rule

Move the HTTP layer of TrackVid-BE from Express to **NestJS on the Fastify adapter**
(`@nestjs/platform-fastify`) **without any client noticing.**

**The rule:** for each request, the new server returns the **same status code, the
same JSON body (field names, nesting, types, null vs. missing), and the same relevant
headers** as the legacy server. This applies to:

| Client | Depends on |
|---|---|
| TrackVid-FE (web) | almost every `/api/*` route |
| Trackvid-CMS (desktop) | `/api/cms`, `/cms/counts`, `/cms/find-by-awb`, `/cms/update-ticket`, `/cms/my-company-credentials`, `/cms/renew-session`, `/system-admin/setting/companies/automation-routing`, socket events |
| Trackvid-Monitor | ~12 `/api/system-admin/*` endpoints |
| TrackVid-Mobile-app, TrackVid-App, Argos-Watch-TrackVid-App | auth, upload, video, order routes |
| Automated-Scripts | shared Mongo documents; BE calls it via `*_SCRIPT_URL` |

Nothing gets renamed, removed or "cleaned up" during the migration. The migration is a
**port**, not a redesign. Improvements to the API go in separate, later PRs that follow the
additive-only rules in TrackVid-BE's `CLAUDE.md`.

---

## 1. Current system, measured on 2026-11-17

| Item | Value |
|---|---|
| TypeScript files / lines | ~493 / ~121k |
| Route modules (`src/routes/*`) | 52 modules, ~400+ endpoints |
| `res.status/json/send/...` calls in controllers | ~1,900 |
| Processes | `src/server.ts` (main API + sockets + workers + crons), `src/OrderServer/server.ts` (file/order upload server), `src/MasterImportServer.ts`, `src/Email-Automation/server.ts` |
| Mount points (main) | `/api/*` (routes/index.ts), `/internal`, `/view`, `/admin/queues` (bull-board), `/` (CMS desktop app downloads, catch-all `/:filename`), `public/` static |
| Express-specific pieces | `express`, `body-parser` (urlencoded `extended: true`, 5 MB), `cors()`, `express.static`, `express-rate-limit` (3 limiters), `multer` (10 files), `@bull-board/express`, `trust proxy = loopback`, `x-powered-by` disabled, EJS view engine (render calls currently commented out) |
| Streaming | SSE (`text/event-stream`) in notifications, support chat, imports, master-import reports. Also `pipe(res)`/`download`/`sendFile`/`redirect` in ~13 controllers |
| Realtime | Socket.IO via `services/realtime.service.ts` + `services/cms-realtime.service.ts`, attached to the main `httpServer` |
| Background work in the API process | BullMQ/Bull workers imported by `server.ts`, `node-cron` jobs, email polling, notification stream, cleanup intervals |
| Auth | JWT in `Authorization: Bearer` (and `?token=` for `authMiddleware`), plus DB user lookup and `isSessionEnded` revocation. Tiers: `authMiddleware`, `adminAuth([perms])`, `systemAdminAuth + adminOnly`, plus support-agent, external-client, easy-ecom, getVideo auth |
| Error envelope | `{ isSuccess, message, displayMessage, data? }`, written by hand in each controller. No global Express error handler |
| Tests | 15 `*.test.ts` files (node:test) |

**Refresh these numbers at the start of Phase 0.** The legacy repo keeps changing during the migration.

---

## 2. Target architecture

```
                  ┌──────────────── nginx ────────────────┐
 clients ───────▶ │ location /api/<migrated-prefix>/ ──▶ new (NestJS+Fastify, :8100)
                  │ location /           (everything else) ──▶ legacy (Express, :8000)
                  └───────────────────────────────────────┘
                              │                     │
                              └──── same MongoDB / Redis / S3 ────┘
```

- **Strangler pattern.** Both servers run side by side against the **same** MongoDB and
  Redis. nginx sends each migrated URL prefix to the new server. Rolling back one module
  means changing one nginx `location` block.
- **Only the HTTP layer is rewritten.** Mongoose models, services, utils, BullMQ queues and
  `v2/masterImport` business logic are reused, not rewritten.
- **Workers and crons stay in legacy until Phase 6.** The new app **must not** import worker
  or cron files. If both processes ran them, every job and cron would run twice: duplicate
  emails, double credit adjustments, duplicate imports.
- **Socket.IO stays in legacy until Phase 5.** The new app emits realtime events by calling
  the existing internal mechanism (`/internal` realtime routes or a shared Redis pub/sub)
  instead of owning sockets.

### 2.1 Sharing code with legacy (decide in Phase 0)

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Git submodule (recommended)** | `BE/legacy/` = TrackVid-BE pinned commit (run `git submodule add <url> BE/legacy` from the git root); new code imports `legacy/src/models`, `legacy/src/services`, … | One source of truth; legacy hotfixes flow in by bumping the pin | Services that take `req`/`res` must be split first; tsconfig path setup |
| B. Copy domain layer once | Copy models/services/utils into `src/domain` | Simple | Two copies drift during a 2–4 month migration. Every legacy fix has to be made twice |
| C. Move new app inside TrackVid-BE repo | `apps/nest/` next to `src/` | Easiest imports | Not this folder; mixes two build systems in one repo |

**Default: A.** If a legacy service touches `req`/`res`, first refactor it **in legacy**
(through a normal PR) into a pure function that the Express controller calls. Then the Nest
controller can call the same function.

### 2.2 Folder layout (new app, inside `BE/`)

```
BE/
  src/
    main.ts                    # NestFactory.create(AppModule, new FastifyAdapter(...))
    app.module.ts
    core/
      http/                    # compat layer: query parser, body limits, cors, security headers, trust proxy
      auth/                    # guards: AuthGuard, AdminAuthGuard(perms), SystemAdminGuard, AdminOnlyGuard, ...
      envelope/                # helpers that build the legacy { isSuccess, message, displayMessage, data } shape
      errors/                  # exception filter that reproduces legacy error bodies exactly
      upload/                  # @fastify/multipart wrapper with multer-equivalent field/limit behavior
      sse/                     # SSE helper (raw reply, headers, heartbeat, close handling)
      rate-limit/              # @fastify/rate-limit configs matching the 3 legacy limiters
    modules/
      <module>/                # one Nest module per legacy src/routes/<Module>
        <module>.controller.ts
        <module>.module.ts
      platforms/<platform>/    # Ajio, Myntra, Flipkart, ... (LAYER 11: platform code in platform dirs)
  legacy/                      # git submodule → TrackVid-BE (option A)
  test/contract/               # contract-diff harness + recorded cases per module
```

TrackVid-BE's `CLAUDE.md` rules apply here too: auth tiers, every query names its index,
no platform `switch` outside `automationRouting.ts`, additive-only contract changes,
platform-wise structure, no pushes to `main`.

---

## 3. Express → Fastify/Nest compatibility checklist

Each item below can silently break a client if missed. Each has to be handled in
`core/http` **before** the first module moves, and each has to be covered by a contract test.

| # | Express behavior today | Fastify default | What to do |
|---|---|---|---|
| 1 | `req.query` parsed with **`qs`** (nested `a[b]=1`, arrays `a[]=1`) | flat `querystring` | `querystringParser: (s) => qs.parse(s)` with the same `qs` options |
| 2 | urlencoded body `extended: true` (qs), limit 5 MB; JSON limit 5 MB | JSON 1 MB, no urlencoded | `bodyLimit: 5*1024*1024`; register `@fastify/formbody` with a qs parser |
| 3 | Empty body / wrong content-type → `req.body = {}` | 400/415 error | Custom content-type parser for empty or unknown bodies. Match the legacy result per route |
| 4 | Malformed JSON → body-parser 400 HTML/text | Fastify 400 JSON | Exception filter reproduces the legacy status/body (capture it from legacy first) |
| 5 | Unknown route → Express HTML `Cannot GET /x` (404) | JSON 404 | Only matters for routes that still go to new; match whatever clients depend on |
| 6 | Trailing slash `/a/` == `/a`, case-insensitive paths | strict | `ignoreTrailingSlash: true`, `caseSensitive: false` |
| 7 | Route order: first match wins (`/foo/:id` vs `/foo/bulk`) | radix router, static beats param | Check every module for ordering-dependent routes; record them in the module's notes |
| 8 | `res.json(obj)` uses `JSON.stringify` (ObjectId → string, Date → ISO, `undefined` dropped) | same unless a response schema is set | **Do not add Fastify response schemas** in the port. They strip unknown fields. Add them later, only with `additionalProperties: true` |
| 9 | Nest default: wraps errors as `{ statusCode, message, error }` | — | Global exception filter that outputs the legacy envelope; never let Nest's default error body reach a client |
| 10 | Controllers return different status codes per branch | Nest `@HttpCode` is static | Use `@Res({ passthrough: true })` and set `reply.status()` per branch, or return status from the handler |
| 11 | `cors()` = `Access-Control-Allow-Origin: *`, all methods | — | `@fastify/cors` with `origin: '*'` (same as today) |
| 12 | `securityHeaders` middleware, `x-powered-by` off | — | Port `securityHeaders` as a Fastify `onSend` hook with identical headers |
| 13 | `trust proxy = loopback` → `req.ip` = real client | — | `trustProxy: '127.0.0.1'` (rate limits and audit logs depend on it) |
| 14 | `express-rate-limit` response body/headers on 429 | different | `@fastify/rate-limit` with `errorResponseBuilder` matching legacy body, same window/max, same `RateLimit-*` headers |
| 15 | `multer`: field names, `req.file`/`req.files` shape, disk paths in `uploads/`, size limits, error codes | — | `core/upload` produces an object with the same shape (`originalname`, `mimetype`, `path`, `size`, …) so services stay unchanged |
| 16 | SSE via `res.write` and keeping the response open | — | `reply.hijack()` + `reply.raw.write`; same headers; handle `request.raw.on('close')` teardown |
| 17 | `res.download` / `sendFile` / `pipe(res)` / `redirect` | — | `@fastify/static` `reply.sendFile`, `reply.send(stream)`, `reply.redirect(url, code)`. Keep `Content-Disposition` identical |
| 18 | `express.static('public')`, catch-all `/:filename` CMS downloads | — | `@fastify/static`; register the catch-all **last** |
| 19 | `@bull-board/express` | — | `@bull-board/fastify`, same base path, same auth (if any) |
| 20 | `req.user` set by middleware | — | Guards set `request.user` with the **same shape**; `@User()` param decorator |
| 21 | Token from `?token=` (authMiddleware only) | — | Keep it, and only in the guard that accepts it today |
| 22 | Headers are case-insensitive, `req.get()` | — | `request.headers[lowercase]` |
| 23 | Express 4 swallows async errors unless caught (some handlers rely on try/catch) | Fastify catches rejected promises → 500 | Port the try/catch exactly; check the filter's 500 body against legacy |

---

## 4. Testing strategy: contract diff

The migration is only done when the new server's responses are **proven** identical to the legacy server's.

1. **Harness** (`test/contract/`): for each case, send the same request to legacy
   (`:8000`) and new (`:8100`) against a **staging** DB/Redis. Compare:
   status, JSON body (deep, key order ignored), and `content-type`, `content-disposition`,
   `cache-control`, CORS and rate-limit headers.
   Volatile fields (`_id` of newly created docs, timestamps, tokens) are masked by path.
2. **Cases per endpoint:** happy path; each 4xx branch (no token, expired token, missing
   permission, wrong company, validation failure, not found); empty body; nested query.
3. **Writes:** run the case on legacy, snapshot affected documents, reset, run on new,
   snapshot, and compare the documents. Mongo state has to match as well.
4. **Shadow traffic (optional, for high-traffic GETs):** nginx `mirror` sends a copy of real
   GET requests to the new server; the new server logs any diff and its responses are thrown away.
5. **Client smoke tests** after each cutover: TrackVid-FE main flows, a Trackvid-CMS claim
   cycle, Monitor dashboards, mobile login + upload.
6. Legacy's existing 15 `*.test.ts` stay green; services reused through the submodule are
   covered by them.

**Never point either server at prod while running write cases.** Check `.env` first; this
is TrackVid-BE CLAUDE.md rule 11.

---

## 5. Phases

Estimates assume 1 developer + Claude, with review and testing. Total: **~10–16 weeks**.

### Phase 0: Setup and decisions (week 1)
- [ ] Confirm with client: **NestJS + Fastify** (assumed) vs plain Fastify.
- [ ] Decide on code sharing (§2.1, default A: submodule).
- [ ] Scaffold Nest app in `BE/`, Fastify adapter, TS config, path aliases to `legacy/src`, lint, `npm run build && npm test`.
- [ ] Connect to the same Mongo/Redis via the legacy `config/db` (connection only. **No worker or cron imports.**)
- [ ] Staging environment: both servers + nginx + staging DB snapshot.
- [ ] Re-measure §1 numbers; fill the module list in `PROGRESS.md`.

### Phase 1: Compatibility core (weeks 2–3)
- [ ] `core/http`: items 1–6, 11–13, 22 of §3.
- [ ] `core/errors` + `core/envelope`: items 4, 9, 10, 23.
- [ ] `core/auth`: port every auth middleware to a guard with an identical 401/403 body:
      `authentication`, `normalAuth`, `adminAuth(perms)`, `systemAdminAuth`, `systemAdminRole`/`adminOnly`,
      `supportAgentAuth`, `externalClientAuth`, `easy-ecom-auth`, `getVideo-auth`, `encryption`, `validation`.
- [ ] `core/rate-limit`, `core/upload`, `core/sse`.
- [ ] Contract harness + CI job.
- [ ] **Exit:** a trivial ported endpoint passes the harness for all auth tiers and error cases.

### Phase 2: Pilot, small read-mostly modules (week 4)
Common, BaseLink, plan, Role, Contact, StorageHistory, CreditHistory, ClaimHistory, Account, VideoLink, Referral, Credits.
- [ ] Port → contract-test → nginx cutover on staging → client smoke → prod cutover with the legacy route kept for rollback.
- [ ] **Exit:** one week in prod with zero diffs/regressions. Fix the process before scaling up.

### Phase 3: Mid-size business modules (weeks 5–8)
Dashboard, Feed, User, Company, AppSetting, Notification (SSE), Template, TDS, eCommercePlatform,
ProductSkucodeMap, MasterImportSetting, MarketingSite, manualPayment, razorpay (webhook signature!
raw body needed), Files, Imports (upload + SSE), Webhook, Email, Mailbox, WhatsApp, SupportChat (SSE),
GoogleDrive, EasyEcom.
- [ ] razorpay/webhooks: preserve **raw body** for signature verification (`rawBody: true`).
- [ ] Upload modules: verify file lands in the same place with the same name format.

### Phase 4: Platforms, master import, orders (weeks 9–11)
Ajio, Myntra, Flipkart, TataCliq, Snapdeal, Delhivery, Xbees, Meesho, Nykaa (→ `modules/platforms/<platform>/`),
MasterImport (+ v2 paths, reports SSE), Order, Auth (login/refresh/forgot-password + rate limits; moved
late because every client depends on it).
- [ ] `*_SCRIPT_URL` forwarding (renew-session etc.) is byte-for-byte the same request to Automated-Scripts.
- [ ] Platform dispatch only through `automationRouting.ts` (imported from legacy).

### Phase 5: High-blast-radius modules (weeks 12–13)
CMS (80 routes; Trackvid-CMS desktop + web), SystemAdmin (74 routes; Monitor), Realtime/internal,
View, DesktopApp downloads + static, bull-board.
- [ ] Socket.IO: move `realtime.service` + `cms-realtime.service` onto the Fastify server
      (`socket.io` attached to `app.getHttpServer()`, or a Nest gateway with the same namespaces,
      event names (`cms:claim:dispatch`, `cms:script:progress`, OTP events) and payloads).
      If both servers ever hold sockets at once, add `@socket.io/redis-adapter`.
- [ ] Coordinate with Trackvid-CMS / Monitor owners; cut over in a low-traffic window.

### Phase 6: Secondary servers, workers, decommission (weeks 14–16)
- [ ] OrderServer (`/order` upload server) and MasterImportServer → Nest apps (or Nest standalone workers).
- [ ] Move workers + crons from legacy `server.ts` into a dedicated Nest worker process
      (`NestFactory.createApplicationContext`). **Stop them in legacy in the same deploy**; never run both.
- [ ] Email-Automation server.
- [ ] Remove nginx legacy fallback; keep the legacy build deployable for 2 weeks; then archive.
- [ ] Remove the submodule: move the domain code into the new repo for good.

---

## 6. Per-module procedure (repeat for each row in PROGRESS.md)

1. Read the legacy route file + controllers + middleware chain. Note in PROGRESS.md: route order quirks, uploads, SSE, streams, raw body, `?token=`.
2. If a service takes `req`/`res`, open a legacy PR to make it a pure function first.
3. Write the Nest controller: same path, method, guards (same tier), same status/body per branch.
4. Write contract cases: every branch from step 1.
5. Run the harness on staging until there are 0 diffs.
6. nginx: add `location /api/<prefix>/` → new on staging; smoke test the clients.
7. Commit on a feature branch, PR, review (TrackVid-BE LAYERS 1–10), merge.
8. Prod cutover (nginx), watch logs/error rates for 24h, mark ✅ in PROGRESS.md.
9. Rollback = revert the nginx block (legacy code is still deployed).

---

## 7. Deploy and rollback

- Deploy order per module: **new server deployed (dark) → nginx switch → monitor**. Clients don't change.
- Every cutover is one nginx `location` block, so rollback takes about 1 minute.
- During migration, legacy-only fixes must be ported to the new module if it has already moved. The submodule approach (A) avoids most of this.
- Monitoring per cutover: 4xx/5xx rate by route, p95 latency, Mongo slow-query log, socket connection count (Phase 5).

## 8. Risks

| Risk | Mitigation |
|---|---|
| Response field silently dropped/renamed | Contract diff harness; no response schemas during port |
| Workers/crons run twice | New app never imports them until Phase 6 cutover, which stops them in legacy in the same deploy |
| Socket events stop arriving at desktop CMS | Socket move is last, isolated, with the same event names and an optional Redis adapter |
| Auth behavior drift (401 vs 403, `?token=`) | Guards ported 1:1 and contract-tested in Phase 1 before any module moves |
| Legacy keeps changing during migration | Submodule pin + "port legacy fix" step; freeze big refactors in legacy during Phase 5 |
| Webhook signatures fail (raw body) | `rawBody` enabled for razorpay/webhook routes; tested with recorded payloads |
| Expected speedup does not appear | Most latency is Mongo/Redis/S3/external. Measure before/after per module and report it honestly to the client |

## 9. Open questions for the client
1. NestJS + Fastify, or plain Fastify?
2. Main reason: performance, maintainability, or hiring/standardization? This decides whether Phase 6 cleanup is worth doing.
3. Is a staging environment with a prod-like DB snapshot available?
4. Is any feature freeze possible during Phase 5 (CMS/SystemAdmin)?

---

## 10. How to resume work (for Claude or a developer)

1. Open `PROGRESS.md`. Find the current phase and the first module that isn't ✅.
2. Re-read §3 (compat checklist) and §6 (per-module procedure).
3. Check the legacy repo for new commits to that module since its pin: `git -C legacy log <pin>..origin/main -- src/routes/<M> src/controllers/<M>`.
4. Do one module at a time; update `PROGRESS.md` (status, notes, contract case count, cutover date) before stopping.
