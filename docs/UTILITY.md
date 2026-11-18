# Utility — tools hub

Sidebar → **Utility**. Ten independent tools; opening the hub starts nothing
(no camera, sensor or sound). Each tool fails on its own without affecting
the others.

| Tool | How it works | Needs |
|---|---|---|
| **QR & Barcode Scanner** | Own CameraX activity (`BarcodeScanActivity`) + bundled ML Kit barcode model (offline). Scan frame, torch, pause/resume. A code is returned only after it reads the same on two consecutive frames, so a code left in view triggers one result. History in MMKV (value, format, date; delete one / clear all). | Camera permission (asked on Start) |
| **Document Scanner** | Google’s ML Kit document scanner (Play services): automatic edge detection, draggable corners, perspective correction, filters, multi-page, gallery import. Pages are copied to private storage (`files/scans`). In the app: reorder, rotate (re-encodes the image), retake, remove, add pages; export a multi-page PDF (A4, fitted, one bitmap in memory at a time) or JPEG/PNG images to a location the user picks (Storage Access Framework); share the PDF via FileProvider. | Google Play services; no permission |
| **Compass** | Rotation-vector sensor (fallback: accelerometer + magnetometer), corrected for screen rotation, smoothed on the unit circle, ~25 Hz. Sensors run only while the screen is focused and the app is in the foreground. Calibration prompt when magnetometer accuracy is low. Shows **magnetic** north. | Magnetometer |
| **AR Measure** | ARCore (`MeasureActivity`): GL camera background, centre reticle hit-tested against planes / depth / oriented feature points. **Length** = 3D distance between two anchors; **Height** = vertical (gravity-axis) difference; **Distance** = camera to aimed surface. Live tracking-state messages; Save is enabled only while ARCore tracks the camera and every point. Units: cm / m / in / ft. Never derives a size from pixels. | ARCore-supported phone, camera |
| **Screen Recorder** | Its own floating button (separate from OCR): screenshot with preview + annotation editor, screen / voice (system audio or mic) / screen + voice recording, automatic parts merged after Stop, recordings library, Settings → Recording. Native foreground service; see [SCREEN_RECORDER.md](./SCREEN_RECORDER.md). | Overlay permission, Android capture consent; microphone only for audio |
| **Stopwatch** | Start / pause / resume / reset and up to 99 laps (split + total, fastest and slowest marked). Stores *when* it started (MMKV `utility.clock`), not a running counter, so it keeps counting in the background and after the app is closed. | Nothing |
| **Countdown Timer** | h/m/s fields + presets, pause / resume, +1 min. Stored as an end time, so it keeps running when the app is closed. Start arms one Android alarm (`TimerAlarm`) that posts a high-priority "Time's up" notification with the alarm sound; pause / reset cancel it and clear the notification. Exact when the app may schedule exact alarms, otherwise inexact (the screen says so and links to the setting). In the app the end also vibrates. | Notifications (asked on Start); exact alarms optional |
| **Bubble Level** | Gravity sensor (fallback: low-pass accelerometer), ~20 Hz, only while the screen is open. Flat: round bubble + left–right / front–back degrees. On an edge: one angle off level or plumb. Within ±0.5° shows "Level". Calibrate (flat and edge separately) is saved in prefs. | Accelerometer |
| **Unit Converter** | Length, area (incl. square yards / gaj, acres, hectares), weight, volume (US cups, spoons, gallons), temperature, speed, data (1 KB = 1024 B). Type a value, pick a unit, see every other unit; tap a result to convert from it. Pure JS (`services/convert.ts`). | Nothing |
| **Speaker Water Eject** | Generated tone (no audio asset): 165 Hz steady, 100–400 Hz sweep, or 165 Hz pulses at 80 % of full scale with fades; 15–90 s (hard cap 120 s). Optional gentle vibration (0.5 s on / 1 s off). Holds transient audio focus and stops if another app takes it; stops on Stop, when time is up, when the screen loses focus or the app goes to the background. Safety notice: no guarantee, don’t charge a wet phone, comfortable volume only. | Speaker; vibrator optional |

## Code

- JS: `src/features/utility/` — `screens/`, `hooks/useUtility.ts` (screen-active,
  compass, water-eject lifecycles), `services/` (`native.service.ts`, `qr.ts`
  code parsing + link safety, `camera.ts` permission, `units.ts`), `store/utility.store.ts`.
- Native: `android/.../utility/` — `UtilityModule.kt` (TurboModule), `CompassSensor`, `TiltSensor`, `SightActivity` (+ `SightMath`), `TimerAlarm` (+ `TimerAlarmReceiver`),
  `TonePlayer` (+ `ToneShape`), `BarcodeScanActivity`, `DocumentPages` (+ `PageLayout`),
  `MeasureActivity`, `ArBackgroundRenderer`, `MeasureMath`. Shared helpers in
  `android/.../common/` (`DocumentSaver` for “Save to…”/folder export, `FileShare` for FileProvider).
- Spec: `src/specs/NativeUtility.ts` — imported only by `features/utility/services`.
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

No React Native packages were added. Camera permission is requested with the
existing `react-native-permissions`.

## Permissions

`SCHEDULE_EXACT_ALARM` (countdown timer, optional — falls back to inexact), `POST_NOTIFICATIONS` (timer alert, existing), `CAMERA` (scanner, AR, angle sighting — requested on Start; `uses-feature` camera / camera.ar
`required=false`), `VIBRATE` (water eject). The document scanner and file export
need no permission (Play services UI + Storage Access Framework).

## Known limitations

- AR Measure needs an ARCore-certified phone and Google Play Services for AR (installed on first use). Accuracy is typically a few centimetres in good light on textured surfaces; worse on plain, dark or shiny surfaces. No measurement screenshot.
- Document scanner needs Google Play services; on phones without it the tool explains that and is disabled. Filters are applied in Google’s scanner UI (before pages come back), not re-editable afterwards.
- Compass shows magnetic, not true, north (true north would need location).
- Angle measuring is only as good as the known length and how steadily you aim. It
  assumes the camera stays at the same spot (and, for phone-height methods, the same
  height) for every point. There is no per-phone tilt-sensor calibration.
- The countdown alarm doesn't survive a reboot. Without exact-alarm permission, Doze can
  delay it by a few minutes. The stopwatch and timer use the wall clock, so changing the
  phone's time shifts them.
- The water-eject tone can’t guarantee water removal or repair water damage.
