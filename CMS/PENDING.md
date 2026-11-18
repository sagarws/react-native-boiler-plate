# Pending

Work that is deliberately unfinished, with enough context to pick up cold.
Each item says what is already true, what is missing, and what makes it
awkward — the last part is usually the reason it is still here.

---

## 1. Master import session reuse — API flows done, script flows not

**Status:** the three API runners reuse a stored session. The two script-based
runners still sign in every time.

**Done:** `sessionReuse.service.ts` reads the jar out of the encrypted local
company document and probes it against the marketplace. A stored session is
used ONLY when the probe explicitly returns `true`; `false`, "cannot tell" and
a probe that throws all fall through to signing in. Wired into the Snapdeal,
Meesho and Myntra API runners. Meesho's context (`supplierId`,
`supplierIdentifier`) is rebuilt from the stored record, and a jar without a
supplierId is not treated as usable.

Every branch of that rule is pinned in `tests/sessionReuse.test.ts` — it is
silent when wrong, which is why it is tested rather than reasoned about.

**Also done, 2026-09-02 — the two halves that made reuse look broken:**

- **AJIO now reuses.** It could not go through `reusableSession`: its probe has
  to run inside a logged-in page, so a jar-only caller gets "cannot tell", which
  means sign in — every run, forever. The core's `tryReuseSession` already did
  the right thing but read the record from Mongo and was gated on env keys, so
  the DB-free half is split out as `reuseSessionRecord(page, record)` and the
  runner feeds it the record from the local company copy via `storedSession()`.
- **Runs now KEEP the session they mint.** Nothing did, so reuse could never
  bootstrap: a run signed in, used the session, dropped it, and the next run
  found nothing stored — for as many runs as you cared to watch. A hand capture
  was the only way a session ever reached the company document.
  `automations/common/keepSession.ts` ships it to the backend and into the local
  copy, tagged `cms-desktop`; wired into Snapdeal, Meesho, Myntra (API) and AJIO
  (both flows). Best-effort by design — a save that fails costs the next run a
  login, and must not cost this run its report.

  This is what makes Myntra reusable AT ALL on the desktop: Myntra binds a
  session to the IP that minted it, so a jar from the automation server is dead
  here on arrival, and only a session minted here can be reused here.

**Still to do — the script-based runners:**

| Runner | Why it is harder |
|---|---|
| `platforms/snapdeal/master-import/script-based-flow/runImport.ts` | drives a browser, so a jar has to be injected with `page.setCookie` before the first navigation rather than passed to an HTTP client |
| `platforms/meesho/master-import/script-based-flow/runImport.ts` | same |

AJIO is no longer on this list — the core's `reuseSessionRecord` does exactly
that injection, and is the model for these two.

The pieces are in place: `reusableSession(platform, username)` already returns
the record. What is missing is the browser-side injection and a check that the
page is actually signed in afterwards — a cookie set on the wrong domain or
path is accepted silently and the portal simply shows the login page.

**Do NOT** skip the probe and rely on catching errors instead. An expired
session answers 302 to a login page, or returns an empty report, or fails three
calls later with a 403. Snapdeal's ingest will accept a downloaded HTML login
page as a report.

---

## 2. AJIO — FIXED (was: may not work at all)

**Status:** resolved 2026-09-02. Kept here as the record of what it was.

The runner called `loginAjioApi`, which owns its own browser and closes it in a
`finally`, returning only the harvested jar. Both AJIO flows keep USING the page
— the API flow fetches from inside it, the script flow clicks buttons on it — so
every run died on `AJIO login returned no page`. The operator's earlier report of
AJIO "working" was the automation server, not this app.

The server's inline Reliance SSO sequence is now
`platforms/ajio/common/loginPage.js` in the core (`loginAjioPage(page, creds)`),
which signs a page in and LEAVES IT OPEN. The CMS runner owns its browser and
calls it; `userId`/`pobIds` are read from the signed-in page.

`loginAjioApi` is unchanged and still correct for what it is for — CAPTURING a
session, where closing the browser is the point.

---

## 3. Myntra's script flow does not run on the desktop

**Status:** deliberately not ported. It is the only one of the eight
platform × flow cells missing.

Its download phase runs through a **BullMQ worker backed by Redis**
(`src/platforms/myntra/master-import/common/queues.js`, `worker.js`). This app
has no Redis. Porting means rebuilding that phase on the JSON queue that
Snapdeal's script flow already uses (`masterImportQueue.store.ts` +
`masterImportQueue.service.ts`) — request, close the browser, collect later.

It is not registered in `masterImportRegistry.ts`, so a company on
`apiBasedAutomation.myntra.masterImport = false` falls through to the server,
which still runs it. That is the correct behaviour meanwhile, not a bug.

Myntra also needs SYSTEM Chrome rather than Chrome-for-Testing, and its
sessions are IP-bound.

---

## 4. Meesho has never completed a run anywhere

**Status:** built, contracts checked, never executed.

Both flows are registered and every core function they call resolves with a
matching signature. Neither has run against the live portal.

Its API upload was broken on the automation server until 2026-09-01 — it called
`importMasterDataToTrackVid({ ... })` with an object where the core takes three
positional arguments, so every upload threw on `user.trackVidEmail`, and it sent
`"Meesho Order Report"` where the ingest endpoint accepts
`"Dropship Order Report"`. Both fixed, neither yet proven against the portal.

Expect Meesho to be the first thing that fails on a real scheduled run.

**Known limit, not a bug:** the API flow covers FORWARD ORDERS ONLY. Meesho
publishes no return-order export, so `runReturnReport` throws
`MEESHO_RETURN_API_UNAVAILABLE`. A company on `apiBasedAutomation.meesho = true`
gets forward orders and no returns, reported per import type. The script flow
does both.

---

## 5. Reports beyond what the backend can ingest

**Status:** blocked on TrackVid-BE, not on this app.

Every report the backend has a pipeline for is already wired:

| Platform | Backend accepts | Wired |
|---|---|---|
| Snapdeal | Dropship Rtv Report | 1 of 1 |
| Myntra | Returns Report | 1 of 1 |
| Meesho | Order + Rtv | 2 of 2 |
| Ajio | Order + Rtv (generic parser) | 2 of 2 |

The portals expose more — Myntra has Orders, Listings and Inventory report ids;
Snapdeal has Price & Inventory and Dropship Return Delivered. They carry
`trackvidReportType: null` because `TrackVid-BE/src/v2/masterImport/platforms/*`
has no column mappings for them. Downloading them would produce 400s at ingest.

Backend column mappings come first; only then unblock them in the core's
`IMPORT_TYPE_API_CONFIG`.

---

## 6. Nothing is committed, and the core pins have not moved

**Status:** applies to everything above.

`@trackvid/automation-core` is a submodule pinned separately by
Automated-Scripts and Trackvid-CMS. The core changes from this work are
hand-synced into this repo with `rsync` — a fresh clone or CI still gets the
old core.

Before any of this is real for anyone else:

```bash
# in packages/TrackVid-Automation-Core
git commit && git push
# then move BOTH pins — Automated-Scripts and Trackvid-CMS
```

A commit in the core is invisible to a consumer until its pin moves, and two
consumers on different commits is where "works here, breaks there" comes from.

---

## 7. Claim side-processes the desktop cannot do yet

The automation server runs several things around a claim that this app does
not. Four are now wired here (2026-09-03):

- **Ticket write-back** — was already done, `PUT /cms/update-ticket`, before the
  local success is recorded.
- **cmsStatus write-back** — the marketplace's own ticket state, which
  Delhivery, Meesho, Nykaa and Xbees read back and map. All four runners were
  computing it in the core and *dropping* it, so a claim whose ticket was
  already approved sat on "Pending" until a sync job corrected it.
- **Credential unverify** — on `INVALID_CREDENTIALS` / `LOGIN_FAILED`, via
  `POST /master-setting/mark-credentials-unverified` with the operator's own
  token. NOT the core's `markCredentialsUnverified`, which mints a token from
  `TRACKVID_GET_USER_PROFILE_URL` — this app must not read automation env keys.
- **Per-platform status tabs** — from the core's new `common/claimStatuses.js`.

**Superseded 2026-09-03** by [PLAN-claim-liveness.md](./PLAN-claim-liveness.md) —
liveness moves INTO the app (local run records, recovery on startup) and only
state transitions are sent to the server. The blocking analysis below still
stands and is why that plan exists.

**Blocked on a backend change — do not build these in the app first:**

| Side-process | Why it is blocked |
|---|---|
| Heartbeat | `POST /cms/script-heartbeat` authenticates with `X-Internal-Token: REALTIME_INTERNAL_SCRIPT_TOKEN`, a server secret that must never ship to an operator's machine. It also needs a `jobId`, and the desktop dispatch payload (`cms:claim:dispatch`) carries none. |
| Per-AWB callback | Same endpoint family (`/cms/script-callback`), same internal token, same missing `jobId`. |
| Completion callback | As above, and the desktop files one claim at a time rather than a batch, so "completion" has no natural boundary yet. |

The fix for all three is the same shape: put a `jobId` in the dispatch payload
and give BE a variant of those endpoints that accepts a normal CMS bearer token
scoped to the caller's own company. That is a BE design decision, not something
to work around from the app.

**Deliberately NOT for the desktop:**

- **Orphan → username attach** and **cross-account probe** — they reconcile the
  FINAL orphan set across every account in a batch. A single-claim desktop run
  cannot see that set, and running it per claim would reconcile against rows
  other accounts are about to adopt.
- **Status sync** — a periodic job over all rows (`/cms/<platform>-status-sync`),
  not part of filing one claim. It belongs on the server.
- **Mattermost** — an ops channel for server jobs. A desktop app posting to it
  would report one operator's machine as if it were the fleet.
