import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import type { RemotePlatform } from '../../types';
import {
  FUNCTION_KEYS,
  MODIFIERS,
  NAV_KEYS,
  PHONE_KEYS,
  isPhone,
  modifierLabel,
  shortcutsFor,
  type Modifier,
} from '../../utils/keys';
import { KeyChip } from './KeyChip';
import { Sheet } from './Sheet';

export interface KeysSheetProps {
  visible: boolean;
  onClose: () => void;
  host: RemotePlatform;
  mods: Modifier[];
  onToggleModifier: (m: Modifier) => void;
  onCombo: (codes: string[]) => void;
  /** Windows lock screen: Ctrl+Alt+Del through the host's agent. */
  locked: boolean;
  onCtrlAltDel: () => void;
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.overline, { color: colors.textSecondary }]}>
        {title}
      </Text>
      <View style={[styles.wrap, { gap: spacing.sm }]}>{children}</View>
    </View>
  );
}

/** Keys a phone keyboard lacks, and the shortcuts people need most — for the host's OS. */
export function KeysSheet({
  visible,
  onClose,
  host,
  mods,
  onToggleModifier,
  onCombo,
  locked,
  onCtrlAltDel,
}: KeysSheetProps) {
  const { t } = useTranslation();
  const press = (codes: string[]) => () => onCombo(codes);
  const phone = isPhone(host);
  return (
    <Sheet
      visible={visible}
      title={t('remote.keys.title')}
      onClose={onClose}
      testID="remote-keys-sheet"
    >
      {phone ? (
        <Group title={t('remote.keys.navigation')}>
          {PHONE_KEYS.map(k => (
            <KeyChip
              key={k.id}
              label={`${k.label} ${t(`remote.viewer.${k.id}`)}`}
              onPress={press([k.code])}
            />
          ))}
        </Group>
      ) : (
        <Group title={t('remote.keys.modifiers')}>
          {MODIFIERS.map(m => (
            <KeyChip
              key={m}
              label={modifierLabel(m, host)}
              active={mods.includes(m)}
              onPress={() => onToggleModifier(m)}
            />
          ))}
        </Group>
      )}
      <Group title={t('remote.keys.shortcuts')}>
        {shortcutsFor(host).map(s => (
          <KeyChip
            key={s.name}
            label={t(`remote.keys.${s.name}`)}
            onPress={press(s.codes)}
          />
        ))}
        {!phone ? (
          <KeyChip
            label={t('remote.viewer.ctrlAltDel')}
            onPress={
              locked
                ? onCtrlAltDel
                : press(['ControlLeft', 'AltLeft', 'Delete'])
            }
          />
        ) : null}
      </Group>
      <Group title={t('remote.keys.system')}>
        {NAV_KEYS.map(k => (
          <KeyChip
            key={k.id}
            label={k.label}
            compact
            onPress={press(k.codes)}
          />
        ))}
      </Group>
      {!phone ? (
        <Group title={t('remote.keys.function')}>
          {FUNCTION_KEYS.map(k => (
            <KeyChip
              key={k.id}
              label={k.label}
              compact
              onPress={press(k.codes)}
            />
          ))}
        </Group>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
