// Plays PCM forwarded by the service worker. One AudioContext at the
// stream's sample rate (Chrome resamples to the output device), an
// AudioWorklet jitter buffer, and a gain node for volume.

let context = null;
let player = null;
let gain = null;
let volume = 0.9;
let rate = 0;

async function ensureContext(sampleRate) {
  if (context && rate === sampleRate) {
    if (context.state === 'suspended') await context.resume();
    return;
  }
  if (context) await context.close();
  rate = sampleRate;
  context = new AudioContext({ sampleRate, latencyHint: 'interactive' });
  await context.audioWorklet.addModule('pcm-player-worklet.js');
  player = new AudioWorkletNode(context, 'pcm-player', { outputChannelCount: [1] });
  gain = new GainNode(context, { gain: volume });
  player.connect(gain).connect(context.destination);
}

function toFloat(base64, channels) {
  const s = atob(base64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const frames = Math.floor(pcm.length / channels);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm[f * channels + c];
    out[f] = sum / channels / 32768;
  }
  return out;
}

// Messages are handled one at a time so audio stays in order while a
// context is being (re)created.
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener(message => {
  if (message?.target !== 'offscreen') return false;
  queue = queue.then(() => handle(message)).catch(() => {});
  return false;
});

async function handle(message) {
  switch (message.type) {
    case 'pcm': {
      await ensureContext(message.rate);
      const samples = toFloat(message.data, Math.max(1, message.channels));
      player.port.postMessage({ type: 'push', samples }, [samples.buffer]);
      break;
    }
    case 'flush':
      player?.port.postMessage({ type: 'flush' });
      break;
    case 'volume':
      volume = message.value;
      if (gain) gain.gain.setTargetAtTime(volume, context.currentTime, 0.02);
      break;
  }
}
