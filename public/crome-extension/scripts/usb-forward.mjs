// Keeps the USB route to the phone open:  npm run usb
//
// The extension reaches the phone at 127.0.0.1:47811 through
// `adb forward tcp:47811 tcp:47811`. adb drops forwards whenever it restarts
// (cable re-plugged, `npm run android`, Android Studio, app installs), so this
// re-applies the forward every few seconds and says when the phone is ready.
// Leave it running while you listen; Ctrl+C to stop.

import { execFile } from 'node:child_process';
import { connect } from 'node:net';

const PORT = 47811;
const EVERY_MS = 3000;
let last = '';

const run = args =>
  new Promise(resolve => execFile('adb', args, { windowsHide: true }, (error, stdout) => resolve(error ? null : stdout)));

const portOpen = () =>
  new Promise(resolve => {
    const socket = connect(PORT, '127.0.0.1');
    socket.setTimeout(1500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });

function report(state) {
  if (state === last) return;
  last = state;
  console.log(`${new Date().toLocaleTimeString()}  ${state}`);
}

async function tick() {
  const devices = await run(['devices']);
  if (devices === null) return report('adb not found — install Android platform-tools and add adb to PATH.');
  if (!/\tdevice\b/.test(devices)) return report('No phone connected by USB (or USB debugging not allowed on the phone).');
  const list = (await run(['forward', '--list'])) ?? '';
  if (!list.includes(`tcp:${PORT} tcp:${PORT}`)) await run(['forward', `tcp:${PORT}`, `tcp:${PORT}`]);
  report(
    (await portOpen())
      ? `Ready — in the extension use 127.0.0.1:${PORT}`
      : 'Phone connected, but sharing is off — open Akshar → Settings → Share voice to Chrome.',
  );
}

console.log('Keeping the USB route to the phone open (Ctrl+C to stop)…');
await tick();
setInterval(tick, EVERY_MS);
