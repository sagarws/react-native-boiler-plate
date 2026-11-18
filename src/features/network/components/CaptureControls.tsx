import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/components';
import { useTheme } from '@/theme';
import type { CaptureSession } from '../types';

export interface CaptureControlsProps {
  session: CaptureSession;
  disabled: boolean;
  onChange: (session: CaptureSession) => void;
  size?: 'sm' | 'md';
  testID?: string;
}

/** Start / Pause / Resume / Stop for the capture session. */
export function CaptureControls({
  session,
  disabled,
  onChange,
  size = 'md',
  testID = 'net-controls',
}: CaptureControlsProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <View style={[styles.row, { gap: spacing.sm }]} testID={testID}>
      {session === 'stopped' ? (
        <Button
          label={t('network.hub.start')}
          iconName="play"
          size={size}
          disabled={disabled}
          onPress={() => onChange('recording')}
          style={styles.flex}
          testID={`${testID}-start`}
        />
      ) : session === 'recording' ? (
        <Button
          label={t('network.hub.pause')}
          iconName="pause"
          variant="soft"
          size={size}
          disabled={disabled}
          onPress={() => onChange('paused')}
          style={styles.flex}
          testID={`${testID}-pause`}
        />
      ) : (
        <Button
          label={t('network.hub.resume')}
          iconName="play"
          size={size}
          disabled={disabled}
          onPress={() => onChange('recording')}
          style={styles.flex}
          testID={`${testID}-resume`}
        />
      )}
      {session !== 'stopped' ? (
        <Button
          label={t('network.hub.stop')}
          iconName="square"
          variant="secondary"
          size={size}
          disabled={disabled}
          onPress={() => onChange('stopped')}
          style={styles.flex}
          testID={`${testID}-stop`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
});
