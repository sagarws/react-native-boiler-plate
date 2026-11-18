# TrackVid-Automation-Core

> **Orientation.** Read this header, then the rules below. Both are binding.

|  |  |
|---|---|
| **Tier** | **0 — shared library.** Two repos consume it; neither is the only caller. |
| **Stack** | CommonJS, **no build step**, consumed as source. Every runtime library is an **optional** peer. |
| **Consumed by** | Automated-Scripts and Trackvid-CMS, as a git submodule at `packages/TrackVid-Automation-Core` — **each pins its own commit** |
| **Verify** | `npm run build` here, then `node server.js` in Automated-Scripts, then `npm run verify` in Trackvid-CMS |

## Layout

```
common/                              L1  platform-agnostic
platforms/<platform>/
  common/                            L2  every automation on this platform
  <automation-type>/                     claim-management | master-import | ticket-download
    common/                          L3  both flows
    api-based-flow/    common/       L4  direct HTTP to the platform's APIs
    script-based-flow/ common/       L4  puppeteer / selenium UI driving
types/                               generated + committed, never hand-edited
```

## Do not

- **Do not `require()` an optional dependency at module scope.** Require it inside the function that uses it — CMS has no `mongodb` and no `puppeteer`.
- **Do not hand-edit** an `index.js` barrel or anything in `types/`. Run `npm run build`.
- **Do not change behaviour where you can add a defaulted parameter.** A caller that passes nothing must behave exactly as before.
- **Do not use dynamic `require()` by computed path** or `fs.readdirSync(__dirname)` module loading — CMS bundles its main process and a bundler cannot follow either.
- **Do not land a change without moving both consumers' pins.** Two consumers on different commits is where "works here, breaks there" comes from.


The shared automation library. **Two repos depend on this one, and neither of them
is the only caller.**

```
Automated-Scripts  ─┐
                    ├─→  @trackvid/automation-core   (this repo, a submodule in both)
Trackvid-CMS       ─┘
```

`Automated-Scripts` is the Node server that runs automations on the server.
`Trackvid-CMS` is the Electron desktop app that runs them on an operator's machine.
Both consume this package as a git submodule plus a `file:` dependency, and **each
pins its own commit** — a change here is not live in a consumer until that
consumer's pin moves.

### This package is not the only thing they share

Do not treat "I did not touch the core" as "the other consumer is safe". Five repos
move together, and only one of the surfaces coupling them is this package:

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

1. **This package.** Covered by the rules below.

2. **TrackVid-BE's API and database.** Trackvid-CMS calls `/cms`, `/cms/counts`,
   `/cms/find-by-awb`, `/cms/update-ticket`, `/cms/my-company-credentials`,
   `/cms/renew-session` and `/system-admin/setting/companies/automation-routing`.
   Automated-Scripts reads and writes the same Mongo documents this package's
   session stores and TrackVid write-back functions touch. A change to a response
   shape, a field name, or a stored document breaks whichever consumer was not
   checked — and no amount of care in *this* repo prevents it.

   Shared documents to be careful with: the per-credential session records
   (`<platform>Session`), `settings.desktopExecution`,
   `settings.apiBasedAutomation`, `settings.masterImportSyncTime`, `settings.isAutoLoginOnActiveSession`,
   `masterDataSync`, and the CMS claim document itself.

3. **A runtime call chain, CMS → BE → Automated-Scripts.** The desktop app's
   "Re-capture" posts to `/cms/renew-session`; the backend forwards it to
   `{<PLATFORM>_SCRIPT_URL}/<platform>/renew-session`, which is Automated-Scripts.
   So a button in the desktop app executes code in the automation server with
   this package nowhere in the path. The same is true of every `*_SCRIPT_URL`
   handler in the backend.

4. **Trackvid-Monitor writes the settings both runners obey.**
   `settings.desktopExecution` and `settings.apiBasedAutomation` decide where an
   automation runs and which flow it uses; `settings.masterImportSyncTime` decides
   when. A rename here or there changes runtime behaviour with no code change in
   the runner at all.

**The practical rule:** before changing a shared response shape, a stored field,
a socket event or an endpoint any of them calls, grep for it in *all* of
Automated-Scripts, Trackvid-CMS, TrackVid-BE and Trackvid-Monitor — not just in
this package. Each repo's own contract is in its `CLAUDE.md`.

---

## The rule that matters most

**A change to this repo is a change to both consumers. Treat it that way.**

The failure this prevents is specific and has already nearly happened: a problem
shows up in Trackvid-CMS, the flow in this package is changed to fix it, the fix
is verified in CMS, and Automated-Scripts — which was never opened — breaks the
next time it runs. Nothing in either repo's tests would have caught it, because
the break is in the third repo.

### Before changing anything here

Find every caller. Both consumers, not just the one you are working in:

```bash
grep -rn "<functionName>" ~/Documents/WS-Project/Automated-Scripts/src \
                          ~/Documents/WS-Project/Trackvid-CMS/electron
```

If a function has callers in both, you are editing shared behaviour.

### Prefer additive change over changed behaviour

When one consumer needs something different, **add a parameter with a default
that preserves today's behaviour** rather than changing what the function does.

```js
// Good: CMS supplies its own session; the server path is untouched.
async function loginSnapdealApi(credentials, { forceFresh = false, session = null } = {}) {
  if (session?.jar) return { jar: session.jar, sellerId: session.sellerId ?? null };
  …
}
```

A caller that passes nothing must behave exactly as it did before the change.

### Never assume a consumer has your dependency

Every runtime library here is an **optional** peer, because the two consumers
install different sets — Trackvid-CMS has no `mongodb` and no `puppeteer`, and
must not need them to import a flow it runs over HTTP.

So: **require anything optional inside the function that uses it**, never at
module scope. A top-level `require("mongodb")` makes the whole module unimportable
in a consumer that has no database access.

```js
// Good — the driver is only needed if a connection is actually opened.
async function connectDB() {
  const { MongoClient } = require("mongodb");
  …
}
```

### After changing anything here

All three, in order. It is not done until the last one passes:

```bash
# 1. this repo — barrels and types are generated, never hand-edited
npm run build

# 2. Automated-Scripts
cd ~/Documents/WS-Project/Automated-Scripts && node server.js   # must boot and listen

# 3. Trackvid-CMS
cd ~/Documents/WS-Project/Trackvid-CMS && npm run verify        # typecheck ×2, lint, tests
```

### Getting a change into the consumers

A commit here changes nothing until each consumer's pin moves:

```bash
# in this repo
git push origin main

# in EACH consumer
cd packages/TrackVid-Automation-Core && git fetch && git checkout <sha> && cd -
git add packages/TrackVid-Automation-Core     # records the new pin
```

**Update both, or they drift.** Two consumers on different commits of a shared
package is the state where "it works here and breaks there" comes from, and
`git submodule status` in each repo is the only place it is visible.

---

## What belongs here

Utilities. Anything a second runner could want: login, session handling, platform
API calls, TrackVid write-back, parsing, reporting helpers.

**Not** orchestration — routes, controllers, cron wiring, queues, workers and env
config stay in the consumer. The test is "would the other consumer ever want
this?" If yes, it belongs here even if only one uses it today.

The corollary is a rule for the consumers: **no locally-defined utility that
duplicates or could live here.** A helper written in `Automated-Scripts/src` or
`Trackvid-CMS/electron` that another runner would want is a future divergence.

## Layout

```
common/                                L1  platform-agnostic
platforms/<platform>/
  common/                              L2  every automation on this platform
  <automation-type>/                   claim-management | master-import | ticket-download
    common/                            L3  both flows
    api-based-flow/    common/         L4  direct HTTP to the platform's APIs
    script-based-flow/ common/         L4  puppeteer / selenium UI driving
```

Push a utility as far down as it is true; lift it only when a second caller
appears. Never pre-lift.

## Constraints

- **CommonJS, no build step.** Consumed as source.
- **Barrels and `types/` are generated.** Run `npm run build`; never hand-edit an
  `index.js` or a `.d.ts`.
- **No dynamic `require()` by computed path**, and no `fs.readdirSync(__dirname)`
  module loading — Trackvid-CMS bundles its Electron main process and a bundler
  cannot follow either.
- **`types/` is committed.** A submodule has no install-time build, and CMS
  typechecks with `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`.
- **Main-process only** on the CMS side — everything here touches
  mongodb/axios/fs/puppeteer, so the renderer reaches it over IPC.

See [README.md](./README.md) for the platform registry and the migration recipe.

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

**Root in this repo:** the repository root — `platforms/` and `common/` are
top-level. Both consumers mirror this tree file for file, so a file moved here
moves in both of them.
