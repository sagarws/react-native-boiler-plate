import { parseInputEvent, textEvents } from '../core/input';
import {
  normaliseRelay,
  parseConnectTarget,
  parseDeviceId,
  passwordProblem,
} from '../core/ids';
import { HostInput, type InputSink } from '../services/hostInput';
import { clampPan, toRemotePoint, videoRect } from '../utils/geometry';
import { keyForChar, shortcutsFor } from '../utils/keys';

describe('device IDs and targets', () => {
  it('accepts 8 digits, spaced, and the old WD form', () => {
    expect(parseDeviceId('19304289')).toBe('19304289');
    expect(parseDeviceId('1930 4289')).toBe('19304289');
    expect(parseDeviceId('WD-019-304-289')).toBe('19304289');
    expect(parseDeviceId('1234')).toBeNull();
  });

  it('parses IDs and addresses', () => {
    expect(parseConnectTarget('1930 4289')).toEqual({
      kind: 'id',
      id: '19304289',
    });
    expect(parseConnectTarget('192.168.1.58')).toEqual({
      kind: 'address',
      host: '192.168.1.58',
      port: 47800,
    });
    expect(parseConnectTarget('office-pc:48000')).toEqual({
      kind: 'address',
      host: 'office-pc',
      port: 48000,
    });
    expect(parseConnectTarget('not valid!')).toBeNull();
  });

  it('normalises relays like the desktop', () => {
    expect(normaliseRelay('https://Relay.example.com/')).toBe(
      'wss://relay.example.com',
    );
    expect(normaliseRelay('relay.example.com:47900')).toBe(
      'relay.example.com:47900',
    );
    expect(normaliseRelay('relay.example.com')).toBe('');
  });

  it('password policy', () => {
    expect(passwordProblem('short')).toBe('tooShort');
    expect(passwordProblem('aaaaaaaaaa')).toBe('repeated');
    expect(passwordProblem('abcdefgh')).toBe('weak');
    expect(passwordProblem('Abcdefg1')).toBeNull();
  });
});

describe('input', () => {
  it('validates events like the desktop host', () => {
    expect(parseInputEvent({ k: 'md', b: 0, x: 0.5, y: 0.5 })).toEqual({
      k: 'md',
      b: 0,
      x: 0.5,
      y: 0.5,
    });
    expect(parseInputEvent({ k: 'md', b: 3, x: 0.5, y: 0.5 })).toBeNull();
    expect(parseInputEvent({ k: 'mm', x: 2, y: 0 })).toBeNull();
    expect(parseInputEvent({ k: 'kd', c: 'Key A' })).toBeNull();
    expect(parseInputEvent({ k: 'tx', t: 'x'.repeat(65) })).toBeNull();
  });

  it('splits long text into accepted chunks', () => {
    const events = textEvents('a'.repeat(150));
    expect(events).toHaveLength(3);
    expect(events.every(e => e.k === 'tx' && e.t.length <= 64)).toBe(true);
  });

  it('maps characters to US keys for modifier shortcuts', () => {
    expect(keyForChar('c')).toEqual({ code: 'KeyC', shift: false });
    expect(keyForChar('C')).toEqual({ code: 'KeyC', shift: true });
    expect(keyForChar('?')).toEqual({ code: 'Slash', shift: true });
  });

  it('uses ⌘ on a Mac and Ctrl on Windows', () => {
    expect(shortcutsFor('darwin').find(s => s.name === 'copy')?.codes).toEqual([
      'MetaLeft',
      'KeyC',
    ]);
    expect(shortcutsFor('win32').find(s => s.name === 'copy')?.codes).toEqual([
      'ControlLeft',
      'KeyC',
    ]);
  });
});

describe('phone host input', () => {
  const sink = () => {
    const calls: string[] = [];
    const s: InputSink = {
      pointer: (a, x, y, b) => calls.push(`p ${a} ${x} ${y} ${b}`),
      scroll: (_x, _y, dx, dy) => calls.push(`s ${dx} ${dy}`),
      globalAction: n => calls.push(`g ${n}`),
      typeText: t => calls.push(`t ${t}`),
      editAction: n => calls.push(`e ${n}`),
    };
    return { s, calls };
  };

  it('left button = touch, right = Back, moves only while pressed', () => {
    const { s, calls } = sink();
    const input = new HostInput(s);
    input.handle({ k: 'mm', x: 0.1, y: 0.1 });
    input.handle({ k: 'md', b: 0, x: 0.2, y: 0.3 });
    input.handle({ k: 'mm', x: 0.4, y: 0.5 });
    input.handle({ k: 'mu', b: 0, x: 0.4, y: 0.5 });
    input.handle({ k: 'md', b: 2, x: 0.4, y: 0.5 });
    expect(calls).toEqual([
      'p down 0.2 0.3 0',
      'p move 0.4 0.5 0',
      'p up 0.4 0.5 0',
      'p down 0.4 0.5 2',
    ]);
  });

  it('types positional keys with Shift, Esc = Back, Ctrl+V = paste', () => {
    const { s, calls } = sink();
    const input = new HostInput(s);
    input.handle({ k: 'kd', c: 'KeyH' });
    input.handle({ k: 'kd', c: 'ShiftLeft' });
    input.handle({ k: 'kd', c: 'Digit1' });
    input.handle({ k: 'ku', c: 'ShiftLeft' });
    input.handle({ k: 'kd', c: 'Escape' });
    input.handle({ k: 'kd', c: 'ControlLeft' });
    input.handle({ k: 'kd', c: 'KeyV' });
    input.handle({ k: 'ku', c: 'ControlLeft' });
    input.handle({ k: 'kd', c: 'Backspace' });
    input.handle({ k: 'kd', c: 'BrowserHome' });
    expect(calls).toEqual([
      't h',
      't !',
      'g back',
      'e paste',
      'e backspace',
      'g home',
    ]);
  });
});

describe('viewer geometry', () => {
  const container = { width: 400, height: 800 };
  const video = { width: 1920, height: 1080 };

  it('fits, maps touches, and ignores the letterbox', () => {
    const r = videoRect(container, video, 1, { x: 0, y: 0 });
    expect(r.width).toBe(400);
    expect(Math.round(r.height)).toBe(225);
    expect(toRemotePoint(r, 200, r.top + r.height / 2)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(toRemotePoint(r, 200, 10)).toBeNull();
  });

  it('keeps a zoomed picture covering the screen', () => {
    expect(clampPan(container, video, 3, { x: 9999, y: 0 }).x).toBe(400);
    expect(clampPan(container, video, 1, { x: 50, y: 50 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});
