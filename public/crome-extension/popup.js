// Popup: renders the service worker's state and sends user actions. It holds
// no connection itself, so closing it changes nothing.

const $ = id => document.getElementById(id);

const ERRORS = {
  bad_address: 'Enter the phone address shown in the app, e.g. 192.168.1.23:47811.',
  bad_code_format: 'The pairing code has 10 letters and numbers, e.g. ABCDE-23456.',
  bad_code: 'Wrong pairing code. Check it in the app (a new one appears after 5 wrong tries).',
  code_expired: 'That code expired. The app shows a new one.',
  busy: 'Another computer is connected to this phone.',
  denied: 'The connection was not allowed on the phone.',
  resume_invalid: 'The session ended. Pair again with the code in the app.',
  need_code: 'Pair again with the code shown in the app.',
  unreachable: "Can't reach the phone. Is sharing on in the app, and are both on the same Wi-Fi?",
  timeout: 'The phone did not answer in time. Try again.',
  closed: 'The connection was lost.',
  bad_server: "That device didn't prove it has the code. Check the address.",
  bad_version: 'Update Akshar or this extension — their versions differ.',
  sharing_stopped: 'Sharing was turned off on the phone.',
  disconnected_by_phone: 'The phone ended the connection.',
};
const RETRYABLE = new Set(['unreachable', 'timeout', 'closed']);

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ target: 'background', type, ...extra }).then(render, () => {});
}

function render(state) {
  if (!state) return;
  const { status } = state;
  const connected = status === 'connected';
  const busy = ['connecting', 'awaiting_approval', 'reconnecting'].includes(status);

  $('pair').hidden = status !== 'disconnected';
  $('busy').hidden = !busy;
  $('live').hidden = !connected;

  const pill = $('pill');
  pill.className = 'pill';
  if (connected && state.receiving) {
    pill.textContent = 'Streaming';
    pill.classList.add('live');
  } else if (connected) {
    pill.textContent = 'Connected';
    pill.classList.add('ok');
  } else if (busy) {
    pill.textContent = status === 'reconnecting' ? 'Reconnecting' : 'Waiting';
    pill.classList.add('wait');
  } else {
    pill.textContent = 'Disconnected';
  }

  $('busy-text').textContent =
    status === 'awaiting_approval'
      ? 'Waiting for your phone…'
      : status === 'reconnecting'
        ? `Reconnecting to ${state.device || 'your phone'}…`
        : 'Connecting…';
  $('approve').hidden = status !== 'awaiting_approval';
  $('fingerprint').textContent = state.fingerprint || '— —';

  $('device').textContent = state.device || 'Akshar';
  $('live-fingerprint').textContent = state.fingerprint;
  $('play').disabled = state.playing;
  $('pause').disabled = !state.playing;
  $('dot').className = state.receiving ? 'dot live' : 'dot';
  $('playback').textContent = !state.playing
    ? 'Paused — press Play to listen'
    : state.receiving
      ? 'Playing'
      : 'Playing — waiting for the phone to speak';
  const pct = Math.round(state.volume * 100);
  if (document.activeElement !== $('volume')) $('volume').value = String(pct);
  $('volume-value').textContent = `${pct}%`;

  const message = state.error ? ERRORS[state.error] || 'Something went wrong. Try again.' : '';
  $('error').hidden = !message;
  $('error-text').textContent = message;
  $('retry').hidden = !RETRYABLE.has(state.error);
}

$('connect').addEventListener('click', () => {
  send('connect', { address: $('address').value, code: $('code').value });
});
$('code').addEventListener('input', e => {
  // Type freely; shown as ABCDE-23456.
  const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  e.target.value = clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
});
$('code').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('connect').click();
});
$('cancel').addEventListener('click', () => send('disconnect'));
$('disconnect').addEventListener('click', () => send('disconnect'));
$('play').addEventListener('click', () => send('play'));
$('pause').addEventListener('click', () => send('pause'));
$('retry').addEventListener('click', () => send('retry'));
$('volume').addEventListener('input', e => send('volume', { value: Number(e.target.value) / 100 }));

chrome.runtime.onMessage.addListener(message => {
  if (message?.target === 'popup' && message.type === 'state') render(message.state);
});

(async () => {
  const { address } = await chrome.storage.local.get('address');
  if (address) $('address').value = address;
  await send('getState');
  // "Streaming" depends on recent audio, so refresh while open.
  setInterval(() => send('getState'), 1000);
})();
