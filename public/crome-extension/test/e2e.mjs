// End-to-end check of the extension's protocol against the real phone app,
// using the same protocol.js the service worker uses (Node 22+: global
// WebSocket + WebCrypto).
//
//   adb forward tcp:47811 tcp:47811          # or use the phone's Wi-Fi address
//   node test/e2e.mjs 127.0.0.1:47811 ABCDE-23456 [listenSeconds]
//
// It: (1) checks a wrong code is rejected, (2) pairs (tap Allow on the
// phone, matching the printed code), (3) listens and measures the audio while
// you make the app speak, (4) pauses and checks audio stops, (5) drops the
// socket and resumes without re-pairing, (6) disconnects.

import { addressToUrl, fromB64, normaliseCode, openSession } from '../protocol.js';

const [address, code, seconds = '15'] = process.argv.slice(2);
const url = addressToUrl(address);
if (!url || normaliseCode(code).length !== 10) {
  console.error('usage: node test/e2e.mjs <address[:port]> <pairing code> [listenSeconds]');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

const audio = { bytes: 0, chunks: 0, rate: 0, channels: 0, first: 0, last: 0, peak: 0 };
const control = [];
const handlers = {
  onJson: json => control.push(json),
  onPcm: (rate, channels, pcm) => {
    const now = Date.now();
    if (!audio.first) audio.first = now;
    audio.last = now;
    audio.bytes += pcm.length * 2;
    audio.chunks++;
    audio.rate = rate;
    audio.channels = channels;
    for (const s of pcm) audio.peak = Math.max(audio.peak, Math.abs(s));
  },
  onClose: () => control.push({ t: 'closed' }),
};

// 1. Wrong code.
try {
  await openSession({ url, mode: 'code', secret: new TextEncoder().encode('AAAAAAAAAA'), name: 'e2e (wrong code)', ...handlers });
  check(false, 'wrong pairing code is rejected');
} catch (e) {
  check(e.code === 'bad_code', `wrong pairing code is rejected (${e.code})`);
}

// 2. Pair.
console.log('\nPairing — tap Allow on the phone when it shows the code below.');
const started = Date.now();
const session = await openSession({
  url,
  mode: 'code',
  secret: new TextEncoder().encode(normaliseCode(code)),
  name: 'e2e test',
  onPending: fp => console.log(`      phone should show: ${fp}`),
  ...handlers,
});
check(Boolean(session.welcome?.resumeKey), `paired with "${session.welcome.device}" in ${Date.now() - started} ms`);

// 3. Listen.
await session.send({ t: 'listen', on: true });
console.log(`\nListening for ${seconds}s — make the app speak now (e.g. Settings → voice preview).`);
const listenStart = Date.now();
await sleep(Number(seconds) * 1000);
const audioSeconds = audio.rate ? audio.bytes / (audio.rate * 2 * audio.channels) : 0;
check(audio.chunks > 0, `received audio: ${audioSeconds.toFixed(2)} s of ${audio.rate} Hz × ${audio.channels} ch in ${audio.chunks} chunks (peak ${audio.peak})`);
if (audio.chunks > 0) {
  const span = (audio.last - audio.first) / 1000;
  check(span <= audioSeconds + 1, `arrives paced near real time (${span.toFixed(2)} s wall for ${audioSeconds.toFixed(2)} s audio)`);
  check(audio.peak > 500, 'audio is not silent');
}
console.log(`      first audio ${audio.first ? audio.first - listenStart : '-'} ms after listen`);

// 4. Pause.
await session.send({ t: 'listen', on: false });
await sleep(800);
const pausedAt = audio.chunks;
console.log('\nPaused — keep the app speaking for 4 s; no audio should arrive.');
await sleep(4000);
check(audio.chunks === pausedAt, `no audio while paused (${audio.chunks - pausedAt} chunks)`);

// 5. Drop and resume (what a Wi-Fi blip looks like).
session.close();
await sleep(500);
const resumed = await openSession({
  url,
  mode: 'resume',
  secret: fromB64(session.welcome.resumeKey),
  name: 'e2e test',
  ...handlers,
}).catch(e => e);
check(Boolean(resumed.send), `resumed without re-pairing${resumed.code ? ` (${resumed.code})` : ''}`);

// 6. Disconnect (forgets the resume key).
if (resumed.send) {
  await resumed.send({ t: 'bye' });
  await sleep(300);
  resumed.close();
  const again = await openSession({ url, mode: 'resume', secret: fromB64(session.welcome.resumeKey), name: 'e2e', ...handlers }).catch(e => e);
  check(again.code === 'resume_invalid', `resume key is revoked after disconnect (${again.code ?? 'accepted'})`);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
process.exit(failures ? 1 : 0);
