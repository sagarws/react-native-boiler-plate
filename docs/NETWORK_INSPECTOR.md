# Network Inspector — in-app browser API recorder

Sidebar → **Network Inspector**. Open a website in the app's own browser,
use it normally (log in, navigate, search), and the API calls that site makes
are recorded: URL, method, request headers and body, status, response headers
and body, timing, and a ready-to-run cURL. Records stay on the phone and can be
exported as one JSON file.

Capture is scoped to this app's WebView. It never sees other apps, the system
browser, or any site that is not on the allowed-domain list.

## Using it

1. **Enable Network Capture** (off by default). Turning it on starts a
   recording session; turning it off stops it at once.
2. Add **Allowed domains**, e.g. `seller.snapdeal.com`. Matching is by exact
   host. `*.example.com` or the *Include subdomains* switch also allows
   subdomains. A domain without a port matches the default port only.
3. **Open a website**: type an address, or tap one of the domain chips.
4. Use the site. The capture bar under the address shows **Recording**,
   **Paused**, **Stopped**, or **Not captured** (page not allowed), plus how
   many calls this session recorded. Pause / Resume / Stop / Start are there
   and on the hub.
5. **Captured Network Calls** (list icon in the browser, or on the hub):
   search (URL, endpoint, method, status), filter (All, GET, POST, PUT,
   PATCH, DELETE, 2xx, 4xx, 5xx, Failed), pull to refresh, long-press to
   select, delete, clear all, export.
6. Tap a call for the **detail**: Overview · Req headers · Req body · Res
   headers · Res body · cURL, with copy buttons for URL, request body,
   response and cURL, and Delete.

Session rules: **Pause** stops new requests from being recorded, but a request
already in flight still gets its response. **Stop** ends the session.
Opening the browser with capture on restarts a stopped session. Nothing is
recorded while the toggle is off, not even the end of a request already in
flight; such requests are closed out as *Capture was turned off*.

## How capture works

```
page JS ──fetch / XHR / sendBeacon──▶ capture script (in page, document start)
   │                                     │ batched postMessage (≈200 ms), session token
   ▼                                     ▼
 network (unchanged)        WebView onMessage (+ sender frame origin from the WebView)
                                         ▼
                      CaptureManager: gate → pair request/response → batch
                                         ▼
                      networkRepository (own MMKV file) ──▶ list / detail / export
```

- **Capture script** (`services/captureScript.ts`) wraps `window.fetch`,
  `XMLHttpRequest` and `navigator.sendBeacon`. The page's call goes through
  first and unchanged. `fetch` returns the page's own promise, and response
  bodies are read from `response.clone()` (fetch) or after `loadend` (XHR),
  so requests and responses are never modified. Each recording step is in
  try/catch, so a capture bug can't break the site.
- **Injection**
  - *Android:* `WebViewCompat.addDocumentStartJavaScript`, registered by
    `NetInspectorModule.kt` before the site loads. The browser first loads an
    empty placeholder so the native view exists, attaches the script, then
    navigates. Chromium runs the script before any page script, in every
    frame, but only in frames whose origin matches the allowed domains.
  - *Android fallback:* on a WebView without `DOCUMENT_START_SCRIPT`, the
    script is injected when the page starts loading. The browser warns that
    the first requests of a page may be missed.
  - *iOS:* a document-start `WKUserScript` in all frames
    (`injectedJavaScriptBeforeContentLoaded`, `…ForMainFrameOnly={false}`).
    The script checks its own frame's host and does nothing outside the
    allowed domains.
- **Browser-added headers.** Page JavaScript never sees the headers the
  browser adds itself, so the recorder completes them:
  - *Cookie*: on Android, read from the WebView's own cookie store
    (`CookieManager`, HttpOnly cookies included) for requests the browser
    sends cookies with. That means same-origin requests, or
    `credentials: 'include'` / `withCredentials`. On iOS only
    `document.cookie` is available, which lacks HttpOnly cookies.
  - *Reconstructed in the page*, following the browser's rules: `Accept`
    (default `*/*`), `Accept-Language`, `Origin`, `Referer` (referrer policy
    applied), `User-Agent`, `sec-ch-ua*` (from `navigator.userAgentData`) and
    `sec-fetch-dest/mode/site`.

  The page's own headers always win. Every filled-in header is listed in
  `metadata.inferredHeaders`.
- **Gating** (`services/captureManager.ts`, re-checked natively per message):
  - the global toggle must be on, and the session must be *recording* for new
    requests;
  - the **sending frame's origin** must be allowed. The WebView reports it
    (Android `sourceOrigin`, iOS `frameInfo.request.URL`), so a page can't
    forge it;
  - with scope *Allowed domains* (default), the request URL must also be
    allowed. *All from page* also keeps third-party requests made by an
    allowed page;
  - the message must carry this browser session's random token.
- **Lifecycle**: each request has its own id (page session + counter), so
  concurrent calls to the same URL never swap responses, and repeated events
  are ignored. A page unload reports what was still in flight (*Page was
  left…*). Closing the browser closes the rest (*Browser was closed…*).
  Records left pending by a killed app are closed the next time the browser
  opens.

## Record schema (export)

Every record has the same shape on Android and iOS; unknown values are
`null`:

```jsonc
{
  "id": "uuid-v4",              // generated per request
  "source": "webview",          // in-page instrumentation (not a debugger protocol)
  "tabId": null,
  "frameId": null,              // frame URL for an iframe request, else null
  "pageUrl": "https://seller.snapdeal.com/",
  "origin": "https://seller.snapdeal.com",
  "method": "POST",
  "url": "https://seller.snapdeal.com/omni/get",
  "requestHeaders": { "Content-Type": "application/json" },
  "requestBody": { "kind": "json", "value": {}, "truncated": false, "sizeBytes": 247 },
  "status": 200,
  "statusText": "OK",
  "responseHeaders": {},
  "responseBody": { "kind": "json", "value": {}, "truncated": false, "sizeBytes": 500 },
  "resourceType": "Fetch",      // Fetch | XHR | Beacon
  "mimeType": "application/json",
  "startedAt": "…Z", "completedAt": "…Z", "durationMs": 1000,
  "error": null,                // network error / cancellation
  "curl": "curl 'https://…' \\\n  -X 'POST' …",
  "metadata": { "requestId": "page-session:1", "normalizedEndpoint": "/omni/get", "pending": false,
                "inferredHeaders": ["Accept-Language", "Referer", "User-Agent", "Cookie"] }
}
```

Body kinds:

- `json`: the parsed value.
- `text`: the string.
- `formData`: `[{name, value}]`, or `{name, value: null, fileName, type, sizeBytes}`
  for a file part.
- `binary`: base64 with `"encoding": "base64"`, or `value: null` when over
  the limit. Binary content is never decoded into text.
- `unknown`: a short description, e.g. a streaming or opaque response.

Bodies over the **body size limit** (32 KB / 128 KB default / 512 KB / 1 MB)
are cut, marked `"truncated": true`, and `sizeBytes` keeps the original size
when known. A truncated JSON body is kept as `text`, because it no longer
parses.

Export file: a bare JSON array of records (`[ {…}, {…} ]`, newest first),
UTF-8, named like `network-capture-snapdeal-2026-11-16.json`. Export covers all
records, the filtered list, or the selection. It goes to the share sheet
(Android writes a private cache file and shares it through FileProvider; only
the latest export is kept) or to **Save to device** (system picker, Android).
Records are prepared in chunks so a large export doesn't freeze the UI.

## cURL

`services/curl.ts` produces a POSIX-shell command: every argument is
single-quoted and `'` becomes `'\''`, so `$`, backticks, `!` and newlines are
literal. Tests run the output through `/bin/sh` to check this.

- The method is set with `-X` only when curl's default wouldn't match: GET
  without a body, or POST with one, needs none (Chrome's "Copy as cURL" does
  the same). The query string is kept as is.
- Request headers are included, except `Content-Length` and `Host`, and the
  Cookie header becomes `-b '…'`.
- Bodies: JSON or text as `--data-raw`; form fields as `--form-string`, which
  never reads a file for a leading `@`.
- File parts and binary bodies get a note, because their bytes aren't
  inlined.

## Privacy and security

- **Local only.** No uploads; calls live in their own MMKV file
  (`app.networkInspector`) until the user deletes them, at most 1,000 records
  (oldest drop off). Captured content is never logged; only error codes are.
- **Redaction (default on)** for copies, the cURL tab and exports:
  - `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, API-key,
    CSRF and auth-token headers;
  - JSON keys, form fields and query parameters whose names look like
    passwords, tokens, secrets, sessions, OTPs, PINs or CVVs.

  All of these become `[REDACTED]`. *Include sensitive values in copies &
  exports* turns this off. The detail screen always shows what was captured.
- Copies are marked sensitive, so Android 13+ hides the clipboard preview.
- The browser only loads `http(s)` pages (no `intent:`, `file:`,
  `javascript:`): file access off, mixed content blocked, no extra windows.
  WebView debugging is on in debug builds only.
- Nothing bypasses site authentication, CORS or browser security: the
  recorder sees only what the page's own JavaScript can see.

## Known limitations (be aware when reading captures)

| Not captured / partial | Why |
|---|---|
| Top-level navigations, form posts that load a page, `<img>`/`<script>`/CSS loads | Made by the browser itself, not page JavaScript. |
| Requests from **service workers** or web workers | Workers run outside the page's JavaScript context. |
| **WebSocket**, EventSource, WebRTC | Not wrapped. |
| **Streaming** responses (`text/event-stream`) | Body not read, recorded as `unknown`, so the stream is never held open or buffered. |
| Browser-added request headers | Reconstructed, not observed. They match what the browser sends in normal cases, but a few aren't produced: `priority`, `Accept-Encoding`, `X-Requested-With` added by the WebView, and redirect-dependent `sec-fetch-site`. `sec-fetch-site` uses an approximate *same-site* check without the public-suffix list. |
| Cookies | Android: the cookie store's cookies for the URL, so `SameSite` restrictions on cross-site requests aren't applied. iOS: `document.cookie` only (no HttpOnly), same-origin requests only. |
| Cross-origin response headers | Only the headers the server exposes (CORS) are readable. |
| `no-cors` (opaque) responses | Status 0, body unreadable by design. |
| `sendBeacon` responses | Fire-and-forget; recorded with `status: null`. |
| Very first requests on a WebView without document-start support (old Android WebView) | Fallback injection runs at page start; the browser shows a warning. |
| Requests from iframes on **other** origins | Their frames don't get the script (by design: only allowed origins). |
| Chrome DevTools Protocol | Not available to an app's own WebView, so all capture is in-page. |
| A page that deliberately overwrites `fetch`/`XHR` before our wrapper is installed | Impossible with document-start injection, but possible with the Android fallback. |

## Code

- JS: `src/features/network/`
  - `screens/`: hub, browser, calls list, detail.
  - `hooks/`: `useBrowserCapture` (script, injection mode, manager
    lifecycle), `useCapturedCalls` (search, filters, paging),
    `useCallDetail`, `useNetworkExport`, `useNetworkSettings`.
  - `services/`: `captureScript`, `captureManager`, `curl`, `redact`,
    `export.service`, `native.service`.
  - `repository/network.repository.ts`, `store/networkSettings.store.ts`.
  - `utils/`: `url`, `domainFilter`, `filters`, `uuid`.
- Native: `android/.../netinspector/NetInspectorModule.kt`. It provides
  document-start script registration, sensitive copy, share as file and
  "Save to…", and reuses `common/DocumentSaver` and `common/FileShare`.
- Spec: `src/specs/NativeNetInspector.ts`, imported only by
  `features/network/services`.
- Dependencies:
  - `react-native-webview@16.0.0` (pinned; mocked in `jest.setup.js`; no new
    permissions, since `INTERNET` was already declared);
  - `androidx.webkit:webkit:1.14.0` (the version react-native-webview builds
    against).
- Storage keys: `StorageKeys.NetworkSettings` (main store),
  `NetworkIndex` and `NetworkRecordPrefix` (in `networkStorage`).

### iOS

The WebView, capture script, list, detail and export logic are shared.
`NativeNetInspector` is Android-only, so on iOS:

- **copy** and **export** open the system share sheet, whose *Copy* / *Save to
  Files* do the job;
- **Save to device** is hidden.

Run `cd ios && pod install` after pulling (new pod: `react-native-webview`).

## Manual test checklist

1. Toggle off → open a site → use it → no calls appear.
2. Toggle on, add `seller.snapdeal.com`, open it → bar shows *Recording*; log
   in and navigate → GET/POST calls appear with bodies and responses.
3. Navigate to another domain → bar shows *Not captured*; nothing is added.
4. Add `snapdeal.com` without subdomains → `seller.snapdeal.com` is not
   captured; with subdomains it is.
5. Pause → new calls stop appearing; Resume → they appear again.
6. A failing call (e.g. airplane mode) → *Failed* with the error.
7. A large response with a 32 KB limit → *Truncated* note on the detail.
8. Detail → cURL. Turn on *Include sensitive values*, then Copy and paste
   into a terminal. It runs with the cookies (`-b`) and browser headers
   included.
9. Export → Share/Save → the file opens as valid JSON with the website and
   date in its name.
10. Kill and reopen the app → calls are still there; Clear all → empty.
