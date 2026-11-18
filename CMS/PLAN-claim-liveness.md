# Plan — claim liveness without server load

**Goal:** the desktop app watches its own runs. The server is only written to,
never polled, and never gives the app database access.

Today the server's liveness model is a 30-second POST per running job plus a
1-minute watchdog cron (`TrackVid-BE/src/workers/scheduler.ts`). That is the
load this app exists to remove. It also cannot be reused as-is: it
authenticates with `X-Internal-Token: REALTIME_INTERNAL_SCRIPT_TOKEN`, a server
secret that must never ship to an operator's machine.

**The principle:** liveness is local. The server hears about *transitions*, not
about the fact that we are still alive.

```
        CMS app (owns liveness)                    BE (owns the database)
  ┌──────────────────────────────────┐
  │ local run record, ticked in-app  │
  │ no network, no timer to the API  │
  └──────────────┬───────────────────┘
                 │  only on a transition — 3 calls per claim, not 1 every 30s
                 ▼
      Running ──► Success / Failed ──►  scriptProcessingStatus + error
```

---

## 0. Fix first: desktop dispatch writes a field that does not exist

`TrackVid-BE/src/services/autoClaimDispatch.service.ts:149`

```js
await CMS.updateOne({ _id }, { $set: { scriptStatus: CMS_SCRIPT_STATUS.QUEUED } });
```

The CMS schema has **`scriptProcessingStatus`** — there is no `scriptStatus`
field (`src/models/CMS/cms.model.ts:423`). Mongoose is strict by default, so
this update is **silently dropped**. The server path in the same file, three
updates later, writes `scriptProcessingStatus` correctly.

Two consequences, both live today:

1. A claim handed to the desktop still reads **Not Started** in the admin panel.
2. It stays eligible for the server's own sweep, whose filter is literally
   `scriptProcessingStatus in ["Not Started", null, "Failed"]` — so the same
   claim can be filed twice, once from each machine.

Nothing else in this plan matters until this is one word longer.

---

## 1. Local run records (CMS app)

A `JsonCollection` of runs, next to the claim queue:

```ts
interface ClaimRun {
  cmsId: string
  platform: string
  startedAt: string
  lastBeatAt: string      // ticked every 30s while the runner works
  attempt: number
}
```

Written when `processClaim` starts, ticked by an interval, removed when it
returns either way. No network, so this costs the server nothing.

`lastBeatAt` is for the operator — "started 6 minutes ago, still going" in the
UI — not for the recovery below.

## 2. Recovery on startup, not on a timeout

**A fresh process means every run still marked `running` is orphaned.** The app
holds `app.requestSingleInstanceLock()` (`electron/main/main.ts:23`), so there
cannot be a second instance still working it.

That is *better* than the server's 2-minute threshold: no window in which a slow
claim is wrongly declared dead, and no window in which a dead one is still
believed alive.

On startup, for each orphan: mark it failed locally, then send **one** callback
(§3) resetting the row so it can be retried. This is where a closed lid, a
crash, or a force-quit is repaired.

## 3. The only thing sent to the server

One new endpoint, authenticated with the **operator's own CMS bearer token** and
scoped to their company by the token — no internal secret, no `jobId`, no
`ScriptJob` row:

```
POST /cms/desktop-claim-status
  { cmsId, status, ticketNumber?, error? }
  status: "Running" | "Success" | "Failed" | "Help Center Failed" | "Not Started"
```

BE writes `scriptProcessingStatus` and `scriptProcessingError` on that one row,
after checking it belongs to the caller's company. That is the whole endpoint —
a database write and an ownership check.

Sent at exactly three moments:

| When | status |
|---|---|
| the runner starts | `Running` |
| it files a ticket | `Success` (after `PUT /cms/update-ticket`, never instead of it) |
| it fails | `Failed`, with the reason |
| an orphan is found at startup | `Not Started` + "the desktop app stopped before this claim finished" |

**Three calls per claim instead of one every 30 seconds.** A 20-minute claim
costs the server 3 requests here versus 40 before.

## 4. The one thing the app cannot do for itself

If the operator never reopens the app, no local recovery ever runs and the row
sits at `Queued`/`Running` for good.

So BE keeps **one** cheap safety net — not a heartbeat watchdog:

```
cron, hourly:
  CMS rows with scriptProcessingStatus in (Queued, Running)
    AND routed to desktop
    AND not updated for N hours   → Not Started
       + "The desktop app never reported back. Retry, or check that it is running."
```

Hourly and query-only. It replaces a per-minute cron reading every RUNNING job.

## 5. What is deliberately not moved to the app

- **Per-AWB and completion callbacks** — the desktop files one claim per run, so
  there is no batch for either to describe. §3 covers the same ground.
- **Orphan → username attach, cross-account probe** — they reconcile the *final*
  orphan set across a whole batch. One desktop claim cannot see it.
- **Status sync, Mattermost** — periodic fleet-wide jobs. They stay on the
  server.

---

## Order of work — DONE 2026-09-03

| | | Where |
|---|---|---|
| 0 | `scriptStatus` → `scriptProcessingStatus` in the desktop branch | `BE autoClaimDispatch.service.ts:147` |
| 1 | `lastBeatAt` on the queued claim + `touchRun` | `CMS claimQueue.service.ts` |
| 2 | `POST /cms/desktop-claim-status` | `BE desktopClaimStatus.controller.ts` |
| 3 | Three transitions wired into the processor | `CMS claimProcessor.service.ts` |
| 4 | Startup orphan recovery, before the drain | `CMS claimLiveness.service.ts`, called from `auth.service.ts` |
| 5 | Hourly sweep for an app that never came back | `BE workers/scheduler.ts` |

**One deviation from §1 as written:** the run record is not a second
collection. The claim queue already carries a per-claim `status` and survives a
restart, so `lastBeatAt` was added to it instead — one file to keep consistent
rather than two that can disagree about whether a claim is running.

Covered by `tests/claimLiveness.test.ts`: recovery keys off the status and not
a clock, the backend row is reset so the claim is claimable again, a clean
shutdown recovers nothing, and a claim costs two transition calls rather than a
ping every thirty seconds.

## How to tell it works

- Kill the app mid-claim. Reopen it. The row returns to **Not Started** with the
  reason, and the claim is retryable — no server involvement.
- Route a claim to the desktop with the app closed. It reads **Queued**, not
  Not Started, and the server's sweep leaves it alone.
- Watch the BE access log during a claim: three requests, not one every 30s.
