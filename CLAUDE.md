# RN Boilerplate — Claude Instructions

> **Orientation.** Read this header, then `AI_RULES.md` (imported below). Both are binding.

**What it is:** Akshar, an Android floating-screen OCR app (English / Hindi / mixed) built
on a React Native boilerplate. Native capture + ML Kit OCR live in
`android/app/src/main/java/com/rnboilerplate/screenocr/`; see `docs/SCREEN_OCR.md`. The
boilerplate's login/session/API layers remain but are off (`FEATURES.auth = false`).
Offline by design for screen text: no backend, and OCR text/screenshots never leave the
device. The exceptions are opt-in features that exist to talk to other devices or services
(Translation, Remote Access — `docs/REMOTE_ACCESS.md`, Utility → YouTube Downloader —
`docs/UTILITY.md`).

|  |  |
|---|---|
| **Stack** | React Native 0.85 + React 19 + TypeScript (strict) · react-navigation 7 · MMKV · i18next · react-native-config · socket.io-client |
| **Identity** | `RNBoilerplate` / `com.rnboilerplate` — placeholder; see *Renaming the app* in `README.md` |
| **Dev** | `npm start` · `npm run android` · `npm run ios` |
| **Verify** | `npm run typecheck && npm run lint && npm test` |
| **Ship** | `npm run apk:debug` · `npm run apk:release` · `npm run aab:release` |

**[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** explains the layers, the auth flow and
how to add a feature.

## Layers — the order is mandatory

```
Screen  →  Hook  →  Service  →  Repository/Store  →  API client / MMKV
```

A screen never calls an API client directly, and a service never renders. `services/` never
imports from `features/`.

## Layout

```
src/config/           env.ts (validated .env) · apiEndpoint.ts (runtime override) · featureFlags.ts
src/services/api/     client.ts · errors.ts · upload.ts
src/services/realtime/
src/store/mmkv.ts     every storage key, in one place
src/specs/            TurboModule codegen specs — each imported only by its owner's services/
                      (NativeScreenOcr → capture, NativeFollowUp → followup,
                      NativeUtility + NativeRecorder → utility, NativeExpense → expense,
                      NativeNetInspector → network, NativePhotoWidget → photoWidget,
                      NativeRemoteControl → remote,
                      NativeLiveCamera → liveCamera,
                      NativeAlarms → src/services/alarms)
src/services/alarms/  shared alarm engine bridge (Reminders + Utility timers) — docs/REMINDERS.md
src/features/
  expense/            Expense Tracker + Scan QR & Pay (UPI intents) — the start screen;
                      docs/EXPENSE_TRACKER.md
  capture/            screen-OCR service wrapper, settings/history stores, review screen
  onboarding/         one-time setup
  dashboard/          home
  settings/           settings, appearance, about
  life/               Manage Life (projects, targets, widget)
  followup/           Follow Up CRM (contacts, follow-ups, reminders) — docs/FOLLOW_UP.md
  utility/            Utility tools (scanner, documents, compass, AR + angle measure,
                      multiple stopwatch / timer, level, converter, water eject,
                      screen recorder) — docs/UTILITY.md, docs/SCREEN_RECORDER.md
  reminders/          Reminders & alarms (birthdays, events; snooze, ringtones,
                      repeat, survives reboot) — docs/REMINDERS.md
  photoWidget/        home-screen photo widgets (fit / fill / crop, resizable) —
                      docs/PHOTO_WIDGET.md
  network/            Network Inspector: in-app browser (WebView) that records the
                      API calls of allowed sites; list, detail, cURL, JSON export —
                      docs/NETWORK_INSPECTOR.md
  remote/             Remote Access: control a computer/phone running Featured App,
                      or let one control this phone; desktop-compatible protocol
                      (core/), WebRTC video, accessibility input — docs/REMOTE_ACCESS.md
  liveCamera/         Share Live Camera: phone camera → WebRTC (WHIP) → own server
                      (server/live-camera: Node + MediaMTX + Caddy, Docker) → public
                      browser link; foreground service while live — server/live-camera/README.md
  auth/  session/     boilerplate login (disabled)
src/navigation/  src/i18n/  src/theme/  src/types/
src/shared/           assets/ components/ hooks/ utils/ — cross-feature only
```

## Do not

- **Do not hardcode a translatable string.** It goes through i18next; add the key to
  `en.json` first.
- **Do not read `Config.X` outside `src/config/env.ts`.** Parse and validate there.
- **Do not invent an API endpoint.** If it is not in the backend contract you were given,
  stop and say so.
- **Do not put a feature-specific component in `src/shared/`.** `shared/` is for things two
  or more features actually use.
- **Do not add a native dependency without** pinning it exactly, mocking it in
  `jest.setup.js`, and declaring its permissions.
- **Do not lower `targetSdk` below 36 or the NDK below r28** — Play Store floor and 16KB
  page-size compliance.
- **Do not commit secrets** — `.env`, keystores and signing passwords stay out of git.
- **Do not add network access beyond the approved, user-started features** (Speak with
  Translation, YouTube Downloader) **or log extracted text.** Screenshots and OCR text
  never leave the device or reach logs/notifications. Any new network use needs the
  user's explicit approval first.
- **Do not bypass Android capture consent** or secure-screen (`FLAG_SECURE`) protection.

## Definition of done

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass.
- [ ] Verified on a device or emulator — say which platform.
- [ ] New strings in `en.json`; new storage keys in `StorageKeys`; new env vars in
      `env.d.ts`, `env.ts` and `.env.example`.

---

The full engineering rules are in `AI_RULES.md`. Follow them on every task.

@AI_RULES.md
