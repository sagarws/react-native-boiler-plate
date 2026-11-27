# Share Live Camera — streaming server

Turns the app's **Share Live Camera** into a public webcam: the phone streams to
this server, the server gives it a link, anyone opens the link in a browser.

```
Phone (react-native-webrtc) ──WHIP over HTTPS──▶ signal ──▶ MediaMTX ──WHEP──▶ browsers
         outbound only                        (Node/TS)    (WebRTC SFU)
```

* The phone only makes **outbound** connections, so mobile data with CGNAT
  works; it never needs a public IP or port forwarding.
* The phone uploads once; MediaMTX copies the stream to every viewer.
* Viewers need nothing installed: `https://<server>/s/<link-id>`.

| Part | What it does | Public port |
|---|---|---|
| `caddy` | HTTPS (Let's Encrypt), the only web entry | 80, 443 TCP |
| `signal` (this folder, `src/`) | streams, IDs, owner + viewer tokens, passwords, links (regenerate / revoke), viewer limit, rate limits, cleanup, viewer page, WHIP/WHEP proxy, MediaMTX auth hook | — (internal :8080) |
| `mediamtx` | WebRTC media | 8189 UDP + TCP |
| `coturn` (optional) | TURN relay for networks that block 8189 | 3478 + 49160–49200 UDP |

MediaMTX's HTTP and API ports are never published. Every publish, read and API call
is checked through the signal server's auth hook, which only lets the signal server's
own requests through. RTSP, RTMP, HLS and SRT are switched off.

## HTTPS without a domain

Release Android builds refuse plain `http://`, and browsers want HTTPS. You
don't need to buy a domain: **sslip.io** maps `203-0-113-25.sslip.io` to
`203.0.113.25`, so Caddy can get a real Let's Encrypt certificate for that name.
Use your VPS IP with dashes. A domain you own works the same way (`SITE_ADDRESS=live.example.com`).
Plain `http://IP:8080` is only good for testing with debug builds and desktop browsers.

## Deploy on a VPS (Docker)

Any Ubuntu/Debian VPS with a public IPv4 and Docker installed (`curl -fsSL https://get.docker.com | sh`).

```bash
# 1. Upload (from your computer)
scp -r server/live-camera root@YOUR_VPS_IP:/opt/live-camera

# 2. Configure (on the VPS)
cd /opt/live-camera
cp .env.example .env
sed -i "s/^TOKEN_SECRET=.*/TOKEN_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^MTX_SECRET=.*/MTX_SECRET=$(openssl rand -hex 32)/" .env
nano .env        # PUBLIC_IP, SITE_ADDRESS, PUBLIC_URL (and TURN_* if used)

# 3. Firewall (ufw); also open these in the provider's firewall if it has one
ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 8189/udp && ufw allow 8189/tcp

# 4. Start
docker compose up -d --build
docker compose logs -f signal     # "live-camera 1.0.0 listening …"
```

Check from any computer: `curl https://203-0-113-25.sslip.io/healthz` →
`{"ok":true,"name":"live-camera",…}`.

### TURN / STUN

The server has a public IP, so phones and browsers usually reach MediaMTX
directly over UDP 8189, or TCP 8189 when UDP is blocked. TURN is only for
networks that block both:

* **This VPS already runs coturn** (the Featured App relay's `setup-turn.sh`):
  put its `static-auth-secret` in `TURN_SECRET` and set `TURN_URLS` /
  `STUN_URLS` to it. Don't start the `turn` profile; the ports would clash.
* **No coturn yet:** set `TURN_SECRET` (`openssl rand -hex 32`) and run
  `docker compose --profile turn up -d`. Also open 3478 TCP/UDP and
  49160–49200 UDP.

The signal server hands out short-lived TURN logins (coturn's REST scheme),
so no TURN password is ever built into the app.

### The app

Set the server in the app: **Share Live Camera → Stream settings → Streaming server**
(`https://203-0-113-25.sslip.io`), then **Save & test**. To make it the default
for new installs, set `LIVE_CAMERA_SERVER=` in the app's `.env` before building.

The tab is hidden by default. Open the side menu, tap the logo 5 times, enter the
access password and switch on **Share Live Camera**.

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `PUBLIC_IP` | — | VPS IPv4, advertised to WebRTC clients |
| `SITE_ADDRESS` | — | what Caddy serves (`1-2-3-4.sslip.io`, a domain, or `:80`) |
| `PUBLIC_URL` | — | base of share links, e.g. `https://1-2-3-4.sslip.io` |
| `TOKEN_SECRET` | — | ≥ 32 chars; signs viewer tokens |
| `MTX_SECRET` | — | ≥ 24 chars; signal ⇄ MediaMTX |
| `TURN_SECRET`, `TURN_URLS`, `STUN_URLS` | empty | optional |
| `MAX_STREAMS` | 50 | streams on the server |
| `MAX_STREAMS_PER_IP` | 3 | |
| `MAX_VIEWERS_CAP` | 50 | upper bound for a stream's viewer limit |
| `VIEWER_TOKEN_TTL_SEC` | 600 | viewer tokens expire; the page renews them while watching |
| `STREAM_OFFLINE_TTL_SEC` | 900 | a stream offline this long is deleted (link dies) |
| `STREAM_MAX_LIFETIME_SEC` | 43200 | hard limit (12 h) |

Rate limits (per client IP): 10 new streams/hour, 60 joins/min, 10 password
attempts per link per 15 min, 30 WHEP/WHIP offers/min, 600 API calls/min.

## Security

* **Phone:** the server returns an *owner token* (32 random bytes) when the stream is
  created. It is stored only as a SHA-256 hash, and the phone keeps it in memory only.
  The app holds no server credentials.
* **Links:** `/s/<publicId>` uses 9 random bytes. **New link** replaces it, and
  **Revoke** removes it. Either way, the old link and every token issued for it
  stop working immediately, and current viewers are disconnected.
* **Viewers:** each viewer gets an HMAC-signed token with an expiry, tied to the
  current link id.
* **Private streams:** the password is stored as a scrypt hash, attempts are
  rate-limited, and the app never saves it.
* **Logging:** logs never contain tokens, passwords, link ids or SDP.
* **Viewer page:** strict CSP, no third-party scripts, `Referrer-Policy: no-referrer`.

Streams live in memory: restarting `signal` ends them, and the app shows "The server
ended this stream. Start again for a new link."

## Develop / test

```bash
npm test              # node --test (no dependencies needed, Node ≥ 22.18)
npm run typecheck     # needs typescript + @types/node (npm i)
# Run locally against a MediaMTX binary (https://github.com/bluenviron/mediamtx/releases):
MTX_AUTHHTTPADDRESS="http://127.0.0.1:8080/internal/mtx-auth?key=$MTX_SECRET" ./mediamtx mediamtx.yml
PUBLIC_URL=http://127.0.0.1:8080 TOKEN_SECRET=… MTX_SECRET=… npm start
```

## Limits (honest)

* Android may still stop a background app on some manufacturers' builds,
  despite the foreground service. If streams stop when minimised, exclude the
  app from battery optimisation.
* One server process; streams don't survive a restart.
* Viewers behind very strict firewalls (UDP *and* TCP 8189 blocked) need TURN.
