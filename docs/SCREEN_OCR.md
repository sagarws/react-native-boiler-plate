# Floating screen OCR

Akshar lets the user tap a floating button over any app and get that screen's text, in
English, Hindi or both, copied to the clipboard. OCR runs on the device. There is no
account, no API key, no backend, and release builds have no `INTERNET` permission at all.

Android only. On iOS (and under Jest) the native module is absent and the UI says the
floating button is unavailable.

---

## How a capture works

```
tap bubble ──► hide bubble (120 ms) ──► attach ImageReader to the idle VirtualDisplay
           ──► first frame → Bitmap (row padding cropped, short side ≤ 1080 px)
           ──► detach surface (display idles again) ──► show bubble with spinner
           ──► ML Kit (Latin / Devanagari / both) on ML Kit's worker threads
           ──► assemble text in reading order ──► clipboard + toast
           ──► latest result in memory; queued for history if history is on
           ──► "ScreenOcrResult" event → JS drains the queue into MMKV history
```

- **No continuous capture.** The virtual display is created with no surface. A surface
  is attached only for the duration of one tap, so no frames are rendered or copied
  while the app is idle, and nothing polls.
- **One capture at a time.** An `AtomicBoolean` drops taps while a capture is in flight.
- **The bubble is never in the screenshot.** It is hidden before the frame is taken.
- **Nothing sensitive is logged or shown in notifications.** Logs carry only exception
  class names, and the notification text is fixed. Background copies are flagged
  `EXTRA_IS_SENSITIVE`, so Android 13+ hides the clipboard preview.
- **Bitmaps are recycled** as soon as OCR finishes. Screenshots never touch disk.

### OCR modes

| Mode | Recogniser(s) | Behaviour |
|---|---|---|
| English | ML Kit Latin | Latin script only |
| Hindi | ML Kit Devanagari | Devanagari; the model also reads embedded Latin words |
| Hindi + English | Both, in parallel | Merged line by line (below) |

How the mixed merge works (`OcrTextAssembler.mergeMixed`, unit-tested in
`android/app/src/test`):
- **Base:** the Devanagari model's lines are the starting point. Any line containing
  Devanagari, such as `आपका Order Successfully Shipped हो गया है।`, is kept verbatim.
- **Purely Latin lines:** a line that came out with no Devanagari is replaced by the
  Latin model's reading of the same box, but only on a near-exact box match (IoU ≥ 0.8).
  The Latin model is stronger on English.
- **Missed lines:** Latin lines the Devanagari pass missed entirely are added.

Text is then ordered top-to-bottom and left-to-right, with one line per row and blocks
kept together. Recognition is not perfect: small, blurred, stylised or animated text
reduces accuracy.

### Models

Both ML Kit libraries are the **bundled** variants, so the models ship inside the APK:
- `com.google.mlkit:text-recognition:16.0.1`
- `com.google.mlkit:text-recognition-devanagari:16.0.1`

Nothing is downloaded on first use, so the app works offline from install. The cost is
APK size; use an AAB so Play delivers per-ABI splits. Recognisers are created on first
use and reused until the service stops.

---

## Permissions

| Permission | Why |
|---|---|
| `SYSTEM_ALERT_WINDOW` ("Display over other apps") | Draws the floating button. Granted by the user in system settings. |
| Screen-capture consent (MediaProjection) | Android's own dialog; asked each time the button is turned on, because the token is single-use and cannot be stored. On Android 14+ the request is pinned to the entire screen. |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION` | Android requires a `mediaProjection` foreground service while a capture session is held. Its notification has a **Stop** action. |
| `POST_NOTIFICATIONS` | Shows that notification on Android 13+. Without it the service still works, but the notification is hidden. |
| `INTERNET` | **Debug only**, so the app can reach Metro. Removed from release by `src/release/AndroidManifest.xml`, including any library-declared copy such as ML Kit's usage logging. |

No other permission is requested: no storage, camera, location or accessibility service.

---

## Lifecycle and failure handling

| Situation | What happens |
|---|---|
| Consent dialog declined | Promise resolves `false`; the UI explains and offers to retry. |
| Overlay permission missing | `startOverlay` rejects `overlay_permission`; the UI opens system settings. |
| Overlay permission revoked while running | On return to the app, JS sees `serviceRunning && !overlayPermission`, stops the service, and shows a "revoked" notice. |
| Projection ended (status-bar stop, lock screen on newer Android, another app) | `MediaProjection.Callback.onStop` → toast → service shuts down. Turn the button on again to re-consent. |
| Service killed / app restarted | `START_NOT_STICKY`: never silently restarted, because a projection cannot outlive its consent. The UI re-reads the status on foreground. |
| Rotation | Bubble re-placed from its stored edge and vertical ratio; the virtual display and reader are resized before the next capture. |
| Secure screens (`FLAG_SECURE`, DRM) | Android returns black pixels → "No readable text found". Not worked around. |
| No text / OCR failure / capture timeout | Specific toast; the clipboard is **not** overwritten. |

---

## Code map

```
android/app/src/main/java/com/rnboilerplate/screenocr/
  ScreenOcrModule.kt         TurboModule (codegen spec: src/specs/NativeScreenOcr.ts)
  ScreenOcrPackage.kt        registered in MainApplication
  CaptureConsentActivity.kt  invisible; shows the system consent dialog
  OverlayCaptureService.kt   mediaProjection FGS: bubble + capture + OCR + clipboard
  FloatingBubble.kt          draggable overlay window, edge snap, persisted position
  ScreenCapturer.kt          MediaProjection → VirtualDisplay → ImageReader, one frame per tap
  OcrEngine.kt               ML Kit recognisers, mode dispatch
  OcrTextAssembler.kt        pure merge + reading order (JVM unit tests)
  OcrConfig.kt               SharedPreferences: settings mirror, position, pending queue
  ScreenOcrBus.kt            in-process hand-off + clipboard helper

src/features/capture/        service wrapper, stores, hooks, review screen
src/features/onboarding/     one-time setup
src/features/dashboard/      home
src/features/settings/       settings, appearance (theme + text style), about
src/theme/                   presets, typography presets, ThemeProvider
```

- **Settings flow (JS → native):** settings live in MMKV, the JS source of truth.
  `useCaptureSync` mirrors them, plus the theme's primary colours for the bubble, into
  native SharedPreferences, so the service works without a JS runtime.
- **Results flow (native → JS):** the service queues results natively. JS pulls them on
  launch, on foreground, and on the `ScreenOcrResult` nudge. Results are pulled, never
  pushed with a payload, so nothing is ingested twice.

---

## Testing

```bash
npm run typecheck && npm run lint && npm test         # JS: stores, service, hooks, app flow
cd android && ./gradlew :app:testDebugUnitTest        # Kotlin: OCR text assembly
```

### On a physical device

The emulator can run the UI, but the real capture path needs a device.

1. `adb devices` must list the phone as `device`. If it says `unauthorized`, accept the
   USB-debugging prompt on the phone.
2. `npm start` in one terminal and `npm run android` in another.
3. Onboarding:
   - choose **Hindi + English**
   - choose a theme
   - tap **Allow** for *Display over other apps* (system settings opens; enable it and
     come back)
   - allow notifications
4. Home → **Turn on floating button** → in Android's dialog choose **Entire screen** →
   **Start**.
5. Open a browser on a page with Hindi and English text and tap the violet bubble.
   Expect "Text copied successfully". Paste into any text field to check.
6. **Long-press** the bubble → the app opens on the extracted text. Then:
   - try **Edit**, **Select all**, **Copy**, **Share** and **Clear**
   - drag the bubble, then rotate the phone
   - stop the session from the notification and confirm the bubble disappears
7. Check the failure paths:
   - a banking app or DRM video gives "No readable text found"
   - revoking the overlay in system settings, then reopening the app, shows the revoked
     notice
