# Floating screen OCR

Akshar lets the user tap a floating button over any app and get that screen's text, in
English, Hindi, Gujarati or a mix, then either copy it, read it aloud, or read a long
page aloud while scrolling. OCR runs on the device; speech uses the phone's own
text-to-speech engine. There is no account and no backend. The only network use is
the optional **Speak with translation** action, which sends extracted text to the
Google Gemini API with the user's own key after explicit opt-in.

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
| Speak with pagination | read a page, press the pinned Next button once, verify the page turned, continue (below) |
| Speak with translation | OCR on the device → translate with Gemini (user's key, opt-in) → speak the translation (below) |

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

### Speak with pagination (`PaginationSession.kt`)

For PDFs, e-books and viewers that change pages with a Next button instead of
scrolling.

```
IDLE → CAPTURING_SCREEN → RUNNING_OCR → SPEAKING_PAGE ─(speech done)─► CLICKING_NEXT_PAGE
         ▲                                                               │ exactly one click
         │                                       WAITING_FOR_PAGE_CHANGE ◄┘
         │                                               │ page-load delay
         └── new page (that capture is spoken) ◄─ VERIFYING_PAGE_CHANGE ─(timeout)─► NEEDS_ATTENTION
any active state ─► PAUSED / STOPPED / COMPLETED / ERROR
```

- **Read, then click.** Next is pressed only after the TTS queue for the page reports
  completion (or the user chose "Next page now").
- **One click per page.** After the click, the screen is re-captured every 1.5 s until
  the timeout (default 6 s), but Next is never pressed again automatically.
- **Recovery is explicit.** If no new page appears, the session stops in
  `NEEDS_ATTENTION` ("The next page could not be detected"). The controller offers
  **Retry once** (one per prompt), **Reposition** and **Stop**. An empty page offers
  **Skip page**.
- **Page-change test** (`PageChangeDetector`):
  - the share of lines with a fuzzy match on the previous capture must fall below 75%;
  - a clock, cursor or page counter changes one line, which stays above that;
  - pages with little text use a 64-bit dHash of the frame instead.
- **Ending.** A page matching one of the last five read means the viewer wrapped round
  or stopped at the end, so the session completes. There is also a page limit
  (default 50).
- **Headers and footers.** Running headers, footers and bare page numbers ("12",
  "Page 3 of 10", "पृष्ठ ५", "પાનું ૩") are trimmed, but only at the edges of the page.
  Repeated sentences in the body are kept.
- **Pause and stop.**
  - Pause stops speech and resumes from the current sentence group. During a page
    turn it holds before reading the new page.
  - Stop cancels speech, timers and verification.
  - A generation counter makes sure no late callback can press Next.
- **Interruptions:** audio focus and screen-off behave as in the other read-aloud
  modes.

#### Pinning the Next button (`TargetPicker.kt`)

1. Settings → Speak with pagination → **Locate Next Page Button** (the floating button
   must be on). Tapping the bubble without a usable pin also opens the picker.
2. A draggable crosshair and a control bar appear over whatever app is open. The user
   switches to the document app and drags the crosshair onto the Next button. The
   crosshair window consumes the drag, so the app underneath is never tapped.
3. **Fixed position / Moves with page** chooses the anchor. **Save** stores it,
   **Cancel** discards it. Nothing is saved without Save, and both windows are removed
   before any later click.
4. It can be repositioned from Settings or from the controller's Reposition button,
   and cleared from Settings.

#### How the target is stored (`PaginationTarget.kt`)

The target is stored in native SharedPreferences as JSON. The fields:

| Field | Meaning |
|---|---|
| `x`, `y` | crosshair centre from `View.getLocationOnScreen` |
| `coordinateSpace` | `physical_screen_px`: full default display, current rotation. This is the space `dispatchGesture` and `getBoundsInScreen` use, so no conversion is needed. |
| `geometry` | width, height, densityDpi, rotation, and system-bar/cutout insets at calibration |
| `anchor` | `screen` (fixed) or `content` (moves with the page) |
| `node` | accessibility identity of the control under the pin (view id, content description, text, class, size), when readable |
| `packageName` | foreground app at calibration |
| `calibratedAt` | timestamp |

**Validation** (`TargetValidator`) runs on app start (Settings shows the status) and
again **before every click**:
- a change in rotation, size or density, or for fixed targets a system-bar height
  change of more than 4 px, makes the target invalid;
- an invalid target is never clicked; the user is asked to reposition;
- no coordinate transform is guessed.

**Resolution at click time** (`ScrollAccessibilityService.clickTarget`):
- **Fixed:**
  - find the clickable node at the pinned point; if it matches the recorded identity,
    use its own `ACTION_CLICK`;
  - otherwise tap at the pinned point with a 60 ms accessibility gesture;
  - document scrolling does not move it, by design.
- **Moves with page:**
  - search the active window for the node whose identity matches best
    (`NodeMatcher`: view id dominant, then description, then text);
  - click it, or tap its current centre;
  - if no node matches, the session stops with "The Next button isn't on screen".
    It never taps the old point.
- **Not identifiable:** a moving target with no readable identity is refused when
  saving and stored as fixed instead, with a toast. A pinned point cannot follow
  arbitrary layout changes, and the app does not pretend it can.
- **App check:** if a different app is in the foreground than the one pinned, the
  session stops instead of clicking.
- **Our own overlays:** the bubble and controller are hidden for the click, as for
  screenshots, so they are never under the tap.

#### Permission

Pressing a button in another app is only possible through an **accessibility
service**:
- it reuses the app's existing one, shown in Android settings as "Akshar page turner";
- it is off until the user enables it; Settings shows its status and opens the
  Accessibility page;
- without it, the session doesn't start (toast), and a click attempt reports
  "Turn on Akshar in Accessibility settings to press Next";
- capabilities are unchanged: window content (to find the button or scroll container)
  and gestures (to tap or swipe); no events are acted on.

### Refine text and Apply translation (`TextPipeline.kt`, `GeminiClient.kt`)

Two opt-in Gemini steps that work with every tap action, not as separate
actions:

```
scan → OCR (on device) → refine (if on) → translate the refined text (if on) → copy / speak
```

- **Refine text** (Settings → Refine text): repairs OCR damage such as
  broken or cut-off words, misread letters and stray symbols, which is
  common on old books. It is driven by an editable prompt. It must not add,
  summarise or translate.
- **Apply translation** (Settings → Translation): translates into the target
  language using an editable prompt (`{target}`/`{source}` are substituted).
- **Shared settings:** both steps use one API key, model (default
  `gemini-flash-latest`, Google's always-current Flash alias) and thinking
  level (default `low`, retried once without it if a model rejects it). All
  three are set in the Translation card.
- **What each action uses:** Copy copies the final text. Speak, Auto-scroll
  and Pagination speak it; a translation is spoken in the target language's
  voice. Auto-scroll's "same screen" check and Pagination's page check still
  compare the original OCR text.
- **Gate.** If either switch is on but no key is saved, the tap only shows a
  toast. Nothing is captured or sent.
- **Failure.** A failed step fails the run with a specific message (quota,
  invalid key, model not found, …). Unprocessed text is never used silently.
  In Copy mode the original is still saved to history.
- **Caching.** Pause, resume and restart reuse the processed text. Stop
  cancels the in-flight request.
- **History.** Entries store `text` (original), `refined` and `translation`.
  The result screen shows the refined text.
- **Test connection** lists the models the key can call and shows Google's
  own error message with its HTTP status.
- **Project number** is kept for reference only and is not sent. Usage and
  billing go to the project that owns the API key, and the API keeps no chat
  history.

**Privacy and security.** Only the recognised text is sent, never the
screenshot. The key is encrypted with AES-GCM using an Android Keystore key
(`SecureKeyStore`) and sent only in the `x-goog-api-key` header. JS can only
see whether a key exists and its last four characters. Nothing about
requests, responses or the key is logged, and error details are redacted.

### Share voice to Chrome (`share/AudioShareHub.kt`, `share/SpeechMirror.kt`)

Streams Akshar's spoken voice to the **Akshar Listen** Chrome extension
(`public/crome-extension`; its README has setup, pairing, the protocol and
the security model). It is opt-in, works on the same Wi-Fi only, and needs
no new permissions.

- **Capture:** every speech request goes through `SpeechPlayer.speak()`,
  which notifies the hub. `SpeechMirror` renders the same segments with a
  second TTS client (`synthesizeToFile` → `PcmClip`), at most 3 segments
  ahead. Each segment's PCM is sent when the phone starts speaking it, paced
  in real time with a 300 ms lead. The phone's own playback is untouched. Audio
  is only rendered and sent while a paired receiver is listening.
- **All phone audio** (`share/DeviceAudioCapture.kt`, optional): the card
  lets the user choose between Akshar's voice and all phone audio.
  - Uses Android 10+ `AudioPlaybackCapture` over the floating button's
    existing `MediaProjection` (`AudioShareHub.attachProjection`).
  - Captures media, game and unknown usages at 48 kHz stereo, sent in 100 ms
    chunks. Silent chunks are skipped. Akshar's own speech, whose
    accessibility usage isn't captured, is resampled and mixed in.
  - Needs `RECORD_AUDIO`, which is asked only when this option is chosen.
    The service then also runs with the `microphone` foreground type
    (required on Android 14+).
  - Not captured: calls, and apps that opt out of capture.
  - The card reports why it isn't running: `needs_permission`,
    `needs_bubble`, `unsupported` or `failed`.
- **Server:** a WebSocket server on port 47811 (falls back to a random port),
  using a minimal RFC 6455 implementation in `WebSocketConnection` with no new
  dependency. It refuses `http(s)` Origins and accepts one receiver at a time.
- **Pairing** (`ShareProtocol`): by the phone's address only, with no code.
  - P-256 ECDH, HKDF-SHA256 and HMAC key confirmation
  - the user's **Allow** for every new computer, given in the notification or
    in the card, after matching a 6-digit fingerprint
  - after a Deny or a timeout, new requests are refused for 5 s
  - then AES-256-GCM frames with replay counters
- **Resume key:** issued after pairing, so a receiver can reconnect after a
  network drop without asking again. It is revoked on disconnect or when sharing
  stops.
- **States** (shown in the card): `off`, `waiting`, `pending` (approve),
  `connected` (receiver paused) and `streaming`. Errors are `no_wifi` and
  `port_failed`, with a Retry button.
- **Lifetime:** the hub is process-wide. It starts and stops with
  `config.audioShare.enabled` (via `updateConfig`) and keeps running in the
  background while the floating-button service holds the process.
- **Logging:** codes, keys and audio are never logged.

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
| Screen-capture consent (MediaProjection) | Android's own dialog; asked each time the button is turned on, because the token is single-use and cannot be stored. On Android 14+ the user can share the **entire screen** (any app is readable) or **one app** (only that app; while it is hidden Android sends blank frames, so Akshar says so instead of reporting “no text”, and skips the system-bar crop because a single-app frame has no system bars). |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION` | Android requires a `mediaProjection` foreground service while a capture session is held. Its notification has a **Stop** action. |
| `POST_NOTIFICATIONS` | Shows that notification on Android 13+. Without it the service still works, but the notification is hidden. |
| Accessibility service (optional) | Only for "Speak with auto-scroll", only if the user enables it in Android settings: scrolls the page being read. |
| `TTS_SERVICE` package query | Not a permission; lets the app see which TTS engines are installed (to prefer Google). |
| `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE` | Only for **Share voice to Chrome → All phone audio**: Android gates playback capture behind the microphone permission. It is asked only when that option is chosen, and nothing is recorded from the microphone. |
| `INTERNET` | Only for opt-in features: **Refine text / Apply translation** (Google Gemini API) and **Share voice to Chrome** (a local-network server, port 47811). Also used by Metro in debug builds. ML Kit's usage-logging uploader is removed from release builds, so no other component sends data. |

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
  PaginationSession.kt           speak-with-pagination state machine           (JVM tests)
  PaginationTarget.kt            pinned-target model, validation, node matching (JVM tests)
  PageChange.kt                  page-turn detection, header/footer trimming   (JVM tests)
  TargetPicker.kt                crosshair overlay for pinning the Next button
  ScreenGeometryReader.kt        current display geometry in gesture coordinates
  TextDedup.kt                   new-text detection between screenshots       (JVM tests)
  SpeechSegmenter.kt             sentence segmentation + per-script voice     (JVM tests)
  SpeechPlayer.kt                Android TextToSpeech wrapper, capability report
  ScrollAccessibilityService.kt  optional accessibility service: scroll + press pinned button
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
