# TrackVid-Automation-Core

Shared automation utilities for every marketplace/courier platform TrackVid automates.
Consumed by **`Automated-Scripts`** (Node server) and **`Trackvid-CMS`** (Electron main
process) as a git submodule + local `file:` dependency, so one utility is written once and
reused everywhere instead of being maintained twice.

**Rule of thumb:** the runner repo keeps *orchestration* — routes, controllers, cron wiring,
queues/workers, env config. This repo keeps *everything else* — login, session storage,
platform API calls, TrackVid write-back, parsing, reporting helpers.

---

## Folder structure

```
common/                                  L1 — cross-platform, platform-agnostic
platforms/
  <platform>/                            ajio, myntra, snapdeal, meesho, flipkart, nykaa, delhivery, xbees
    common/                              L2 — shared by every automation on this platform
    <automation-type>/                   claim-management | master-import | ticket-download
      common/                            L3 — shared by both flows of this automation
      api-based-flow/                    direct HTTP calls to the platform's APIs
        common/                          L4 — shared by the files in this flow only
      script-based-flow/                 puppeteer / selenium UI driving
        common/                          L4
```

`ticket-download` only exists for platforms that need it. Add an automation-type folder when
that platform actually gains one — do not pre-create empty types.

### Which `common` do I put it in?

Push a utility **as far down as it is true**, and lift it only when a second caller appears.

| Level | Put it here when… | Examples |
|---|---|---|
| `common/` (L1) | it knows nothing about any platform | `db`, `logger`, `constants`, `errorHandler`, `mattermostNotifier`, `resourceSaver`, `claimSubmitGuard` |
| `platforms/<p>/common/` (L2) | every automation on that platform needs it | `login`, `sessionStore`, `loginErrors`, `unverifyCredential` |
| `<automation-type>/common/` (L3) | both the API and the script flow need it | shared payload builders, status maps, date chunking |
| `<flow>/common/` (L4) | only files inside that one flow need it | request signing for the API flow, selectors for the script flow |

---

## Importing

The package has **no `exports` map**, so plain CommonJS directory resolution works and you can
require at whatever depth reads best:

```js
// deep + explicit — preferred in flow code
const { getUserId } = require("@trackvid/automation-core/platforms/ajio/master-import/api-based-flow/apiReportFlow");
const { login }     = require("@trackvid/automation-core/platforms/ajio/common/login");
const { connectDB } = require("@trackvid/automation-core/common/db");

// barrel — handy in controllers that touch several things
const { platforms, common } = require("@trackvid/automation-core");
const { submitTicketRequest } = platforms.ajio.ticketDownload.apiBasedFlow.ticketApiFlow;
```

Every `index.js` is a **generated** barrel of lazy getters over literal `require` strings:

```js
module.exports = {
	get db() {
		return require("./db");
	},
};
```

Literal strings so Rollup/esbuild can follow them when a consumer bundles the package
(Trackvid-CMS bundles its Electron main process); getters so requiring the root does not
eagerly pull mongodb and every platform flow into memory.

**Barrels are generated — never edit one by hand.** After adding, renaming or removing a
file:

```bash
npm run build      # regenerates barrels, then regenerates types/
```

Directory names are camelCased on the way in: `claim-management` -> `claimManagement`,
`api-based-flow` -> `apiBasedFlow`.

---

## Consuming from Trackvid-CMS

CMS typechecks with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`,
so the package ships generated `.d.ts` files in `types/` (committed, because a submodule has
no install-time build step). Regenerate them with `npm run types` whenever a signature
changes.

Three rules for the Electron side:

1. **Main process only.** Everything here touches mongodb / axios / fs / puppeteer. None of
   it can run in the renderer — expose it over IPC from `electron/main/`.
2. **Keep it in `dependencies`,** so `externalizeDepsPlugin()` leaves it as a runtime
   `require` and electron-builder packs it into the asar.
3. **Deep-import what you need.** `require(".../common/db")` pulls mongodb and nothing else;
   it never loads a line of puppeteer flow code.

Peer dependencies are all **optional** — npm auto-installs peers, and without that CMS would
pull puppeteer's ~200MB Chromium download. Each consumer declares only the libraries it
actually uses.

---

## Adding a new platform

```bash
p=amazon
mkdir -p platforms/$p/common
for t in claim-management master-import; do
  mkdir -p platforms/$p/$t/common platforms/$p/$t/api-based-flow/common platforms/$p/$t/script-based-flow/common
done
npm run build   # generates the barrels and types for the new dirs
```

## Migrating a utility out of `Automated-Scripts`

1. `git mv` the file into the right level here, and repoint its internal `require`s.
2. Replace the old path in the runner repo with a one-line re-export shim:
   ```js
   module.exports = require("@trackvid/automation-core/platforms/<p>/<type>/<flow>/<file>");
   ```
   Existing callers keep working untouched — no flow gets disturbed by the move.
3. Once every caller has been repointed at the core package, delete the shim.

## Dependencies

Runtime libraries are **peer** dependencies — the runner repo owns the versions, so there is
never a second copy of puppeteer or mongodb in the tree. Add a peer entry here when you
introduce a new one.
