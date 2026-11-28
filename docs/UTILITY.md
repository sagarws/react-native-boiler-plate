# Utility — tools hub

Sidebar → **Utility**. Eleven independent tools (including Multiple Stopwatch and Multiple Timer); opening the hub starts nothing
(no camera, sensor or sound). Each tool fails on its own without affecting
the others.

| Tool | How it works | Needs |
|---|---|---|
| **QR & Barcode Scanner** | Own CameraX activity (`BarcodeScanActivity`) + bundled ML Kit barcode model (offline). Scan frame, torch, pause/resume. A code is returned only after it reads the same on two consecutive frames, so a code left in view triggers one result. History in MMKV (value, format, date; delete one / clear all). | Camera permission (asked on Start) |
| **Scanner Gun (PC)** | The phone becomes a **Bluetooth keyboard** (Android `BluetoothHidDevice`, HID device profile, boot-keyboard descriptor) for a paired computer, and the same camera activity in *gun mode* stays open and types every code where the cursor is, then Enter / Tab / nothing, with a generated beep (`ScanBeep`: 2.7 kHz “bip” when typed, low double tone when not) and a short vibration. The same code is never typed twice in a row (A, A, A, B types A then B); only a code that failed to type (no computer) can be retried after it left the view. At most one code per 600 ms. Line breaks inside a code become spaces. Keys follow the **US layout**; characters a keyboard can't type are skipped and counted. The keyboard is registered only while the screen is open and reconnects to the last computer. Pairing: *Pair a new computer* makes the phone visible for 2 min; the computer adds it from its Bluetooth settings. Nothing is installed on the computer; no USB (Android can't be a USB keyboard without root). Codes go into the scanner history. | Bluetooth + “Nearby devices” (Android 12+), camera; Android 9+ with HID device support |
| **Document Scanner** | Google’s ML Kit document scanner (Play services): automatic edge detection, draggable corners, perspective correction, filters, multi-page, gallery import. Pages are copied to private storage (`files/scans`). In the app: reorder, rotate (re-encodes the image), retake, remove, add pages; export a multi-page PDF (A4, fitted, one bitmap in memory at a time) or JPEG/PNG images to a location the user picks (Storage Access Framework); share the PDF via FileProvider. | Google Play services; no permission |
| **Compass** | Rotation-vector sensor (fallback: accelerometer + magnetometer), corrected for screen rotation, smoothed on the unit circle, ~25 Hz. Sensors run only while the screen is focused and the app is in the foreground. Calibration prompt when magnetometer accuracy is low. Shows **magnetic** north. | Magnetometer |
| **AR Measure** | ARCore (`MeasureActivity`): GL camera background, centre reticle hit-tested against planes / depth / oriented feature points. **Length** = 3D distance between two anchors; **Height** = vertical (gravity-axis) difference; **Distance** = camera to aimed surface. Live tracking-state messages; Save is enabled only while ARCore tracks the camera and every point. Units: cm / m / in / ft. Never derives a size from pixels. | ARCore-supported phone, camera |
| **Screen Recorder** | Its own floating button (separate from OCR): screenshot with preview + annotation editor, screen / voice (system audio or mic) / screen + voice recording, automatic parts merged after Stop, recordings library, Settings → Recording. Native foreground service; see [SCREEN_RECORDER.md](./SCREEN_RECORDER.md). | Overlay permission, Android capture consent; microphone only for audio |
| **Multiple Stopwatch** | Up to 20 named stopwatches, each running on its own: start / pause / resume / reset, up to 99 laps each (split + total, fastest and slowest marked), rename, delete. Each one stores *when* it started (MMKV `utility.clock`), not a running counter, so all keep counting in the background and after the app is closed. The display ticks only while the screen is open. | Nothing |
| **Multiple Timer** | Up to 20 named timers running at once. You set hours / minutes / seconds or a preset (1, 5, 10, 15, 30, 45, 60 min, plus your own saved presets), and there's a quick-start row. Each timer can start, pause, resume, reset (Dismiss when finished), +1 min, edit or delete. **Each timer has its own alert** (mode, ringtone with preview, volume, vibration) through the shared alarm engine (see [REMINDERS.md](./REMINDERS.md)): one native alarm per running timer, so it rings with the app closed, and finishing one never touches the others. Stored as end times, so they stay accurate in the background and survive restarts. Data from the earlier single stopwatch / timer is carried over. | Notifications; exact alarms optional |
| **Bubble Level** | Gravity sensor (fallback: low-pass accelerometer), ~20 Hz, only while the screen is open. Flat: round bubble + left–right / front–back degrees. On an edge: one angle off level or plumb. Within ±0.5° shows "Level". Calibrate (flat and edge separately) is saved in prefs. | Accelerometer |
| **Unit Converter** | Length, area (incl. square yards / gaj, acres, hectares), weight, volume (US cups, spoons, gallons), temperature, speed, data (1 KB = 1024 B). Type a value, pick a unit, see every other unit; tap a result to convert from it. Pure JS (`services/convert.ts`). | Nothing |
| **Speaker Water Eject** | Generated tone (no audio asset): 165 Hz steady, 100–400 Hz sweep, or 165 Hz pulses at 80 % of full scale with fades; 15–90 s (hard cap 120 s). Optional gentle vibration (0.5 s on / 1 s off). Holds transient audio focus and stops if another app takes it; stops on Stop, when time is up, when the screen loses focus or the app goes to the background. Safety notice: no guarantee, don’t charge a wet phone, comfortable volume only. | Speaker; vibrator optional |
| **YouTube Downloader** | Paste a YouTube link → title, channel, length and thumbnail → **Video** (every quality YouTube offers, up to 4K, with estimated size) or **Audio only**. Downloads in a foreground service (progress notification with Cancel; continues in the background), then saves to Movies/Akshar or Music/Akshar. Downloads list: open, share, remove from list or delete the file. See *YouTube Downloader* below. | Internet; notifications (optional, for progress) |

## Code

- JS: `src/features/utility/` — `screens/`, `hooks/useUtility.ts` (screen-active,
  compass, water-eject lifecycles), `services/` (`native.service.ts`, `qr.ts`
  code parsing + link safety, `camera.ts` permission, `units.ts`), `store/utility.store.ts`.
- Native: `android/.../utility/` — `UtilityModule.kt` (TurboModule), `CompassSensor`, `TiltSensor`, `SightActivity` (+ `SightMath`),
  `TonePlayer` (+ `ToneShape`), `BarcodeScanActivity` (normal + gun mode), `ScanKeyboard` (Bluetooth keyboard) + `ScanKeyboardModule` + `ScanBeep`, `DocumentPages` (+ `PageLayout`),
  `MeasureActivity`, `ArBackgroundRenderer`, `MeasureMath`. Shared helpers in
  `android/.../common/` (`DocumentSaver` for “Save to…”/folder export, `FileShare` for FileProvider).
- Spec: `src/specs/NativeUtility.ts` and `src/specs/NativeScanKeyboard.ts` (scanner gun) — imported only by `features/utility/services`.
- Screen Recorder: `android/.../recorder/`, spec `src/specs/NativeRecorder.ts` — details in [SCREEN_RECORDER.md](./SCREEN_RECORDER.md).

## Angle (trigonometric) measuring (`services/trig.ts`, `SightActivity`)

AR Measure → **Angle (trigonometry)**. Works without ARCore. The user enters one known
length, then aims a crosshair on the live camera at each point. `SightActivity` reads the
camera's elevation (and turn) from the game rotation vector, falling back to the rotation
vector and then to gravity / accelerometer (elevation only). Each capture averages
~0.3 s of readings, and the screen shows "Hold steady" while the aim moves more than 1°.
Angles are degrees, positive above the horizon.

| Method | Known | Aim at | Formula |
|---|---|---|---|
| Height (distance known) | horizontal distance D | base, top | H = D·(tan top − tan base) |
| Height (phone height known) | camera height h | base on the floor, top | D = h / tan(−base), then as above |
| Distance (phone height known) | h | point on the floor | D = h / tan(−angle) |
| Floor length (phone height known) | h | both ends | d = h / tan(−angle) each; L = √(d1² + d2² − 2·d1·d2·cos Δ), Δ = turn between the points |

Each result shows a ± from re-solving with every angle nudged by ±0.5°. A warning appears
when a floor point is less than 8° below the horizon. With no rotation sensor the turn Δ
is taken as 0, so the two ends must be in line with you; the result says so. The known
lengths are remembered in prefs. Saved results go to the measurement list with source
`angle`.

## QR link safety (`services/qr.ts`)

Only well-formed `http(s)` URLs get an **Open link** action, and only after a
confirmation dialog showing the full address. Insecure `http`, raw IPs,
punycode (look-alike) hosts and `user@host` links carry a warning. Other
schemes (`javascript:`, `intent:`, `file:`, `data:`, app links) are shown as text.
Nothing is opened, run or installed automatically. Wi-Fi codes show the network
and offer “Copy password” (the app doesn’t join networks).

## Dependencies added (`android/app/build.gradle`)

| Library | Version | Why / compatibility |
|---|---|---|
| `androidx.camera:camera-camera2/-lifecycle/-view` | 1.6.2 | Scanner preview + analysis; minSdk 23+, works with compileSdk 36 |
| `com.google.mlkit:barcode-scanning` | 17.3.0 | Bundled (offline) barcode model |
| `com.google.android.gms:play-services-mlkit-document-scanner` | 16.0.0 | Document scanner UI, edge detection, perspective correction |
| `com.google.ar:core` | 1.57.0 | AR Measure; manifest marks ARCore **optional** |
| `com.github.teamnewpipe:NewPipeExtractor` (JitPack) | v0.26.5 | YouTube Downloader: video details, stream URLs, solves YouTube’s signature/throttling challenges (Rhino). Needs the ProGuard keep rules in `proguard-rules.pro` |
| `com.android.tools:desugar_jdk_libs_nio` (coreLibraryDesugaring) | 2.1.5 | Backports java.nio/java.time APIs NewPipeExtractor uses (minSdk 24 < 33) |

No React Native packages were added. Camera permission is requested with the
existing `react-native-permissions`.

## YouTube Downloader (`ytdownload/`)

Uses the internet, but only for a link the user pastes; nothing is uploaded. You may download only videos you own or have permission to save (YouTube’s terms of service), and the screen says so.

| Step | Code |
|---|---|
| Link check (watch, youtu.be, shorts, live, embed, music) → canonical URL | `services/youtube.ts` `youTubeVideoId` |
| Details + stream list | `YtExtractor.kt` (NewPipeExtractor over `HttpURLConnection`) |
| Which qualities are offered | `YtFormats.kt` (JVM-tested in `YtFormatsTest.kt`) |
| Download (10 MB Range chunks, resume, 4 retries) | `ChunkedFetcher.kt` in `YtDownloadService.kt` (foreground, `dataSync`) |
| Join video + audio, no re-encoding | `StreamMuxer.kt` (MediaExtractor → MediaMuxer) |
| Save | `DownloadOutput.kt`: MediaStore Movies/Akshar, Music/Akshar (Android 10+); app folder before 10 |
| Downloads list | `DownloadStore.kt` (SharedPreferences, newest 100) |

**Quality rules.** YouTube serves HD as separate video and audio streams, so every pick has to be something MediaMuxer can write (no ffmpeg in the app):

- H.264 MP4 + AAC → `.mp4`. Preferred because it plays everywhere; YouTube offers it up to 1080p.
- VP9 WebM + Opus → `.webm`. Used for 1440p/4K (works on every Android version).
- AV1 MP4 + AAC → `.mp4`. Only on Android 14+, and only when no H.264 or VP9 exists at that height.
- Audio only: best AAC → `.m4a`, best Opus → `.opus` (`.webm` before Android 10). There is no MP3, because that would need an encoder.

The default selection is 1080p when offered. Only the original audio track is used (dubbed tracks are skipped).

**Errors** come from native as stable codes (`invalid_url`, `network`, `private`, `age_restricted`, `geo_blocked`, `live_unsupported`, `rate_limited`, `link_expired`, `storage_full`, `busy`, …) and map to `utility.yt.error_*` strings.

**Limitations.** One download at a time. Live streams, age-restricted, private and members-only videos can’t be downloaded. YouTube changes its player often; when downloads start failing, update NewPipeExtractor (`build.gradle`). Stream links expire after a few hours, so if a download fails with `link_expired`, get the video again. Android 15 caps `dataSync` services at about 6 h a day.

## Permissions

Timer alerts use the shared alarm engine's permissions (see [REMINDERS.md](./REMINDERS.md#permissions)). `CAMERA` (scanner, AR, angle sighting — requested on Start; `uses-feature` camera / camera.ar
`required=false`), `VIBRATE` (water eject, scanner gun), `BLUETOOTH_CONNECT` + `BLUETOOTH_ADVERTISE` (scanner gun, Android 12+, asked on the screen; `BLUETOOTH`/`BLUETOOTH_ADMIN` up to Android 11), `INTERNET` + `FOREGROUND_SERVICE_DATA_SYNC` (YouTube Downloader; both were already declared). The document scanner and file export
need no permission (Play services UI + Storage Access Framework).

## Known limitations

- AR Measure needs an ARCore-certified phone and Google Play Services for AR (installed on first use). Accuracy is typically a few centimetres in good light on textured surfaces; worse on plain, dark or shiny surfaces. No measurement screenshot.
- Document scanner needs Google Play services; on phones without it the tool explains that and is disabled. Filters are applied in Google’s scanner UI (before pages come back), not re-editable afterwards.
- Compass shows magnetic, not true, north (true north would need location).
- Angle measuring is only as good as the known length and how steadily you aim. It
  assumes the camera stays at the same spot (and, for phone-height methods, the same
  height) for every point. There is no per-phone tilt-sensor calibration.
- Timer alarms are restored after a reboot (shared alarm engine). Without exact-alarm
  permission, Doze can delay them a few minutes. Stopwatches and timers use the wall
  clock, so changing the phone's time shifts them.
- The water-eject tone can’t guarantee water removal or repair water damage.
- Scanner gun: US keyboard layout only (a computer set to another layout may type some symbols differently); non-keyboard characters (Hindi, emoji) are skipped. Some phones ship without Bluetooth HID device support and show “Not supported”. Typing speed is about 100 characters per second.
