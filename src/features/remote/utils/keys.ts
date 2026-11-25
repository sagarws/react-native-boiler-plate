import { charForCode } from '../core/keymap';
import type { RemotePlatform } from '../types';

/*
 * Keys for a phone keyboard that has no Ctrl, Alt, Esc or F-keys: the
 * special-keys panel, sticky modifiers, and host-aware shortcuts (⌘ on a Mac,
 * Ctrl on Windows/Linux). Codes are KeyboardEvent.code, as the desktop
 * expects (keys travel by physical position).
 */

export type Modifier = 'ControlLeft' | 'AltLeft' | 'ShiftLeft' | 'MetaLeft';

export interface KeyButton {
  id: string;
  /** Visible label (symbols, not translated). */
  label: string;
  codes: string[];
}

export interface Shortcut {
  /** i18n key under remote.keys */
  name:
    | 'copy'
    | 'paste'
    | 'cut'
    | 'undo'
    | 'redo'
    | 'selectAll'
    | 'save'
    | 'find'
    | 'switchApp'
    | 'closeWindow'
    | 'taskManager'
    | 'lock'
    | 'desktop'
    | 'start'
    | 'spotlight';
  codes: string[];
}

const ALL_CODES: string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => `Key${c}`),
  ...'0123456789'.split('').map(d => `Digit${d}`),
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'Comma',
  'Period',
  'Slash',
  'Space',
  'Tab',
];

/** A character → the US-layout key that types it (and whether Shift is needed). */
export const keyForChar = (
  ch: string,
): { code: string; shift: boolean } | null => {
  if (ch === '\n') return { code: 'Enter', shift: false };
  for (const code of ALL_CODES) {
    if (charForCode(code, false) === ch) return { code, shift: false };
    if (charForCode(code, true) === ch) return { code, shift: true };
  }
  return null;
};

export const isMac = (p: RemotePlatform) => p === 'darwin';
export const isPhone = (p: RemotePlatform) => p === 'android' || p === 'ios';

export const modifierLabel = (m: Modifier, host: RemotePlatform): string => {
  if (m === 'ShiftLeft') return '⇧ Shift';
  if (m === 'ControlLeft') return isMac(host) ? '⌃ Control' : 'Ctrl';
  if (m === 'AltLeft') return isMac(host) ? '⌥ Option' : 'Alt';
  return isMac(host) ? '⌘ Cmd' : host === 'win32' ? '⊞ Win' : 'Super';
};

export const MODIFIERS: Modifier[] = [
  'ControlLeft',
  'AltLeft',
  'ShiftLeft',
  'MetaLeft',
];

export const NAV_KEYS: KeyButton[] = [
  { id: 'esc', label: 'Esc', codes: ['Escape'] },
  { id: 'tab', label: 'Tab ⇥', codes: ['Tab'] },
  { id: 'enter', label: 'Enter ⏎', codes: ['Enter'] },
  { id: 'bksp', label: '⌫', codes: ['Backspace'] },
  { id: 'del', label: 'Del', codes: ['Delete'] },
  { id: 'up', label: '↑', codes: ['ArrowUp'] },
  { id: 'down', label: '↓', codes: ['ArrowDown'] },
  { id: 'left', label: '←', codes: ['ArrowLeft'] },
  { id: 'right', label: '→', codes: ['ArrowRight'] },
  { id: 'home', label: 'Home', codes: ['Home'] },
  { id: 'end', label: 'End', codes: ['End'] },
  { id: 'pgup', label: 'PgUp', codes: ['PageUp'] },
  { id: 'pgdn', label: 'PgDn', codes: ['PageDown'] },
  { id: 'ins', label: 'Ins', codes: ['Insert'] },
  { id: 'prt', label: 'PrtSc', codes: ['PrintScreen'] },
];

export const FUNCTION_KEYS: KeyButton[] = Array.from(
  { length: 12 },
  (_, i) => ({
    id: `f${i + 1}`,
    label: `F${i + 1}`,
    codes: [`F${i + 1}`],
  }),
);

/** The quick row above the soft keyboard. */
export const QUICK_KEYS: KeyButton[] = [
  { id: 'esc', label: 'Esc', codes: ['Escape'] },
  { id: 'tab', label: '⇥', codes: ['Tab'] },
  { id: 'left', label: '←', codes: ['ArrowLeft'] },
  { id: 'up', label: '↑', codes: ['ArrowUp'] },
  { id: 'down', label: '↓', codes: ['ArrowDown'] },
  { id: 'right', label: '→', codes: ['ArrowRight'] },
  { id: 'del', label: 'Del', codes: ['Delete'] },
];

/** Back / Home / Recents etc. when the other side is a phone (its host maps these codes). */
export const PHONE_KEYS: {
  id: 'navBack' | 'navHome' | 'navRecents';
  label: string;
  code: string;
}[] = [
  { id: 'navBack', label: '◁', code: 'BrowserBack' },
  { id: 'navHome', label: '○', code: 'BrowserHome' },
  { id: 'navRecents', label: '▢', code: 'LaunchApp1' },
];

export const shortcutsFor = (host: RemotePlatform): Shortcut[] => {
  if (isPhone(host))
    return [
      { name: 'copy', codes: ['ControlLeft', 'KeyC'] },
      { name: 'paste', codes: ['ControlLeft', 'KeyV'] },
      { name: 'cut', codes: ['ControlLeft', 'KeyX'] },
      { name: 'selectAll', codes: ['ControlLeft', 'KeyA'] },
    ];
  const cmd = isMac(host) ? 'MetaLeft' : 'ControlLeft';
  const list: Shortcut[] = [
    { name: 'copy', codes: [cmd, 'KeyC'] },
    { name: 'paste', codes: [cmd, 'KeyV'] },
    { name: 'cut', codes: [cmd, 'KeyX'] },
    { name: 'undo', codes: [cmd, 'KeyZ'] },
    {
      name: 'redo',
      codes: isMac(host) ? [cmd, 'ShiftLeft', 'KeyZ'] : [cmd, 'KeyY'],
    },
    { name: 'selectAll', codes: [cmd, 'KeyA'] },
    { name: 'save', codes: [cmd, 'KeyS'] },
    { name: 'find', codes: [cmd, 'KeyF'] },
  ];
  if (isMac(host)) {
    list.push(
      { name: 'switchApp', codes: ['MetaLeft', 'Tab'] },
      { name: 'closeWindow', codes: ['MetaLeft', 'KeyW'] },
      { name: 'taskManager', codes: ['MetaLeft', 'AltLeft', 'Escape'] },
      { name: 'lock', codes: ['ControlLeft', 'MetaLeft', 'KeyQ'] },
      { name: 'spotlight', codes: ['MetaLeft', 'Space'] },
    );
  } else {
    list.push(
      { name: 'switchApp', codes: ['AltLeft', 'Tab'] },
      { name: 'closeWindow', codes: ['AltLeft', 'F4'] },
      { name: 'taskManager', codes: ['ControlLeft', 'ShiftLeft', 'Escape'] },
      { name: 'lock', codes: ['MetaLeft', 'KeyL'] },
      { name: 'desktop', codes: ['MetaLeft', 'KeyD'] },
      { name: 'start', codes: ['MetaLeft'] },
    );
  }
  return list;
};
