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
   shows the **phone address** (e.g. `192.168.1.23:47811`).
3. Click the extension icon, enter the address, and click **Connect**.
4. Check that the phone and the extension show the same **6-digit code**, then
   tap **Allow** on the phone (in the notification or in the card).
5. Click **Play** in the extension, then make Akshar speak (any read-aloud mode,
   or a voice preview). You will hear it on the computer.

- **Pause** stops playback on the computer only. The phone keeps speaking.
- **Play** resumes without reconnecting.
- **Disconnect** ends the session; the next connection asks for Allow again.
- Turning sharing off on the phone also ends the session.
- Playback continues after the popup closes.
- If Wi-Fi drops, the extension reconnects by itself for about 2 minutes,
  without asking you to Allow again.

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

- **Pairing:** by address only, no code. Every new computer must be allowed
  on the phone, after checking that both screens show the same 6-digit
  fingerprint. That check is what defeats a man-in-the-middle on the network.
  After a Deny (or no answer within a minute), new requests are refused for
  5 s, so they can't be spammed.
- **Key exchange:** P-256 ECDH. Session keys are HKDF-SHA256 over the shared
  secret, and both sides confirm them with an HMAC.
- **Encryption:** all audio and control messages use AES-256-GCM, with one key
  per direction and a strictly increasing counter that rejects replayed frames.
- **Who can connect:** browser pages can't connect, because the phone refuses
  any `http(s)` Origin. Only one computer can be connected at a time; others get
  "busy".
- **Resume key:** a random 32-byte key kept in `chrome.storage.session`, which
  Chrome clears when it closes. It lets the extension reconnect without asking
  again, and is revoked when either side disconnects or sharing stops.
- **What is shared:** you choose in the app.
  - **Akshar's voice**: only Akshar's own synthesized speech.
  - **All phone audio**: what apps play (YouTube, browser, music, games),
    using Android 10+ playback capture over the floating button's
    screen-capture permission. Android needs the Microphone permission for
    this, but nothing is recorded from the microphone.
  - Never shared: phone and VoIP calls, and apps that opt out of capture
    (often paid video or music apps with DRM).

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

## Troubleshooting: "No answer from the phone"

The computer can't reach the phone over the network. Compare the first three
numbers of the two addresses:

- Phone: shown in the app, e.g. `192.168.10.41`.
- Computer: run `ipconfig` and look for the IPv4 Address, e.g. `192.168.1.21`.

If they differ (`192.168.1.x` vs `192.168.10.x`), the devices are on separate
networks even if both are "on the same Wi-Fi". Common causes:

- a guest Wi-Fi network
- a second router or extender that runs its own network
- AP / client isolation turned on in the router

Fixes, in order of preference:

1. Put both on the same network. Join the computer to the phone's Wi-Fi,
   connect the phone to the main (non-guest) Wi-Fi, or set the second
   router/mesh to bridge or access-point mode.
2. **USB (works anywhere):** plug the phone in with USB debugging on, run
   `adb forward tcp:47811 tcp:47811`, and enter `127.0.0.1:47811` as the
   phone address in the extension.

## End-to-end test (Node 22+)

```sh
adb forward tcp:47811 tcp:47811             # or use the phone's Wi-Fi address
node test/e2e.mjs 127.0.0.1:47811 15
```

The script checks the following, in order:

1. A Deny is respected (tap Deny on the phone).
2. Pairing works (tap Allow on the phone).
3. Audio arrives in real time while you make the app speak.
4. Pausing stops the audio.
5. Dropping the socket and resuming works without asking again.
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
- **Audio format:** Akshar's voice is sent as 24 kHz mono. "All phone audio"
  is sent as 48 kHz stereo, about 1.5 Mbit/s, and only while the phone is
  actually playing something.
