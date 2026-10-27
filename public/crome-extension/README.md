# Akshar Listen — Chrome extension

Plays what the **Akshar** Android app reads aloud on your computer. It works
over your own Wi-Fi: no account, no server, nothing goes through the internet.

## Install (Developer mode)

1. Open `chrome://extensions` in Chrome 116 or later.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`public/crome-extension`).
4. Pin **Akshar Listen** from the puzzle-piece menu so its icon stays visible.

## Pair with the phone

1. Connect the phone and the computer to the **same Wi-Fi**. The phone's own
   hotspot also works.
2. In Akshar, open **Settings → Share voice to Chrome** and turn it on. The card
   shows the **phone address** (e.g. `192.168.1.23:47811`) and a **pairing code**
   (e.g. `ABCDE-23456`).
3. Click the extension icon, enter both, and click **Connect**.
4. Check that the phone and the extension show the same **6-digit code**, then
   tap **Allow** on the phone (in the notification or in the card).
5. Click **Play** in the extension, then make Akshar speak (any read-aloud mode,
   or a voice preview). You will hear it on the computer.

- **Pause** stops playback on the computer only. The phone keeps speaking.
- **Play** resumes without reconnecting.
- **Disconnect** ends the session; the next connection needs a new code.
- Turning sharing off on the phone also ends the session.
- Playback continues after the popup closes.
- If Wi-Fi drops, the extension reconnects by itself for about 2 minutes,
  without asking for the code again.

## How it works

```
Phone (Akshar)                                     Computer (Chrome)
SpeechPlayer.speak() ──► phone speaker (unchanged)
      │
      └► SpeechMirror: same text → 2nd TTS client → synthesizeToFile → PCM
                │  sent when the phone starts each paragraph, paced in real time
                ▼
AudioShareHub: WebSocket server on the Wi-Fi :47811 ──(AES-256-GCM)──► background.js (service worker)
                                                                           │ decrypts
                                                                           ▼
                                                     offscreen.html: AudioWorklet jitter buffer → speakers
```

| File | Role |
|---|---|
| `manifest.json` | MV3. Permissions: `offscreen` (audio playback) and `storage`. |
| `protocol.js` | Pairing, key exchange and encrypted framing (WebCrypto). Mirrors `ShareProtocol.kt`. |
| `background.js` | Connection, reconnect, Play/Pause/volume and offscreen lifecycle. The phone's ping every 15 s keeps the service worker alive. |
| `offscreen.html/js` | One `AudioContext` at the stream's sample rate, plus gain for volume. |
| `pcm-player-worklet.js` | Jitter buffer: starts after 150 ms buffered, plays silence on underrun, and keeps at most 1.5 s. |
| `popup.*` | The UI. It holds no state, so closing it changes nothing. |
| `test/e2e.mjs` | End-to-end check against a real phone (below). |

### Security

- **Pairing:** the phone shows a 10-character code (50 bits). The code expires
  after 10 minutes, works once, and is replaced after 5 wrong tries.
- **Key exchange:** P-256 ECDH. Session keys are HKDF-SHA256 over the shared
  secret, salted with the code. Both sides prove they know the code with an
  HMAC before anything else is sent, so a device that doesn't know the code
  can't impersonate either side.
- **Approval:** the user must tap Allow on the phone, after checking that both
  screens show the same 6-digit fingerprint. This defeats a man-in-the-middle on
  the network.
- **Encryption:** all audio and control messages use AES-256-GCM, with one key
  per direction and a strictly increasing counter that rejects replayed frames.
- **Who can connect:** browser pages can't connect, because the phone refuses
  any `http(s)` Origin. Only one computer can be connected at a time; others get
  "busy".
- **Resume key:** a random 32-byte key kept in `chrome.storage.session`, which
  Chrome clears when it closes. It lets the extension reconnect without the
  code, and is revoked when either side disconnects or sharing stops.
- **What is shared:** only Akshar's own synthesized voice. Never the microphone,
  other apps or system audio.

### Why not WebRTC or system audio capture?

- **WebRTC** would need a large native library in the app plus a signaling
  server. Speech is about 48 KB/s of PCM and both devices are on the same
  network, so a WebSocket with a jitter buffer is simpler and gets latency
  under 0.5 s.
- **Android `AudioPlaybackCapture`** needs the microphone (RECORD_AUDIO)
  permission and only captures media/game audio, not the accessibility-usage
  stream TTS plays on. It also depends on the TTS app's capture policy.
  Rendering the same speech a second time needs no permission and doesn't
  touch the phone's playback.

## End-to-end test (Node 22+)

```sh
adb forward tcp:47811 tcp:47811             # or use the phone's Wi-Fi address
node test/e2e.mjs 127.0.0.1:47811 ABCDE-23456 15
```

The script checks the following, in order:

1. A wrong code is rejected.
2. Pairing works (tap Allow on the phone).
3. Audio arrives in real time while you make the app speak.
4. Pausing stops the audio.
5. Dropping the socket and resuming works without the code.
6. After disconnecting, the resume key is revoked.

## Same Wi-Fi vs. different networks

This version is **same-network only**. The phone listens on its local address,
and the extension accepts only private IP addresses (`10.*`, `172.16–31.*`,
`192.168.*`).

Working across different networks would need three things:

- An internet-reachable rendezvous or signaling service, so the two devices can
  find each other.
- NAT traversal: WebRTC with STUN, plus a TURN relay for networks where a
  direct path fails. TURN relays cost money to run.
- Authentication that doesn't rely on being on the same network.

These are deliberately not included, because nothing here needs a paid cloud
service.

## Known limitations

- Untested so far:
  - in Chrome itself
  - Chrome's Local Network Access prompt
  - lock-screen and Wi-Fi-loss behaviour on a phone
- **Local Network Access:** newer Chrome versions may ask whether the extension
  can access devices on your local network. Choose **Allow**.
- **Sync:** the computer can trail the phone by about 0.2–0.5 s. Each paragraph
  starts in step; a long paragraph can drift slightly because the two TTS
  renders don't play at exactly the same speed.
- **Joining mid-paragraph:** audio starts at the next paragraph after you press
  Play.
- **What keeps it running:** sharing runs while the Akshar app process is alive.
  The floating button's service keeps it alive in the background. If Android
  sleeps the Wi-Fi with the screen off, the extension reconnects when it wakes.
- **Chrome restarts:** pairing is lost (the resume key is session-only), and
  after a service-worker restart you press Play again.
- **Mono:** audio is downmixed to mono, which is what TTS produces anyway.
