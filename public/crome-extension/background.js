// Service worker: owns the connection to the phone. The WebSocket's regular
// traffic (the phone pings every 15 s) keeps the worker alive (Chrome 116+).
// Audio is decrypted here and forwarded to the offscreen document, which plays
// it — so playback continues with the popup closed.

import { PAIR_SECRET, addressToUrl, fromB64, openSession, toB64 } from './protocol.js';

const OFFSCREEN_URL = 'offscreen.html';
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000];
const IDLE_TIMEOUT_MS = 40_000;

/** What the popup shows. */
const state = {
  status: 'disconnected', // disconnected | connecting | awaiting_approval | connected | reconnecting
  playing: false,
  address: '',
  device: '',
  fingerprint: '',
  error: '',
  volume: 0.9,
  lastAudioAt: 0,
  // Reported by the phone: what it shares ('app' | 'device') and, for all
  // phone audio, whether capture runs or what's missing.
  phoneSource: '',
  deviceAudio: '',
};

let session = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let idleTimer = null;
let creatingOffscreen = null;
let connectSeq = 0;

// ── State + popup messaging ─────────────────────────────────────────────

function publish(patch = {}) {
  Object.assign(state, patch);
  chrome.runtime.sendMessage({ target: 'popup', type: 'state', state: snapshot() }).catch(() => {});
}

function snapshot() {
  return { ...state, receiving: state.playing && Date.now() - state.lastAudioAt < 1500 };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'background') return false;
  const handlers = {
    getState: async () => snapshot(),
    connect: async () => connect(message.address),
    disconnect: async () => disconnect(true),
    play: async () => setPlaying(true),
    pause: async () => setPlaying(false),
    volume: async () => setVolume(message.value),
    retry: async () => retry(),
  };
  const handler = handlers[message.type];
  if (!handler) return false;
  handler().then(
    result => sendResponse(result ?? snapshot()),
    () => sendResponse(snapshot()),
  );
  return true;
});

// ── Connecting ──────────────────────────────────────────────────────────

function deviceName() {
  const platform = navigator.userAgentData?.platform || 'computer';
  return `Chrome on ${platform}`;
}

/** New pairing: the phone asks its user to Allow this computer. */
async function connect(address) {
  const url = addressToUrl(address);
  if (!url) return publish({ error: 'bad_address' });
  await chrome.storage.local.set({ address: address.trim() });
  await chrome.storage.session.remove('resume');
  stopReconnecting();
  closeSession();
  await open({ url, address: address.trim(), mode: 'pair', secret: PAIR_SECRET });
}

async function open({ url, address, mode, secret }) {
  const seq = ++connectSeq;
  publish({
    status: mode === 'resume' ? 'reconnecting' : 'connecting',
    address,
    error: '',
    fingerprint: '',
  });
  try {
    const s = await openSession({
      url,
      mode,
      secret,
      name: deviceName(),
      onPending: fingerprint => {
        if (seq === connectSeq) publish({ status: 'awaiting_approval', fingerprint });
      },
      onJson: json => onControl(json),
      onPcm: (rate, channels, pcm) => onAudio(rate, channels, pcm),
      onClose: () => {
        if (session === s) onDropped('closed');
      },
    });
    if (seq !== connectSeq) {
      s.close();
      return;
    }
    session = s;
    reconnectAttempt = 0;
    await chrome.storage.session.set({ resume: { address, url, key: s.welcome.resumeKey, device: s.welcome.device } });
    publish({ status: 'connected', device: String(s.welcome.device || 'Akshar'), fingerprint: s.fingerprint, error: '' });
    touch();
    // Resume where the user left off: listening again if they were.
    if (state.playing) await s.send({ t: 'listen', on: true });
  } catch (e) {
    if (seq !== connectSeq) return;
    const code = e?.code || 'unreachable';
    if (mode === 'resume' && ['unreachable', 'timeout', 'closed'].includes(code)) {
      scheduleReconnect();
      return;
    }
    if (mode === 'resume') await chrome.storage.session.remove('resume');
    publish({ status: 'disconnected', error: code, fingerprint: '' });
    await stopOffscreen();
  }
}

function onControl(json) {
  touch();
  switch (json.t) {
    case 'ping':
      session?.send({ t: 'pong' });
      if (typeof json.source === 'string') {
        publish({ phoneSource: json.source, deviceAudio: String(json.deviceAudio || '') });
      }
      break;
    case 'flush':
      sendToOffscreen({ type: 'flush' });
      break;
    case 'bye':
      // The phone ended it on purpose: don't try to resume.
      chrome.storage.session.remove('resume');
      closeSession();
      state.playing = false;
      publish({ status: 'disconnected', error: String(json.reason || 'closed') });
      stopOffscreen();
      break;
  }
}

async function onAudio(rate, channels, pcm) {
  touch();
  if (!state.playing) return;
  state.lastAudioAt = Date.now();
  await ensureOffscreen();
  sendToOffscreen({ type: 'pcm', rate, channels, data: toB64(new Uint8Array(pcm.buffer)) });
}

/** The connection dropped without a goodbye: try to resume. */
function onDropped() {
  closeSession();
  sendToOffscreen({ type: 'flush' });
  scheduleReconnect();
}

async function scheduleReconnect() {
  const { resume } = await chrome.storage.session.get('resume');
  if (!resume) {
    publish({ status: 'disconnected', error: 'closed' });
    return;
  }
  if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
    publish({ status: 'disconnected', error: 'unreachable' });
    return;
  }
  publish({ status: 'reconnecting', address: resume.address, device: resume.device || state.device });
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectAttempt++;
    open({ url: resume.url, address: resume.address, mode: 'resume', secret: fromB64(resume.key) });
  }, RECONNECT_DELAYS_MS[reconnectAttempt]);
}

function stopReconnecting() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
}

async function retry() {
  stopReconnecting();
  const { resume } = await chrome.storage.session.get('resume');
  if (resume) {
    await open({ url: resume.url, address: resume.address, mode: 'resume', secret: fromB64(resume.key) });
  } else {
    const { address } = await chrome.storage.local.get('address');
    if (address) await connect(address);
    else publish({ error: 'bad_address' });
  }
}

/** No traffic for a while (phone gone without a TCP close): treat as a drop. */
function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (session) onDropped('idle');
  }, IDLE_TIMEOUT_MS);
}

function closeSession() {
  clearTimeout(idleTimer);
  const s = session;
  session = null;
  s?.close();
}

async function disconnect(byUser) {
  connectSeq++;
  stopReconnecting();
  if (byUser) await session?.send({ t: 'bye' }).catch(() => {});
  closeSession();
  await chrome.storage.session.remove('resume');
  state.playing = false;
  publish({ status: 'disconnected', error: '', fingerprint: '', device: '', phoneSource: '', deviceAudio: '' });
  await stopOffscreen();
}

// ── Play / pause / volume ───────────────────────────────────────────────

async function setPlaying(on) {
  state.playing = on;
  if (on) {
    // Created in response to the user's click.
    await ensureOffscreen();
    sendToOffscreen({ type: 'volume', value: state.volume });
  } else {
    sendToOffscreen({ type: 'flush' });
  }
  // Pausing only stops the receiver; the phone keeps speaking as usual.
  await session?.send({ t: 'listen', on }).catch(() => {});
  publish();
}

async function setVolume(value) {
  const v = Math.min(1, Math.max(0, Number(value) || 0));
  await chrome.storage.local.set({ volume: v });
  sendToOffscreen({ type: 'volume', value: v });
  publish({ volume: v });
}

// ── Offscreen audio document ────────────────────────────────────────────

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Plays the audio streamed from the paired Akshar phone app.',
      })
      .then(() => sendToOffscreen({ type: 'volume', value: state.volume }))
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function stopOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
}

function sendToOffscreen(message) {
  chrome.runtime.sendMessage({ target: 'offscreen', ...message }).catch(() => {});
}

// ── Startup ─────────────────────────────────────────────────────────────

(async () => {
  const { volume } = await chrome.storage.local.get('volume');
  if (typeof volume === 'number') state.volume = volume;
  // The worker was restarted while paired: pick the session back up.
  const { resume } = await chrome.storage.session.get('resume');
  if (resume && !session) scheduleReconnect();
})();
