# Floating screen OCR

Akshar lets the user tap a floating button over any app and get that screen's text, in
English, Hindi, Gujarati or a mix, then either copy it, read it aloud, or read a long
page aloud while scrolling. OCR runs on the device; speech uses the phone's own
text-to-speech engine. There is no account, no API key, no backend, and release builds
have no `INTERNET` permission at all.

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

ML Kit Text Recognition v2 has **no Gujarati model** (its scripts are Latin, Chinese,
Devanagari, Japanese and Korean, and Devanagari does not cover Gujarati). Gujarati
uses **Tesseract 5** (Tesseract4Android 4.9.0) with the `guj` + `eng` fast LSTM models
from tessdata_fast (Apache-2.0), bundled in `assets/tessdata` and copied to app storage
on first use.

| Mode (stored id) | Recogniser(s), in parallel | Merge |
|---|---|---|
| English (`english`) | ML Kit Latin | — |
| Hindi (`hindi`) | ML Kit Devanagari | — (reads embedded Latin itself) |
| Gujarati (`gujarati`) | Tesseract `guj+eng` | — (reads embedded English itself) |
| Hindi + English (`mixed`) | Devanagari + Latin | `mergeMixed(…, DEVANAGARI)` |
| Gujarati + English (`gujarati_english`) | Tesseract + Latin | `mergeMixed(…, GUJARATI)` |
| Hindi + Gujarati (`hindi_gujarati`) | Devanagari + Tesseract | `mergeByConfidence` |
| Hindi + Gujarati + English (`all`) | all three | `mergeByConfidence`, then `mergeMixed` with Latin |

`mixed` keeps its original id so settings saved by earlier versions still load.

**`mergeByConfidence`** handles Hindi + Gujarati, where each model tends to force the
other script into its own (Gujarati read as Devanagari and vice versa):
- Lines are matched by box.
- The reading with the higher score wins. Score = engine confidence, plus a bonus when
  the line is in the engine's own script, minus a penalty for characters from an
  unrelated script.
- ML Kit and Tesseract confidences are not calibrated against each other, so this is a
  heuristic. Single-language modes are more accurate and faster.

How the mixed merge works (`OcrTextAssembler.mergeMixed`, unit-tested in
`android/app/src/test`):
- **Base:** the Devanagari model's lines are the starting point. Any line containing
  Devanagari, such as `आपका Order Successfully Shipped हो गया है।`, is kept verbatim.
- **Purely Latin lines:** a line that came out with no Devanagari is replaced by the
  Latin model's reading of the same box, but only on a near-exact box match (IoU ≥ 0.8).
  The Latin model is stronger on English.
- **Missed lines:** Latin lines the Devanagari pass missed entirely are added.

Status and navigation bars are cropped from every capture (the clock and battery icons
are not text, and a changing clock would look like new text while reading). Text is then
ordered top-to-bottom and left-to-right, with one line per row and blocks
kept together. Recognition is not perfect: small, blurred, stylised or animated text
reduces accuracy.

### Models

All models ship inside the APK:
- `com.google.mlkit:text-recognition:16.0.1` (bundled Latin)
- `com.google.mlkit:text-recognition-devanagari:16.0.1` (bundled Devanagari)
- `cz.adaptech.tesseract4android:tesseract4android:4.9.0` from JitPack, plus
  `assets/tessdata/guj.traineddata` (1.4 MB) and `eng.traineddata` (4.1 MB)

Tesseract is slower than ML Kit: expect roughly 1–3 s per screen for Gujarati modes on
a mid-range phone, versus under 1 s for ML Kit modes.

Nothing is downloaded on first use, so the app works offline from install. The cost is
APK size; use an AAB so Play delivers per-ABI splits. Recognisers are created on first
use and reused until the service stops.

---

## Floating-button actions

| Action | On tap |
|---|---|
| Copy text only | capture → OCR → clipboard + toast. No speech, no scrolling. |
| Start speaking | capture → OCR → speak. A controller appears (Pause/Resume, Restart, Copy, Stop). No scrolling. |
| Speak with auto-scroll | a reading session over the whole page (below) |

The bubble carries a small badge for the current action (copy / speaker / scroll icon)
and shows a speaker while reading. While a session runs, tapping the bubble pauses or
resumes it (or continues after a manual scroll); it never starts a second session.

### Reading session (`ReadingSession.kt`)

```
IDLE → CAPTURING → OCR_PROCESSING → SPEAKING ─┬─► COMPLETE            (Start speaking)
              ▲                               └─► SCROLLING ─► CAPTURING …   (auto-scroll)
              └──── WAITING_FOR_SCROLL ◄───── no scroll service: the user scrolls, taps ▶
any active state ─► PAUSED / STOPPED / ERROR
```

- **Sequential, never concurrent.** Capture, OCR, speech and scroll never overlap. The
  next scroll starts only after the TTS queue for the current section has completed, or
  the user pressed Next.
- **No repeated speech.** The new screen's lines are compared with the previous
  screen's (`TextDedup`: NFC, case, punctuation and whitespace normalised; fuzzy edit
  distance ≥ 0.85; numbers must match). Only new lines are spoken. Fixed toolbars and
  the overlap left after a scroll are dropped.
- **It cannot scroll forever.** The session ends after *N* screens in a row with nothing
  new (default 2, configurable) or after a section limit (default 30).
- **Pause/resume.** Android TTS cannot pause, so Pause stops speech and Resume restarts
  from the beginning of the current sentence group.
- **Stale callbacks are ignored.** A generation counter discards callbacks that arrive
  after a pause, skip or stop.
- **Covered by JVM tests.** `ReadingSessionTest` checks that it never scrolls while
  speaking, skips duplicates, stops at the end of the page and at the limit, keeps its
  place across pause/resume, ignores late callbacks, and handles the manual-scroll path.
- **Interruptions:**
  - audio focus is requested while speaking; a call or another app's audio pauses
    reading, which resumes afterwards if "Resume after interruptions" is on;
  - "Stop when leaving" ends overlay reading when the screen turns off, and in-app
    reading when the user leaves the text screen.

### Auto-scroll and its limits

An overlay **cannot** scroll another app. Android allows that only through an
**Accessibility Service**:
- **Opt-in only.** `ScrollAccessibilityService` is off until the user turns it on in
  *Settings → Accessibility → Installed apps → Akshar auto-scroll*. The app shows a
  disclosure, opens that settings page, and never enables it itself.
- **How it scrolls:** it asks the largest visible scrollable container to scroll
  forward, and falls back to a swipe gesture. It reads, stores and sends nothing.
- **Not universal.** Some apps expose no scrollable node, and some ignore synthetic
  gestures. Canvas-drawn or game UIs may not move at all; then no new text appears and
  the session ends.
- **Without the service** (or with "Scroll automatically" off), the controller shows
  "Scroll, then tap ▶". Reading continues with only the new text.
- **Play Store:** the service is declared `isAccessibilityTool="false"`. Publishing
  requires the Play accessibility declaration and a prominent disclosure (in-app text:
  `reading.disclosure`).

---

## Speech (text-to-speech)

- **Engine:** Android `TextToSpeech`. Google Speech Services (`com.google.android.tts`)
  is used when it is installed and "Prefer Google" is on. Otherwise the phone's default
  engine is used. Installed engines are discovered through a `TTS_SERVICE` `<queries>`
  entry, never assumed.
- **Capability checks:** Settings shows each language's real status from
  `isLanguageAvailable`:
  - *installed*
  - *voice data not installed*: offers the engine's installer (`ACTION_INSTALL_TTS_DATA`)
  - *not supported*

  It also lists that language's voices with locale, an offline or "needs internet"
  flag, and whether each is downloaded.
- **No silent substitution.** The chosen voice is used if installed; otherwise the
  engine's default voice *for the same language*. If the language itself is missing,
  speech fails with "voice not installed" and never falls back to another language.
- **Mixed scripts:** voices are per language, and switching mid-sentence sounds broken,
  so `SpeechSegmenter` picks the voice **per sentence**:
  - Gujarati script gets a Gujarati voice, Devanagari a Hindi voice, otherwise English;
  - this happens only when "Switch voice by script" is on and that voice is installed,
    otherwise the chosen speech language is used;
  - Hindi and Gujarati voices read embedded English words themselves.

  Settings warns when the OCR scripts include a language the configured voices cannot
  pronounce.
- **Test Voice samples:**
  - en: "Hello! Your screen text is ready to read."
  - hi: "नमस्ते! आपका स्क्रीन टेक्स्ट पढ़ने के लिए तैयार है।"
  - gu: "નમસ્તે! તમારી સ્ક્રીનનો ટેક્સ્ટ વાંચવા માટે તૈયાર છે."
- **Privacy:** offline voices run on the device. Voices the engine marks as needing a
  network are processed by the engine provider (shown in the voice list). The app
  itself sends nothing.

---

## Permissions

| Permission | Why |
|---|---|
| `SYSTEM_ALERT_WINDOW` ("Display over other apps") | Draws the floating button. Granted by the user in system settings. |
| Screen-capture consent (MediaProjection) | Android's own dialog; asked each time the button is turned on, because the token is single-use and cannot be stored. On Android 14+ the request is pinned to the entire screen. |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION` | Android requires a `mediaProjection` foreground service while a capture session is held. Its notification has a **Stop** action. |
| `POST_NOTIFICATIONS` | Shows that notification on Android 13+. Without it the service still works, but the notification is hidden. |
| Accessibility service (optional) | Only for "Speak with auto-scroll", only if the user enables it in Android settings: scrolls the page being read. |
| `TTS_SERVICE` package query | Not a permission; lets the app see which TTS engines are installed (to prefer Google). |
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
  ScreenOcrModule.kt             TurboModule (codegen spec: src/specs/NativeScreenOcr.ts)
  ScreenOcrPackage.kt            registered in MainApplication
  CaptureConsentActivity.kt      invisible; shows the system consent dialog
  OverlayCaptureService.kt       mediaProjection FGS: bubble, capture, actions, audio focus
  FloatingBubble.kt              draggable overlay, action badge, idle/processing/reading states
  ReadingPanel.kt                compact playback controller overlay
  ScreenCapturer.kt              MediaProjection → VirtualDisplay → ImageReader, one frame per tap
  OcrEngine.kt                   runs ML Kit Latin / Devanagari and Tesseract per mode
  GujaratiRecognizer.kt          Tesseract guj+eng wrapper
  OcrTextAssembler.kt            pure multi-script merges + reading order     (JVM tests)
  ReadingSession.kt              read-aloud state machine                     (JVM tests)
  TextDedup.kt                   new-text detection between screenshots       (JVM tests)
  SpeechSegmenter.kt             sentence segmentation + per-script voice     (JVM tests)
  SpeechPlayer.kt                Android TextToSpeech wrapper, capability report
  ScrollAccessibilityService.kt  optional, scroll-only accessibility service
  OcrConfig.kt                   settings mirror (JSON), position, pending queue
  ScreenOcrBus.kt                in-process hand-off + clipboard helper

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
cd android && ./gradlew :app:testDebugUnitTest        # Kotlin: merges, dedup, segmenter, reading session
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
