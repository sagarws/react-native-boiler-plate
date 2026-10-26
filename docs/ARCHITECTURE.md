# Architecture

## Layers

```
Screen  →  Hook  →  Service / API module  →  Store / API client  →  MMKV / fetch
```

- **Screens** render and hold UI state only. They never call `apiClient` or `fetch`.
- **Hooks** (`features/*/hooks`) orchestrate: validate input, call a service, expose
  `{ data, loading, error, actions }` to the screen.
- **Services / API modules** (`features/*/*.api.ts`, `services/*`) talk to the network and
  persist results. They never render.
- **Stores** (`features/session/session.store.ts`, `store/mmkv.ts`) are synchronous,
  MMKV-backed singletons with a `subscribe` so React and non-React callers share one source.

`services/` must not import from `features/`. When a service needs something a feature owns
(the auth token), the feature registers it — see `setAuthTokenProvider` in `App.tsx`.

## Auth flow

1. `LoginScreen` → `useLogin().submit()` validates and calls `login()` (`session.api.ts`).
2. `login()` posts credentials, unwraps the envelope, and writes the `Session` to MMKV.
3. `sessionStore.write()` notifies subscribers; `useSession()` in `RootNavigator` re-renders
   and swaps the `Auth` subtree for `Main`. No imperative navigation.
4. Every request reads the token fresh through the provider registered in `App.tsx`.
5. `signOut()` clears the store; the same subscription swaps back to `Auth`, so no signed-in
   screen can stay mounted behind the login form.

## Networking

`services/api/client.ts`:

- `request()` — base URL from `getApiBaseUrl()`, JSON headers, bearer token, 15s timeout via
  `AbortController`, optional caller `signal`. Non-2xx → `ApiError`; abort → `TimeoutError`;
  anything else → `NetworkError`. Every failure is logged.
- `requestData()` — unwraps `ApiEnvelope<T>`; `isSuccess: false` with a 2xx status becomes an
  `ApiError`, so callers have one failure channel.
- `apiClient.get/post/put/patch/delete` (raw) and `getData/postData` (envelope).

`upload.ts` builds multipart requests outside the JSON client so React Native sets the
boundary, but uses the same base URL and token. `realtime/socket.ts` is created lazily on
first `getSocket()` and is torn down and rebuilt when the endpoint override changes.

## Navigation

```
RootNavigator (NavigationContainer, themed from tokens)
├── Auth  → AuthNavigator  → Login
└── Main  → MainNavigator  → DrawerHost → Dashboard, Settings
```

The drawer is an animated overlay (`navigation/drawer/DrawerHost.tsx`), not a drawer
navigator, to avoid the gesture-handler and reanimated native dependencies. Because it wraps
the stack, its `navigation` object belongs to the root navigator: navigate to main-stack
screens with `navigation.navigate(ROUTES.MAIN, { screen })`.

Route names live in `routes.ts`; param lists in `types.ts`, which also augments
`ReactNavigation.RootParamList` so `useNavigation()` is typed without generics.

## Configuration

- `.env` → `react-native-config` (native, build time) → `config/env.ts` validates once at
  module load and throws on a missing/invalid value, so a bad build fails at launch rather
  than on the first request.
- `config/featureFlags.ts` — per-build UI switches, typed as `boolean` so disabled branches
  keep type-checking.
- `config/apiEndpoint.ts` — MMKV-persisted base-URL override with subscribers; ignored
  entirely when `FEATURES.loginDevSettings` is off.

## Theming and i18n

- `theme/tokens/*` define colours (light + dark with identical keys), spacing, typography,
  radius, shadows, z-index and responsive helpers (`wp`, `hp`). `useTheme()` resolves the
  active palette from the persisted preference (`system | light | dark`).
- `i18n/index.ts` picks the persisted language, else the first supported device locale, else
  English. `react-i18next.d.ts` types every key from `en.json`.

## Testing

Jest runs with the RN preset as Android (`jest.config.js`). `jest.setup.js` mocks every
native module the app imports — MMKV with an in-memory map, `react-native-config` with test
values, safe-area with its official mock. Tests assert on structure and behaviour (texts,
`testID`s, accessibility labels), not snapshots.

## Adding a feature

1. `src/features/<name>/` with `screens/`, `hooks/`, `<name>.api.ts`, `<name>.types.ts`, and
   an `index.ts` barrel.
2. Add the route to `navigation/routes.ts` and `types.ts`, register it in `MainNavigator`.
3. Add strings to `en.json`; storage keys to `StorageKeys`.
4. Tests next to the code in `__tests__/`.
