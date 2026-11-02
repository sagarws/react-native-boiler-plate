# Utility — tools hub

Sidebar → **Utility**. Six independent tools; opening the hub starts nothing
(no camera, sensor or sound). Each tool fails on its own without affecting
the others.

| Tool | How it works | Needs |
|---|---|---|
| **QR & Barcode Scanner** | Own CameraX activity (`BarcodeScanActivity`) + bundled ML Kit barcode model (offline). Scan frame, torch, pause/resume. A code is returned only after it reads the same on two consecutive frames, so a code left in view triggers one result. History in MMKV (value, format, date; delete one / clear all). | Camera permission (asked on Start) |
| **Document Scanner** | Google’s ML Kit document scanner (Play services): automatic edge detection, draggable corners, perspective correction, filters, multi-page, gallery import. Pages are copied to private storage (`files/scans`). In the app: reorder, rotate (re-encodes the image), retake, remove, add pages; export a multi-page PDF (A4, fitted, one bitmap in memory at a time) or JPEG/PNG images to a location the user picks (Storage Access Framework); share the PDF via FileProvider. | Google Play services; no permission |
| **Compass** | Rotation-vector sensor (fallback: accelerometer + magnetometer), corrected for screen rotation, smoothed on the unit circle, ~25 Hz. Sensors run only while the screen is focused and the app is in the foreground. Calibration prompt when magnetometer accuracy is low. Shows **magnetic** north. | Magnetometer |
| **AR Measure** | ARCore (`MeasureActivity`): GL camera background, centre reticle hit-tested against planes / depth / oriented feature points. **Length** = 3D distance between two anchors; **Height** = vertical (gravity-axis) difference; **Distance** = camera to aimed surface. Live tracking-state messages; Save is enabled only while ARCore tracks the camera and every point. Units: cm / m / in / ft. Never derives a size from pixels. | ARCore-supported phone, camera |
| **Screen Recorder** | Its own floating button (separate from OCR): screenshot with preview + annotation editor, screen / voice (system audio or mic) / screen + voice recording, automatic parts merged after Stop, recordings library, Settings → Recording. Native foreground service; see [SCREEN_RECORDER.md](./SCREEN_RECORDER.md). | Overlay permission, Android capture consent; microphone only for audio |
| **Speaker Water Eject** | Generated tone (no audio asset): 165 Hz steady, 100–400 Hz sweep, or 165 Hz pulses at 80 % of full scale with fades; 15–90 s (hard cap 120 s). Optional gentle vibration (0.5 s on / 1 s off). Holds transient audio focus and stops if another app takes it; stops on Stop, when time is up, when the screen loses focus or the app goes to the background. Safety notice: no guarantee, don’t charge a wet phone, comfortable volume only. | Speaker; vibrator optional |
| **YouTube Downloader** | Paste a YouTube link → title, channel, length and thumbnail → **Video** (every quality YouTube offers, up to 4K, with estimated size) or **Audio only**. Downloads in a foreground service (progress notification with Cancel; continues in the background), then saves to Movies/Akshar or Music/Akshar. Downloads list: open, share, remove from list or delete the file. See *YouTube Downloader* below. | Internet; notifications (optional, for progress) |

## Code

- JS: `src/features/utility/` — `screens/`, `hooks/useUtility.ts` (screen-active,
  compass, water-eject lifecycles), `services/` (`native.service.ts`, `qr.ts`
  code parsing + link safety, `camera.ts` permission, `units.ts`), `store/utility.store.ts`.
- Native: `android/.../utility/` — `UtilityModule.kt` (TurboModule), `CompassSensor`,
  `TonePlayer` (+ `ToneShape`), `BarcodeScanActivity`, `DocumentPages` (+ `PageLayout`),
  `MeasureActivity`, `ArBackgroundRenderer`, `MeasureMath`. Shared helpers in
  `android/.../common/` (`DocumentSaver` for “Save to…”/folder export, `FileShare` for FileProvider).
- Spec: `src/specs/NativeUtility.ts` — imported only by `features/utility/services`.
- Screen Recorder: `android/.../recorder/`, spec `src/specs/NativeRecorder.ts` — details in [SCREEN_RECORDER.md](./SCREEN_RECORDER.md).

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

`CAMERA` (scanner, AR — requested on Start; `uses-feature` camera / camera.ar
`required=false`), `VIBRATE` (water eject), `INTERNET` + `FOREGROUND_SERVICE_DATA_SYNC` (YouTube Downloader; both were already declared). The document scanner and file export
need no permission (Play services UI + Storage Access Framework).

## Known limitations

- AR Measure needs an ARCore-certified phone and Google Play Services for AR (installed on first use). Accuracy is typically a few centimetres in good light on textured surfaces; worse on plain, dark or shiny surfaces. No measurement screenshot.
- Document scanner needs Google Play services; on phones without it the tool explains that and is disabled. Filters are applied in Google’s scanner UI (before pages come back), not re-editable afterwards.
- Compass shows magnetic, not true, north (true north would need location).
- The water-eject tone can’t guarantee water removal or repair water damage.
