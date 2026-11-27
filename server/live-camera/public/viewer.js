// Live camera viewer: watches /s/<publicId> over WebRTC (WHEP via the server).
// No install, no external scripts. Tokens stay in memory only.
(() => {
  'use strict';

  const publicId = location.pathname.split('/').filter(Boolean)[1] || '';
  const $ = id => document.getElementById(id);
  const video = $('video');
  const ui = {
    title: $('title'),
    live: $('live'),
    status: $('status'),
    overlay: $('overlay'),
    spinner: $('spinner'),
    message: $('message'),
    detail: $('detail'),
    auth: $('auth'),
    password: $('password'),
    authError: $('authError'),
    controls: $('controls'),
    mute: $('mute'),
    fullscreen: $('fullscreen'),
  };

  const STATUS_MS = 3000;
  let token = null;
  let iceServers = [];
  let password = '';
  let pc = null;
  let session = null; // WHEP session URL (for DELETE)
  let connecting = false;
  let live = false;
  let retryTimer = 0;
  let retryDelay = 1000;
  let lastFrames = -1;
  let stalledPolls = 0;

  // ── UI ──

  const setStatus = (text, ok = false) => {
    ui.status.textContent = text;
    ui.status.classList.toggle('ok', ok);
  };

  const showOverlay = (message, detail = '', busy = false) => {
    ui.overlay.hidden = false;
    ui.message.textContent = message;
    ui.detail.textContent = detail;
    ui.spinner.hidden = !busy;
  };

  const hideOverlay = () => {
    ui.overlay.hidden = true;
  };

  const setLive = on => {
    live = on;
    ui.live.hidden = !on;
  };

  const offline = (detail = 'This page reconnects by itself when the camera comes back.') => {
    closePc();
    setLive(false);
    ui.controls.hidden = true;
    showOverlay('Camera is currently offline.', detail);
    setStatus('Offline');
  };

  const setTitle = t => {
    if (!t) return;
    ui.title.textContent = t;
    document.title = `${t} · Live`;
  };

  // ── API ──

  const api = async (path, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`/api/view/${encodeURIComponent(publicId)}${path}`, { ...init, headers, cache: 'no-store' });
    return r;
  };

  const errorCode = async r => {
    try {
      return (await r.json()).error || String(r.status);
    } catch {
      return String(r.status);
    }
  };

  /** Gets a viewer token (asks for the password when the stream is private). */
  const join = async () => {
    token = null;
    const r = await api('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(password ? { password } : {}),
    });
    if (r.ok) {
      const j = await r.json();
      token = j.token;
      iceServers = Array.isArray(j.iceServers) ? j.iceServers : [];
      setTitle(j.title);
      ui.auth.hidden = true;
      return j.live;
    }
    const code = await errorCode(r);
    if (code === 'password_required' || code === 'wrong_password') {
      ui.overlay.hidden = true;
      ui.auth.hidden = false;
      ui.authError.textContent = code === 'wrong_password' ? 'Wrong password.' : '';
      setStatus('Password needed');
      ui.password.focus();
      throw new Error('auth');
    }
    if (code === 'rate_limited') {
      ui.authError.textContent = 'Too many attempts. Wait a few minutes and try again.';
      throw new Error('rate');
    }
    if (code === 'not_found') {
      offline('The link may have ended or been revoked by the owner.');
      throw new Error('gone');
    }
    throw new Error(code);
  };

  // ── WebRTC (WHEP) ──

  const closePc = () => {
    if (session) {
      fetch(session, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => {});
      session = null;
    }
    if (pc) {
      pc.ontrack = pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
    }
    video.srcObject = null;
  };

  const gathered = peer =>
    new Promise(resolve => {
      if (peer.iceGatheringState === 'complete') return resolve();
      const done = () => {
        peer.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => peer.iceGatheringState === 'complete' && done();
      peer.addEventListener('icegatheringstatechange', check);
      setTimeout(done, 2500);
    });

  const scheduleRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  };

  const connect = async () => {
    if (connecting || pc) return;
    connecting = true;
    clearTimeout(retryTimer);
    try {
      if (!token) {
        const isLive = await join();
        if (!isLive) return offline();
      }
      showOverlay('Connecting…', '', true);
      setStatus('Connecting…');
      const peer = new RTCPeerConnection({ iceServers });
      pc = peer;
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addTransceiver('audio', { direction: 'recvonly' });
      const stream = new MediaStream();
      peer.ontrack = e => {
        stream.addTrack(e.track);
        video.srcObject = stream;
        video.play().catch(() => {});
      };
      peer.onconnectionstatechange = () => {
        const s = peer.connectionState;
        if (pc !== peer) return;
        if (s === 'connected') {
          retryDelay = 1000;
          lastFrames = -1;
          stalledPolls = 0;
          hideOverlay();
          setLive(true);
          ui.controls.hidden = false;
          setStatus('Connected', true);
        } else if (s === 'failed' || s === 'closed') {
          closePc();
          setLive(false);
          showOverlay('Reconnecting…', '', true);
          setStatus('Reconnecting…');
          scheduleRetry();
        } else if (s === 'disconnected') {
          // Usually a network blip that recovers by itself; if not, start over.
          setStatus('Connection unstable…');
          setTimeout(() => {
            if (pc === peer && peer.connectionState === 'disconnected') {
              closePc();
              scheduleRetry();
            }
          }, 4000);
        }
      };
      await peer.setLocalDescription(await peer.createOffer());
      await gathered(peer);
      const r = await api('/whep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: peer.localDescription.sdp,
      });
      if (pc !== peer) return;
      if (r.status !== 201) {
        const code = await errorCode(r);
        closePc();
        if (code === 'offline') return offline();
        if (code === 'full') {
          showOverlay('This stream is full.', 'The owner set a viewer limit. Trying again shortly…');
          setStatus('Full');
          retryDelay = 10000;
          return scheduleRetry();
        }
        if (code === 'token_expired') token = null;
        showOverlay('Could not connect.', 'Retrying…', true);
        return scheduleRetry();
      }
      const loc = r.headers.get('Location');
      session = loc ? new URL(loc, location.href).href : null;
      await peer.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    } catch (e) {
      const why = e && e.message;
      if (why === 'auth' || why === 'gone' || why === 'rate') return;
      closePc();
      showOverlay('Could not reach the server.', 'Retrying…', true);
      setStatus('Retrying…');
      scheduleRetry();
    } finally {
      connecting = false;
    }
  };

  /** true when no video frame has been decoded over the last two polls. */
  const framesStalled = async () => {
    if (!pc) return false;
    let frames = 0;
    (await pc.getStats()).forEach(r => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') frames = r.framesDecoded || 0;
    });
    stalledPolls = frames === lastFrames ? stalledPolls + 1 : 0;
    lastFrames = frames;
    return stalledPolls >= 2;
  };

  /** Every few seconds: refresh the token, notice the camera going on or off. */
  const poll = async () => {
    if (!ui.auth.hidden || connecting) return;
    try {
      if (!token) {
        if (!password && pc === null && !live) {
          // Public stream that was offline: ask again.
          const isLive = await join();
          if (isLive) connect();
          return;
        }
        return connect();
      }
      const r = await api('/status');
      if (r.status === 401) {
        token = null;
        return;
      }
      if (r.status === 404) {
        token = null;
        return offline('The link may have ended or been revoked by the owner.');
      }
      if (!r.ok) return;
      const j = await r.json();
      token = j.token;
      setTitle(j.title);
      if (!j.live) {
        if (pc || live || ui.overlay.hidden) offline();
      } else if (!pc) connect();
      else if (live && (await framesStalled())) {
        // Live on the server but no new frames here for a while: start over.
        closePc();
        connect();
      }
    } catch {
      setStatus('Network problem…');
    }
  };

  // ── controls ──

  ui.auth.addEventListener('submit', e => {
    e.preventDefault();
    password = ui.password.value;
    ui.authError.textContent = '';
    connect();
  });

  const syncMute = () => {
    ui.mute.textContent = video.muted ? '🔇 Unmute' : '🔊 Mute';
    ui.mute.setAttribute('aria-pressed', String(video.muted));
  };
  ui.mute.addEventListener('click', () => {
    video.muted = !video.muted;
    video.play().catch(() => {});
    syncMute();
  });

  ui.fullscreen.addEventListener('click', () => {
    const stage = $('stage');
    if (document.fullscreenElement) return document.exitFullscreen();
    if (stage.requestFullscreen) return stage.requestFullscreen().catch(() => {});
    if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone Safari
  });
  if (!document.fullscreenEnabled && !video.webkitEnterFullscreen) ui.fullscreen.hidden = true;

  window.addEventListener('online', () => {
    retryDelay = 1000;
    poll();
  });
  window.addEventListener('pagehide', closePc);

  if (!/^[A-Za-z0-9_-]{6,64}$/.test(publicId)) {
    offline('This link is not valid.');
    return;
  }
  syncMute();
  connect();
  setInterval(poll, STATUS_MS);
})();
