import { useCallback, useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { textEvents } from '../core/input';
import type { InputEvent } from '../types';
import { keyForChar, type Modifier } from '../utils/keys';

/*
 * The phone's soft keyboard as the remote keyboard. A hidden TextInput keeps
 * a fixed sentinel value: every change is diffed against it (characters added
 * = typed, characters gone = Backspace) and the value is put back, so
 * suggestions and auto-correct never get between the keys and the remote.
 * Sticky modifiers (Ctrl, Alt, Shift, ⌘/Win) apply to the next key or
 * character, then release.
 */

export const SENTINEL = '••';

/** Old field text → new: how many characters were deleted from the end, and what was typed. */
export function textDiff(
  prev: string,
  next: string,
): { removed: number; added: string } {
  let common = 0;
  while (
    common < prev.length &&
    common < next.length &&
    prev[common] === next[common]
  )
    common++;
  return { removed: prev.length - common, added: next.slice(common) };
}

export function useRemoteKeyboard(
  sendInput: (event: InputEvent) => void,
  /** Send every character as a real key press (a locked Mac ignores text events). */
  keysOnly = false,
) {
  const keysOnlyRef = useRef(keysOnly);
  keysOnlyRef.current = keysOnly;
  const inputRef = useRef<TextInput>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(SENTINEL);
  const [mods, setMods] = useState<Modifier[]>([]);
  const modsRef = useRef<Modifier[]>([]);
  modsRef.current = mods;

  const tap = useCallback(
    (code: string) => {
      sendInput({ k: 'kd', c: code });
      sendInput({ k: 'ku', c: code });
    },
    [sendInput],
  );

  /** Press `codes` together (modifiers first), then release in reverse. */
  const combo = useCallback(
    (codes: string[]) => {
      const all = [
        ...modsRef.current.filter(m => !codes.includes(m)),
        ...codes,
      ];
      for (const c of all) sendInput({ k: 'kd', c });
      for (const c of [...all].reverse()) sendInput({ k: 'ku', c });
      if (modsRef.current.length) setMods([]);
    },
    [sendInput],
  );

  const typeChars = useCallback(
    (text: string) => {
      if (!text) return;
      if (modsRef.current.length || keysOnlyRef.current) {
        // With Ctrl/Alt/⌘ held, characters are keys (Ctrl+C, not "c"). On a
        // lock screen too: macOS ignores typed-text events there.
        for (const ch of Array.from(text)) {
          const key = keyForChar(ch);
          if (key) combo(key.shift ? ['ShiftLeft', key.code] : [key.code]);
        }
        return;
      }
      const parts = text.split('\n');
      parts.forEach((part, i) => {
        for (const event of textEvents(part)) sendInput(event);
        if (i < parts.length - 1) tap('Enter');
      });
    },
    [combo, sendInput, tap],
  );

  // What the hidden field holds right now. Every change is diffed against
  // this (not against SENTINEL): putting SENTINEL back is a state change React
  // may skip when it already equals the old state, and then the native text
  // keeps the typed characters — the next key re-sent them ("ab" typed twice).
  const lastRef = useRef(SENTINEL);

  const onChangeText = useCallback(
    (next: string) => {
      const prev = lastRef.current;
      if (next === prev) return;
      const { removed, added } = textDiff(prev, next);
      for (let i = 0; i < removed; i++) combo(['Backspace']);
      typeChars(added.replace(/•/g, ''));
      // Back to the sentinel when it runs low (Backspace needs something to
      // delete) or grows long; otherwise mirror the field exactly.
      const reset = next.length < SENTINEL.length || next.length > 24;
      lastRef.current = reset ? SENTINEL : next;
      setValue(reset ? SENTINEL : next);
    },
    [combo, typeChars],
  );

  const onSubmit = useCallback(() => combo(['Enter']), [combo]);

  const toggleModifier = useCallback((m: Modifier) => {
    setMods(current =>
      current.includes(m) ? current.filter(x => x !== m) : [...current, m],
    );
  }, []);

  const show = useCallback(() => {
    lastRef.current = SENTINEL;
    setValue(SENTINEL);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const hide = useCallback(() => {
    inputRef.current?.blur();
    setOpen(false);
  }, []);

  return {
    inputRef,
    open,
    setOpen,
    value,
    onChangeText,
    onSubmit,
    mods,
    toggleModifier,
    combo,
    show,
    hide,
    toggle: () => (open ? hide() : show()),
  };
}
