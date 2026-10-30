# Screen Recorder (Utility)

Utility → **Screen Recorder**. A floating button, separate from the OCR
button, for screenshots, screen recording, voice (system audio / microphone)
recording and screen + voice recording. Long recordings are written in parts
and merged after Stop. Everything stays on the device.

## Pieces

| Layer | Where | What |
|---|---|---|
| Screens | `src/features/utility/screens/` | `RecorderScreen` (button on/off, tap mode, live status, start/stop), `RecordingsScreen` (library + tabs), `RecordingDetailScreen` (actions, session parts) |
| Settings | `components/RecordingSettings.tsx`, `RecordingStorageSection.tsx` | Settings → **Recording** tab (also linked from the recorder screen) |
| Hooks | `hooks/useRecorder.ts` | status (events + local elapsed tick), config, library |
| Service | `services/recorder.service.ts`, `services/recordings.ts` | bridge + JSON validation; pure library/format logic |
| Spec | `src/specs/NativeRecorder.ts` | imported only by `features/utility/services` |
| Native | `android/.../recorder/` | everything that captures, encodes, segments, merges |

Native files:

- `RecorderService` — foreground service: bubble, menu, controls, preview, session lifecycle, merge, notification.
- `RecorderBubble`, `RecorderMenu`, `RecorderPanels` (controls pill, screenshot preview) — overlay windows.
- `RecorderConsentActivity` — invisible trampoline: microphone permission, then Android's capture consent.
- `CaptureSource` — one MediaProjection + one VirtualDisplay, surface switched between ImageReader / encoder / nothing.
- `SegmentedRecorder` — continuous H.264 + AAC encoders, rotating MP4 muxers.
- `PcmSource` — AudioPlaybackCapture and/or microphone, monotonic timestamps.
- `SegmentMerger` (+ `MediaCheck`) — remux parts into one file; verify output; thumbnails.
- `RecordingStore` — library JSON (`files/recordings/library.json`, atomic writes); crash recovery.
- `OutputStorage` — MediaStore / SAF tree / app folder outputs, rename, delete, free space, write test.
- `RecorderConfig` (+ `RecorderPrefs`), `RecordingState` (state machine + `RecordingNames`), `EncoderSetup`.
- `ScreenshotEditorActivity` + `AnnotationView` — annotation editor.
- `RecorderModule` — TurboModule; `RecorderEvents` — native → JS events.

## Independence from the OCR button

Own service, window, consent activity, notification channel and
SharedPreferences (`recorder_prefs`). No OCR file was changed. One platform
limit remains: **Android allows one active screen capture at a time**. Starting
recorder capture ends the OCR button's capture session (and vice versa); the
other side gets `onStop`, releases cleanly and asks for consent again next
time. A recording in progress is finalized normally if that happens.

## Button and menu

- Tap runs the selected mode; long-press (haptic) opens the four-option menu;
  drag moves it and snaps to the nearest side. A drag or long-press never fires a tap.
- Position (side + height ratio) and selected mode are persisted natively, so
  they survive restarts.
- While recording the button turns red with a stop glyph; tap = Stop.
  Long-press is disabled until the session ends (mode can't change mid-session).
- Turning the button off during a recording asks first and keeps recording
  (controls + notification Stop remain).

## Capture lifecycle and consent

1. A tap needing capture (screenshot, screen, system audio) without a held
   projection opens `RecorderConsentActivity`: RECORD_AUDIO first if audio is
   needed, then Android's dialog. Every audio mode passes through it so the
   service adds the `microphone` foreground type while the app is visible
   (Android 14 while-in-use rule).
2. The service enters the foreground (`mediaProjection` [+ `microphone`])
   **before** obtaining the projection (Android 14+ requirement).
3. With "Keep screen capture allowed" (default) the projection is reused for
   later screenshots/recordings — no consent per capture or per segment.
   The system capture indicator and an ongoing notification ("End screen
   capture") stay while it is held. Off: released after each capture.
4. Projection stopped by the system (user ended sharing, screen locked on
   some Android versions/OEMs, another app captured): an active recording is stopped and
   finalized up to that moment.

## State machine

`IDLE → REQUESTING_PERMISSION → PREPARING → RECORDING ⇄ PAUSED`,
`RECORDING → FINALIZING_SEGMENT → STARTING_NEXT_SEGMENT → RECORDING`,
`→ STOPPING → MERGING → VERIFYING_OUTPUT → COMPLETED`, plus `INTERRUPTED` /
`FAILED`. Transitions are whitelisted (`RecordingStateMachine`): no second
start, Stop is idempotent, no Stop mid segment switch, no merge while
writing. `IDLE/COMPLETED/INTERRUPTED/FAILED → MERGING` for re-merges.

## Segmentation

- One H.264 encoder (input surface fed by the VirtualDisplay) and one AAC
  encoder run for the whole session. Only the MP4 muxer rotates.
- At each boundary (`segmentMinutes`, default 5, any 1–120) a key frame is
  requested; the new file starts on the first key frame at/after the boundary
  (key-frame interval 1 s, so a part is at most ~1 s longer than set). Audio
  older than that frame finishes the old file; the old file closes once audio
  passes it. **No frames or samples are dropped or duplicated between parts —
  there is no transition gap by construction.**
- Each part is rebased to t=0 (plays alone) and its session start time is
  stored, so the merge restores the exact timeline.
- Static screens still produce frames (`KEY_REPEAT_PREVIOUS_FRAME_AFTER`).
- Pause: the display surface is detached (nothing rendered) and audio is
  discarded; paused intervals are removed from timestamps.
- Memory is constant: encoder buffers only; every sample goes straight to a
  file descriptor. A few hundred KB of startup packets are queued only until
  the first file opens.

## A/V sync

Video frame times come from the compositor (CLOCK_MONOTONIC). Audio chunk
times come from `AudioRecord.getTimestamp(TIMEBASE_MONOTONIC)`, the same
clock — not from counting samples, which drifts against the system clock
(≈50 ppm ≈ 0.9 s over 5 h). Both are converted to the same session time.

## Merge

`SegmentMerger` remuxes with MediaExtractor → MediaMuxer: no decode, no
re-encode, one sample in memory at a time, timestamps = part start + sample
time (monotonic per track enforced). Parts with different formats are
rejected. After merging, `MediaCheck` verifies tracks and duration (video
must have video; a session with audio must have audio). Only then is the
MediaStore entry published (`IS_PENDING=0`), the thumbnail made, and — if
"Keep the parts" is off — the parts deleted. A failed merge deletes the
partial output and keeps every part; "Merge parts"/"Re-merge" retries in the
background (dataSync foreground service if no projection is held). A
re-merge replaces the previous output only after the new one verifies.

## Crash / kill recovery

The library entry and segment list are updated as each part starts and
finishes. If the process dies, on next start entries still `recording` /
`processing` from before are checked: finished parts are verified and kept,
the part being written has no MP4 index (MediaMuxer writes it on stop) and is
marked failed — **at most one part interval is lost**. The session becomes
`interrupted` and can be merged from Recordings. Nothing is deleted.

## Storage

| Kind | Default (Android 10+) | Before Android 10 |
|---|---|---|
| Screenshots | `Pictures/Akshar` (MediaStore) | app external files `Pictures/Akshar` |
| Screen recordings | `Movies/Akshar` | app external files `Movies/Akshar` |
| Voice recordings | `Recordings/Akshar` (12+), `Music/Akshar` (10–11) | app external files `Music/Akshar` |
| Merged recordings | same as screen/voice | same |
| Temporary parts | `Android/data/<pkg>/files/recordings/segments` | same |

Any kind can point at a folder picked with `ACTION_OPEN_DOCUMENT_TREE`
(persisted read/write grant). Settings show name, access status, free space,
Change / Use default / Test (writes and deletes a probe file). A revoked
folder blocks Start with a message. No storage permission is requested.
Start is refused below the "Stop when free space is below" threshold
(default 500 MB); during recording free space is checked every 30 s and the
session stops safely below half the threshold. Recordings are never deleted
to make room.

File names: `Screenshot_2026-10-30_10-30-15.png`, `…_Edited.png`,
`ScreenRecording_…​.mp4`, `ScreenRecording_…_Final.mp4` (merged from more
than one part), `VoiceRecording_….m4a`, parts
`Session_20261030_103015_Segment_001.mp4`. Collisions get " (2)" etc.

## Quality

Presets: Low 480p/15 fps/1.5 Mbps, Medium 720p/30/4 Mbps, High 1080p/30/8 Mbps,
Custom (480–1440p, 15–60 fps, 1–20 Mbps). The short side follows the preset,
never above the screen; sizes are multiples of 16. `EncoderSetup.plan` checks
the AVC encoder's `isSizeSupported`, frame-rate and bitrate ranges and lowers
anything unsupported; Settings show the values actually applied and an
estimated size per hour. Hardware encoders are preferred. Audio: Low 22.05 kHz
mono 64 kbps, Standard 44.1 kHz stereo 128 kbps, High 48 kHz stereo 192 kbps,
Custom.

## Screenshots

Bubble hidden for two frames → one ImageReader frame → bubble back. An all-black
frame (FLAG_SECURE window) shows "This screen may be protected". The preview
(thumbnail, countdown, Edit / Save / Discard) sits beside the button for the
configured 2–15 s (default 5) and then discards — or saves, only if "Save when
the preview closes" is on. The editor keeps the original untouched; Save writes
a new `…_Edited.png`. Cancel from the preview's editor brings the preview back.

Editor: pen, highlighter, text (tap to place; optional background; Move tool
to drag), rectangle, arrow, pixelate (for sensitive details), crop (drag, then
Apply), 6 colours, thickness, undo / redo, clear (asks), save, cancel (asks if
edited). Operations are stored in image coordinates and rendered at full
resolution on save.

## Permissions

| Permission | Why |
|---|---|
| `SYSTEM_ALERT_WINDOW` | the floating button, menu, controls and preview (already declared for OCR) |
| MediaProjection consent | every new capture session (Android's own dialog) |
| `FOREGROUND_SERVICE_MEDIA_PROJECTION` | holding screen capture (already declared) |
| `RECORD_AUDIO` + `FOREGROUND_SERVICE_MICROPHONE` | microphone, and Android's gate for system-audio capture (already declared); asked only when an audio mode is used |
| `FOREGROUND_SERVICE_DATA_SYNC` | **new** — merging parts after capture has ended |
| `POST_NOTIFICATIONS` | the ongoing notification with Stop (asked when the button is turned on; recording works without it) |

No network permission is used; nothing is uploaded or logged.

## Known limitations

- **Not yet verified on a physical device.** Built and unit-tested only. Long-duration
  behaviour (1–5 h memory, CPU, battery, heat, drift) must be measured on
  representative phones before claiming it; see the test plan below.
- One screen capture at a time system-wide (see *Independence*).
- System audio: Android 10+; only media/game/unknown usages; apps can opt out
  (`allowAudioPlaybackCapture=false`, common for DRM music/video); calls are never
  captured. Microphone capture is silenced by Android while another app (e.g. a
  call) holds it.
- Secure (`FLAG_SECURE`) windows record as black; the app doesn't try to bypass this.
- Orientation: a recording keeps the size it started with; after rotating, the
  mirrored screen is letterboxed inside it.
- Segment boundaries snap to the next key frame (≤ ~1 s late); a part's length
  is approximate, the timeline is exact.
- A process kill loses the part being written (at most one interval).
- Some Android versions/OEMs end capture when the screen locks; the recording is finalized there.
- Some OEM battery managers may stop foreground services; exempt Akshar from
  battery optimization for multi-hour sessions.
- Folders on cloud document providers may not support the read/write mode
  MP4 writing needs — Test reports this; local storage works.
- Native overlay/editor strings are English (`res/values/strings.xml`), as for the OCR overlay.

## Device test plan

Floating button (on/off, drag + persistence, tap vs long-press, mode persists
after restart, OCR button unaffected), screenshots (preview 5 s, edit
draw/text/crop/undo/redo, save, discard, folder + name, secure screen),
recording (screen; voice system/mic; screen + system; + mic; A/V sync; pause/
resume; notification Stop; navigating the app doesn't stop it), segmentation
(1 min, 5 min, custom, final partial part, auto-merge, order, no corruption,
drift, kill + recover + merge, merge retry, keep/delete parts), progressively
10 min → 30 min → 1 h → 2 h → 5 h measuring memory, CPU, battery, storage,
transition gaps, sync and final playback; storage/permissions (no folder
access, revoked folder, low storage, consent cancelled, mic denied,
notifications denied, process death, rotation, background restrictions).
