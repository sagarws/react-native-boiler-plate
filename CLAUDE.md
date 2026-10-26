# RN Boilerplate — Claude Instructions

> **Orientation.** Read this header, then `AI_RULES.md` (imported below). Both are binding.

**What it is:** a React Native starter extracted from a production app. It ships an app
shell — login → persisted session → drawer + stack, settings, typed API client, realtime
socket, theming and i18n — with no domain features. New features go under `src/features/`.

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
src/features/
  auth/               login screen, useLogin, validation
  session/            session store, useSession, login/signOut API
  dashboard/          signed-in landing — placeholder
  settings/           theme, language, sign out
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

## Definition of done

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass.
- [ ] Verified on a device or emulator — say which platform.
- [ ] New strings in `en.json`; new storage keys in `StorageKeys`; new env vars in
      `env.d.ts`, `env.ts` and `.env.example`.

---

The full engineering rules are in `AI_RULES.md`. Follow them on every task.

@AI_RULES.md
