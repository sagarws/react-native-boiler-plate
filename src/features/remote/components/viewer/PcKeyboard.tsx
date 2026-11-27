import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { RemotePlatform } from '../../types';
import { isMac, type Modifier } from '../../utils/keys';

/*
 * A computer's special keys as one panel (like AnyDesk's key layout): Esc,
 * F1–F12, Tab, Enter, Backspace, Insert/Delete, Home/End, Page Up/Down, the
 * arrows, and the modifiers (sticky: tap Ctrl, then C = Ctrl+C). "abc" goes
 * back to the phone's own keyboard for typing text.
 */

type PcKey =
  | { kind: 'key'; label: string; code: string; wide?: number }
  | { kind: 'mod'; mod: Modifier; wide?: number }
  | { kind: 'abc' }
  | { kind: 'close' };

const k = (label: string, code: string, wide?: number): PcKey => ({
  kind: 'key',
  label,
  code,
  wide,
});

const ROWS: PcKey[][] = [
  [
    k('Esc', 'Escape'),
    k('F1', 'F1'),
    k('F2', 'F2'),
    k('F3', 'F3'),
    k('F4', 'F4'),
    k('F5', 'F5'),
    k('F6', 'F6'),
    k('⌫', 'Backspace'),
  ],
  [
    k('Tab ⇥', 'Tab'),
    k('F7', 'F7'),
    k('F8', 'F8'),
    k('F9', 'F9'),
    k('F10', 'F10'),
    k('F11', 'F11'),
    k('F12', 'F12'),
    k('Enter ⏎', 'Enter'),
  ],
  [
    { kind: 'mod', mod: 'ShiftLeft' },
    k('Ins', 'Insert'),
    k('Del', 'Delete'),
    k('Home', 'Home'),
    k('End', 'End'),
    k('PgUp', 'PageUp'),
    k('PgDn', 'PageDown'),
    k('PrtSc', 'PrintScreen'),
  ],
  [
    { kind: 'mod', mod: 'ControlLeft' },
    { kind: 'mod', mod: 'MetaLeft' },
    { kind: 'mod', mod: 'AltLeft' },
    k('←', 'ArrowLeft'),
    k('↑', 'ArrowUp'),
    k('↓', 'ArrowDown'),
    k('→', 'ArrowRight'),
    { kind: 'abc' },
  ],
  [k('Space', 'Space', 5), k('Enter ⏎', 'Enter', 2), { kind: 'close' }],
];

const modLabel = (m: Modifier, host: RemotePlatform): string => {
  if (m === 'ShiftLeft') return '⇧ Shift';
  if (m === 'ControlLeft') return isMac(host) ? '⌃ Ctrl' : 'Ctrl';
  if (m === 'AltLeft') return isMac(host) ? '⌥ Opt' : 'Alt';
  return isMac(host) ? '⌘ Cmd' : host === 'win32' ? '⊞ Win' : 'Super';
};

export interface PcKeyboardProps {
  host: RemotePlatform;
  mods: Modifier[];
  onToggleModifier: (m: Modifier) => void;
  onCombo: (codes: string[]) => void;
  /** Switch to the phone's keyboard for typing text. */
  onAbc: () => void;
  onClose: () => void;
}

export function PcKeyboard({
  host,
  mods,
  onToggleModifier,
  onCombo,
  onAbc,
  onClose,
}: PcKeyboardProps) {
  const { colors, typography, spacing, radius } = useTheme();

  const cell = (
    key: string,
    label: string,
    onPress: () => void,
    opts: { active?: boolean; wide?: number; accent?: boolean } = {},
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={
        opts.active === undefined ? undefined : { selected: opts.active }
      }
      style={({ pressed }) => [
        styles.key,
        {
          flex: opts.wide ?? 1,
          borderRadius: radius.sm,
          backgroundColor: opts.active
            ? colors.primary
            : pressed
            ? colors.surfaceMuted
            : opts.accent
            ? colors.surfaceMuted
            : colors.surface,
          borderColor: opts.active ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          typography.label,
          {
            color: opts.active ? colors.primaryForeground : colors.textPrimary,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ gap: spacing.xs }} testID="remote-pc-keyboard">
      {ROWS.map((row, r) => (
        <View key={r} style={[styles.row, { gap: spacing.xs }]}>
          {row.map((key, i) => {
            if (key.kind === 'key')
              return cell(`${r}-${i}`, key.label, () => onCombo([key.code]), {
                wide: key.wide,
              });
            if (key.kind === 'mod')
              return cell(
                key.mod,
                modLabel(key.mod, host),
                () => onToggleModifier(key.mod),
                { active: mods.includes(key.mod), wide: key.wide },
              );
            if (key.kind === 'abc')
              return cell('abc', 'abc', onAbc, { accent: true });
            return cell('close', '✕', onClose, { accent: true });
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  key: {
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 2,
  },
});
