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

export function useRemoteKeyboard(sendInput: (event: InputEvent) => void) {
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
      if (modsRef.current.length) {
        // With Ctrl/Alt/⌘ held, characters are keys (Ctrl+C, not "c").
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

  const onChangeText = useCallback(
    (next: string) => {
      if (next.length < SENTINEL.length && SENTINEL.startsWith(next)) {
        for (let i = next.length; i < SENTINEL.length; i++)
          combo(['Backspace']);
      } else if (next.startsWith(SENTINEL)) {
        typeChars(next.slice(SENTINEL.length));
      } else {
        // The keyboard replaced the text (e.g. a suggestion): type what is new.
        typeChars(next.replace(/•/g, ''));
      }
      setValue(SENTINEL);
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
