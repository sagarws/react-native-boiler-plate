# VMS (Argos Watch) → TrackVid CMS merge plan

> **Source (read only):** `/Users/apple/Documents/Sagar/Trackvid/Argos-Watch-TrackVid-App` @ `59a1e23`
> **Target:** this folder (TrackVid CMS, already re-skinned in the Veylix look)
> **Progress:** `VMS_PROGRESS.txt` · **Written:** 2026-11-18 · **Mode:** autonomous (user away), decisions logged.

## 0. Goal

One desktop app. A **mode toggle at the bottom of the sidebar** switches between **CMS** (today's app) and
**VMS** (Argos Watch's recorder). The VMS sidebar carries the same toggle back to CMS.

- **One login: the CMS login.** No feed login screen. An admin (or a user with `feed::view`) picks a **feed in the
  VMS header**; the app gets that feed's session from the new backend endpoint and records "as" that feed.
- **VMS functionality stays the same** (AWB capture, Forward/Return, condition popup, screenshots, product SKU
  panel, webcam + RTSP cameras, local upload queue with retry, compression, failed-orders list + PDF, storage /
  date-mismatch / idle guards, multi-step recording).
- **VMS UI is the Veylix template look**, built on the CMS UI layer (MUI 7 theme `veylixTheme.ts` + Tailwind +
  `components/ui/*`). VMS's own MUI 6 / icons-material / redux / router are **not** brought over.

## 1. Backend (done first)

Recording uploads (`file.trackvid.in/order/create-order`) only accept a **FeedUser** token. New endpoint in both
backends — **`POST /api/auth/feed-token`**, guard `adminAuth(["feed::view"])`, body `{ feedId, versionName?, force? }`:
- feed + its FeedUser must be in the caller's company, not disabled;
- station lock kept: a feed already signed in answers **409** `{ data: { feedName, alreadyLoggedIn: true } }`;
  repeat with `force: true` after the operator confirms (same as Argos Watch's takeover warning);
- success = **exactly the `feed-login` body** (`accessToken` + `user{ feedId, feed, company{…} }`).
- TrackVid-BE: `issueFeedToken` + shared `respondWithFeedSession` (feed-login refactored onto it).
- Nest BE: `src/modules/auth/feed-token.handler.ts` (pinned legacy has no such handler; it builds the body
  server-side and delegates to legacy `loginFeedUser`). Replace with a plain `delegate` after the pin moves.
- Feed list for the picker: `GET /api/feed/common-feed` (authMiddleware, admin token; returns names/ids only —
  **not** `POST /api/feed`, which leaks feed passwords).
- Not committed, not deployed. **The VMS mode works only against a backend that has the endpoint.**

## 2. Architecture in the CMS

```
shared/vms/                 types copied from Argos (auth/feed session, queue, order, usage) + VMS_CHANNELS
electron/main/vms/          feedSession.service   (feed list, feed-token, release, company settings)
                            sidecar.service       (node:http + ws on 127.0.0.1:8002+: POST /upload, WS /rtsp)
                            rtspBridge.service    (bundled ffmpeg → fMP4 → ws)
                            queue.store           (JsonCollection, same columns as Argos' SQLite table)
                            uploadDriver.service  (remux/compress with bundled ffmpeg, axios+form-data upload)
                            vms.ipc.ts            (all vms:* handlers)
electron/renderer/vms/      VmsShell (rail + header feed picker), RecorderPage (CaptureShell port),
                            webcam/RTSP hooks, queue badge + Failed uploads dialog, guards
electron/renderer/layout/   ModeToggle at the rail's foot (both modes)
```
- Mode is renderer state, persisted in `preferences` (`appMode: 'cms' | 'vms'`).
- Channels live in `shared/constants/channels.ts` (one list), namespaced `vms:*` so nothing collides.
- Argos' global CSP / permission handler: only the parts VMS needs are added to the CMS's own (camera +
  microphone permission; `ws://127.0.0.1:*` and `blob:` media in the renderer CSP). The 256 MB heap flag is NOT
  carried over (it would starve the CMS's automations).
- macOS camera/microphone usage strings + entitlements added to `electron-builder.yml` / `build/`.
- Feed token is held in main memory only; released (`feed-logout`) on feed switch, CMS sign-out and quit.

## 3. Rules kept
CMS `CLAUDE.TRACKVID.md` rules (renderer never reaches Node, IPC only via `ipcClient`, channels in one file,
storage paths in `database/index.ts`, no raw colours, no native modules, no silent deps, no version bumps).
No git commits / branch changes / pushes / deploys. Never log in, record or upload for real; UI checked in the
stub-bridge gallery (scratchpad harness) and with `npm run verify`.

## 4. Phases
- **V0** backend endpoint (both repos) ✅
- **V1** contracts: `shared/vms/*`, channels, preload allowlist, `appMode` preference
- **V2** main: feed session, sidecar, RTSP bridge, queue store, upload driver, IPC, permissions/CSP
- **V3** renderer: mode toggle, VMS shell + feed picker, recorder (webcam + RTSP), queue badge/dialog, guards
- **V4** packaging: entitlements, usage strings, ffmpeg availability, `npm run verify`, `build:unpack`
- **V5** report (bottom of `VMS_PROGRESS.txt`)
