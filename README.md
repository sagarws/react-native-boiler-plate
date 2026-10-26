# RN Boilerplate

React Native **0.85.3** app starter. New Architecture only, TypeScript strict,
feature-sliced `src/`, native-stack navigation with a side drawer, i18next with typed keys,
light/dark theming from design tokens, `@/*` path aliases, `.env` via `react-native-config`,
and an Android 15 / 16KB page-size-ready build (NDK r28, targetSdk 36).

It ships a working app **shell**, not a blank template:

- email/password **login → session → signed-in stack**, with the session persisted in MMKV
  and the root navigator swapping subtrees on sign-in/sign-out
- a **REST client** with bearer-token injection, timeouts, typed errors
  (`ApiError` / `NetworkError` / `TimeoutError`) and response-envelope unwrapping
- a **multipart upload** helper and a lazy **Socket.IO** singleton that share the same token
- a **runtime API-endpoint override** (gear on the login screen) for QA/dev builds
- **dashboard**, **settings** (theme, language, sign out) and a **drawer**
- shared components: `Button`, `TextField`, `Header`, `AuthHeader`, `Loader`, `ToggleSwitch`,
  `Slider`, `SearchSelect`, `MobileNumberInput`, `LanguageDropdown`, `ConnectionBadge`,
  `ApiEndpointModal`, `BrandLogo`, `ScreenContainer`
- Jest + react-test-renderer with native-module mocks already wired

Extracted from a production app (TrackVid Mobile); the domain features were removed and the
infrastructure kept.

---

## Quick start

```bash
cp .env.example .env    # then set API_BASE_URL
npm install
cd ios && bundle install && bundle exec pod install && cd ..   # macOS only
npm start               # terminal 1
npm run android         # terminal 2  (or: npm run ios)
```

Verify: `npm run typecheck && npm run lint && npm test`

### Wire it to your backend

The auth flow assumes this contract — change it in one place each:

| What | Where | Default |
|---|---|---|
| Login endpoint + payload | `src/features/session/session.api.ts` | `POST /api/auth/login` `{ email, password, versionName }` |
| Session / user shape | `src/features/session/session.types.ts` | `{ accessToken, user: { id, name, email } }` |
| Response envelope | `src/services/api/client.ts` → `ApiEnvelope` | `{ isSuccess, message?, displayMessage?, data }` |
| Upload endpoint | `src/services/api/upload.ts` | `POST /api/upload`, field `files` |

If your API returns bare JSON instead of an envelope, use `apiClient.get/post` instead of
`getData/postData`.

---

## Renaming the app

The placeholder identity is **`RNBoilerplate`** / **`com.rnboilerplate`**. Rename before your
first store upload — the `applicationId` / bundle id cannot change afterwards.

1. `app.json` — `name` (must match the native component name) and `displayName`.
2. Android
   - `android/settings.gradle` → `rootProject.name`
   - `android/app/build.gradle` → `namespace` and `applicationId`
   - move `android/app/src/main/java/com/rnboilerplate/` to your package path and update
     the `package` line in `MainActivity.kt` / `MainApplication.kt`
   - `MainActivity.kt` → `getMainComponentName()` must equal `app.json` `name`
   - `res/values/strings.xml` → `app_name` and `build_config_package` (= `namespace`)
   - `package.json` → `reload:android` broadcast action
3. iOS — rename `ios/RNBoilerplate/`, `ios/RNBoilerplate.xcodeproj` and its scheme, then
   replace `RNBoilerplate` in `Podfile`, `project.pbxproj`, the `.xcscheme`, `AppDelegate.swift`,
   `Info.plist` and `LaunchScreen.storyboard`; set `PRODUCT_BUNDLE_IDENTIFIER`. Re-run
   `pod install`.
4. `scripts/icon/generate-icons.js` → `IOS_TARGET`.
5. `src/i18n/locales/en.json` → `common.appName`; `src/store/mmkv.ts` → the MMKV `id`.

Then replace the artwork: `scripts/icon/brand-icon.svg` (run
`npm i -D sharp && node scripts/icon/generate-icons.js` to regenerate launcher icons), the
logos in `src/shared/assets/images/`, and the palette in `src/theme/tokens/colors.ts`.

---

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Metro |
| `npm run android` / `ios` | Debug build on device/emulator |
| `npm run reload:android` | Broadcast a JS reload to the running Android debug app |
| `npm run apk:debug` / `apk:release` / `aab:release` | Android artifacts |
| `npm run typecheck` / `lint` / `test` | Verification |
| `npm run clean` | Watchman, node_modules, Pods, Gradle and Metro caches |

### Release signing (Android)

Put the upload key's credentials in `~/.gradle/gradle.properties` (or CI secrets), never in
the repo:

```properties
APP_UPLOAD_STORE_FILE=/absolute/path/to/upload.jks
APP_UPLOAD_STORE_PASSWORD=...
APP_UPLOAD_KEY_ALIAS=...
APP_UPLOAD_KEY_PASSWORD=...
```

Without them, release builds are signed with the debug key — fine for local testing, rejected
by Play.

---

## Dependencies

Native modules are pinned to **exact** versions so a fresh install can't pull a
build-breaking native change. Pure-JS and dev packages keep ranges.

| Package | Version | Role |
|---|---|---|
| `react` / `react-native` | `19.2.3` / `0.85.3` | New Architecture only |
| `@react-navigation/native` / `native-stack` | `7.2.5` / `7.16.0` | Navigation |
| `react-native-screens` | `4.25.2` | Required by react-navigation |
| `react-native-safe-area-context` | `5.5.2` | Insets |
| `react-native-mmkv` | `3.3.3` | Session, theme, language, endpoint override |
| `react-native-config` | `1.6.1` | `.env` → native at build time |
| `react-native-localize` | `3.7.0` | Device locale for i18n bootstrap |
| `react-native-permissions` | `^5.6.1` | Runtime permissions (notifications at startup) |
| `i18next` / `react-i18next` | `26.3.1` / `17.0.8` | i18n |
| `socket.io-client` | `^4.8.3` | Realtime singleton + `ConnectionBadge` — drop if unused |

Adding a native module: pin it exactly, add a mock to `jest.setup.js`, add it to
`transformIgnorePatterns` in `jest.config.js` if it ships untranspiled ESM, declare any
permission in `AndroidManifest.xml` / `Info.plist`, and re-check 16KB alignment.

---

## Toolchain

| Tool | Required |
|---|---|
| Node | `>= 22.11.0` |
| JDK | 17 |
| Android SDK | Platform 36 |
| Android NDK | **r28+** (`ndkVersion` in `android/build.gradle` must match an installed version exactly) |
| Xcode | 16.x |
| CocoaPods | via `bundle install && bundle exec pod install` |

---

## Android 15 / 16KB page-size verification

Every bundled `.so` must be 16KB-aligned or Play rejects the build for Android 15+.

```bash
npm run apk:release
APK=android/app/build/outputs/apk/release/app-release.apk
mkdir -p build/extracted-apk && unzip -o "$APK" -d build/extracted-apk
for arch in arm64-v8a x86_64; do
  for so in build/extracted-apk/lib/$arch/*.so; do
    printf "%-50s align=%s\n" "$(basename "$so")" "$(readelf -lW "$so" | awk '/LOAD/ {print $NF; exit}')"
  done
done
# every line must show align=0x4000

$ANDROID_HOME/build-tools/36.0.0/zipalign -c -P 16 -v 4 "$APK"   # must exit 0
```

---

## Project structure

Each folder under `src/features/` owns its screens, hooks, API calls and local state, and
exposes a barrel `index.ts`. Cross-feature imports go through that barrel.

```
.
├── App.tsx                 # token provider, startup permissions, RootNavigator
├── AI_RULES.md             # engineering rules (CLAUDE.md imports it)
├── docs/ARCHITECTURE.md    # layers, data flow, extension points
├── android/  ios/          # RNBoilerplate / com.rnboilerplate
├── scripts/icon/           # brand-icon.svg + launcher-icon generator
└── src/
    ├── config/             # env.ts (validated .env), apiEndpoint.ts (override), featureFlags.ts
    ├── features/
    │   ├── auth/           # LoginScreen, useLogin, validation
    │   ├── session/        # session store (MMKV), useSession, login/signOut API
    │   ├── dashboard/      # signed-in landing screen — replace with your home
    │   └── settings/       # theme, language, sign out
    ├── i18n/               # i18next init, languages, typed keys, locales/en.json
    ├── navigation/         # Root → Auth | Main stacks, drawer, routes, typed params
    ├── services/
    │   ├── api/            # fetch client, errors, multipart upload
    │   └── realtime/       # Socket.IO singleton + useSocketStatus
    ├── shared/             # assets/ components/ hooks/ utils/ — cross-feature only
    ├── store/mmkv.ts       # MMKV instance + the one list of storage keys
    ├── theme/              # tokens, preference, useTheme()
    └── types/env.d.ts      # react-native-config typings
```

### Where things are wired

| Concern | Entry point |
|---|---|
| Auth token on every request | `App.tsx` → `setAuthTokenProvider` → `services/api/client.ts` |
| Signed-in vs signed-out UI | `navigation/RootNavigator.tsx` (subscribes to `useSession`) |
| Changing the backend at runtime | `ApiEndpointModal` → `config/apiEndpoint.ts` (REST **and** socket follow it) |
| Adding a signed-in screen | feature folder → `navigation/routes.ts` + `types.ts` → `MainNavigator.tsx` |
| Adding a translation | key in `en.json` first (it defines the key type), then other locales |
| Adding an env var | `src/types/env.d.ts` → parse in `config/env.ts` → `.env.example` → **rebuild native** |

---

## Known fragile points

1. **`.env` changes need a native rebuild** — `react-native-config` bakes values in at build
   time. A Metro reload keeps serving the old value.
2. **Never read `Config.X` from a screen** — it only returns strings (`"false"` is truthy).
   Parse in `config/env.ts`.
3. **The API endpoint override is sticky** — it wins over `.env` until reset. Switch
   `FEATURES.loginDevSettings` off for store builds; doing so also ignores any stored override.
4. **Session shape is a persisted contract** — `Session` is JSON in MMKV. Changing it doesn't
   migrate devices; keep new fields optional or bump `StorageKeys.Session`.
5. **Typed i18n keys** — `t('missing.key')` is a compile error. Runtime-built keys need a
   literal union, not `as never`.
6. **NDK version string** must exactly match an installed NDK.
