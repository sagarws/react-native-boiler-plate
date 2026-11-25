# Remote Access

See and control a computer or another phone running Featured App from this
phone — or let one of them see and control this phone (Android). It speaks the
same protocol as the desktop app's Remote Desktop
(`Featured-App/docs/REMOTE_DESKTOP.md`), so a phone and a computer connect to
each other directly, with the same IDs, relay and security.

Sidebar → **Remote Access**: *Connect* (ID / address, devices on this Wi-Fi,
saved & recent), *This phone* (its ID, allow access, live session, trusted /
blocked devices), *History*. Settings → **Remote Access** holds the defaults.

## Using it

**Control a computer or phone.** Enter its 8-digit ID (shown in Featured App
on that device) → *Connect*. The person there sees the same 6-digit
verification code and accepts; or turn on *Use unattended password* if that
device has one. Devices on the same Wi-Fi appear under *On this network* — tap
one. Every device you connect to is saved (long-press / ⋯ for favorite,
connect with password, remove).

In the viewer:

| Gesture | Touch mode (default) | Trackpad mode |
|---|---|---|
| Tap | Click there | Click at the cursor |
| Drag | Press and drag (select, move windows; a swipe on a phone) | Move the cursor |
| Hold | Right click (computer) / long press (phone) | Right click / long press |
| Two fingers | Scroll (pan when zoomed) | Scroll |
| Pinch | Zoom in / out (*Fit* resets) | Zoom |
| Two-finger tap | Right click | Right click |

Toolbar: **Screens** (shown when the computer has more than one monitor —
pick which one to see and control), **Keyboard** (the phone keyboard types on
the remote; a row of Ctrl / Alt / Shift / ⌘-Win sticky modifiers, Esc, Tab and
arrows sits above it), **Keys** (shortcuts for the remote OS — ⌘ on a Mac, Ctrl
on Windows/Linux — Ctrl+Alt+Del, F1–F12, navigation keys), **Touch / Trackpad**,
**Quality**, hide toolbar. The status line shows LAN / remote server, input
round-trip time, time left and view-only. When the other side is a phone,
◁ ○ ▢ (Back, Home, Recents) are at the bottom. Android's back button asks
whether to disconnect or leave the session running.

**Let someone control this phone (Android).** *This phone* → *Allow remote
access to this phone*. Others connect with the ID shown there. A request shows
who it is, the verification code, full control / view only and the session
length; Android then asks once to allow screen sharing. To let them tap and
type, turn on **Akshar Remote Access** in Android Settings → Accessibility (the
*Open settings* button goes there); without it they can only view. While
shared, a red (control) or amber (view) bar with **Stop** is on every screen.
iPhones cannot be controlled — iOS does not allow it — but can control others.

On the phone being controlled: left click = tap / long press / swipe,
right click = Back, middle click = Home, wheel = swipe, typing goes into the
focused field (Esc = Back, Ctrl/⌘ + A/C/V/X = select all / copy / paste / cut).

## Architecture

```
 Controlling phone                                  Host (computer or Android phone)
 ─────────────────                                  ───────────────────────────────
 RemoteViewerScreen ── gestures / keys ─┐       ┌── capture: getDisplayMedia (MediaProjection on Android)
   RTCView ◀──────── WebRTC video (DTLS-SRTP, P2P / STUN / TURN) ──────────┘
   input ───────────▶ data channels "input" (ordered) / "move" (unordered) ──▶ HostSession → HostInput
 ViewerSession ◀═ TCP (LAN) or WebSocket/TCP relay; X25519 + AES-256-GCM ═▶ HostService      │
                   signalling, displays, timer, permission, keepalive, resume                 ▼
                                                                 RemoteControlService (accessibility)
```

| Layer | Path |
|---|---|
| Wire protocol — byte-for-byte the desktop's (handshake, channel, crypto, relay) | `src/features/remote/core/` (pure TS, @noble crypto) |
| Transports: TCP (react-native-tcp-socket), WebSocket relay, LAN discovery (react-native-udp) | `services/tcp.ts`, `core/wsStream.ts`, `services/discovery.ts` |
| Outgoing session (viewer) | `services/viewerSession.ts` |
| Incoming sessions (host): listener, relay registration, approval, lockouts | `services/hostService.ts`, `services/hostSession.ts`, `services/hostInput.ts` |
| App-wide state + connect flow (LAN → last address → relay) | `services/remote.service.ts` |
| Stores (settings, identity, saved devices, peers, password verifier, history) | `store/` (MMKV keys `remote.*`) |
| Native (Android): input, network facts, keep-screen-on, request notification | `src/specs/NativeRemoteControl.ts`, `android/.../remote/RemoteControlModule.kt`, `RemoteControlService.kt` |
| UI | `screens/`, `components/` (`RemoteHostOverlay` is mounted in `App.tsx`) |

## Security

Same model as the desktop: an Ed25519 identity per install (kept in MMKV; the
8-digit ID is derived from it), fresh X25519 per connection → HKDF →
AES-256-GCM with strict counters, both sides sign the handshake transcript,
the first connection pins the peer's key fingerprint (a changed key is
refused), attended requests show the same verification code on both screens,
unattended passwords are stored only as an Argon2id verifier and proven with an
HMAC over the handshake. WebRTC SDP only travels inside that channel, so video
and input are end-to-end encrypted, through the relay and TURN too.

The phone host checks every input event: only while the session is active,
unexpired and full-control, and only through the accessibility service the
user turned on. View-only and blocked devices cannot inject anything; 3 wrong
passwords → 30 s lockout doubling to 15 min. There is no hidden mode — the
bar with **Stop** is always shown.

Phone-specific choices: a phone host uses Argon2id at 19 MiB / 2 passes (OWASP
minimum) instead of the desktop's 64 MiB / 3, because pure-JS Argon2 on a phone
is several times slower and each connecting device pays it once.

## Verification

- `src/features/remote/__tests__/` (19): base64/UTF-8, phone↔phone handshake
  (attended + same code on both sides, view-only stays view-only, wrong ID,
  declined, blocked, unattended right/wrong password + lockout hook), encrypted
  channel both ways + tampered frame closes it, ID / address / relay parsing,
  password policy, input validation, host key/mouse mapping, viewer geometry.
- Interop with the desktop's own code (run during development, not part of
  this repo): the phone core against `electron/main/remote/core` and
  `tools/remote-relay/relay.ts` over real sockets — identity/ID/fingerprint
  and Argon2/HMAC equality, phone → desktop attended + 64 MiB password +
  rejected + pinned-key refusal, desktop → phone attended (same code) +
  password, phone registered on the relay (TCP) and reached by the desktop,
  phone → desktop through the relay over WebSocket: 10/10 passed.

**Not verified yet:** a session on real devices (video, gestures, the
accessibility service, MediaProjection consent), LAN discovery on real Wi-Fi,
iOS (pods not installed/built).

## Limits

- The phone must have the app open (or a session running) to be reachable;
  Android may freeze background apps.
- Android asks for screen-sharing consent on every session, unattended too.
- Typing into the phone host works in standard text fields; apps with custom
  editors may ignore accessibility text input. Gestures are dispatched when the
  finger lifts, so a remote drag shows when it ends.
- No clipboard sync or file transfer from the phone (the desktop's
  clipboard/file features are off in sessions with a phone).
- The built-in relay in `core/constants.ts` mirrors the desktop's current
  test tunnel; replace both with the real server before release.
