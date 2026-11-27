import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { toParamArray } from '../dsp/params';
import { useStudio } from '../hooks/useAudioStudio';
import {
  EMPTY_SYSTEM,
  systemAudio,
  type CaptureStart,
  type SystemStatus,
} from '../services/systemAudio.service';
import { Chip, ChipRow, Section } from './ui';

/**
 * Other apps (Mode B): Android's effects on players that announce their
 * session, and experimental capture → 8D → playback. Both are shown with
 * what they can and cannot do; nothing here claims an app works until the
 * status proves sound is actually flowing.
 */
export function SystemAudioPanel() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const studio = useStudio();
  const [status, setStatus] = useState<SystemStatus>(EMPTY_SYSTEM);
  const [startResult, setStartResult] = useState<CaptureStart | null>(null);

  useEffect(() => {
    let live = true;
    systemAudio.status().then(s => live && setStatus(s));
    const off = systemAudio.onStatus(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);

  // Keep system effects in step with the studio's sound.
  useEffect(() => {
    if (status.effectsEnabled)
      systemAudio.setEffectParams(toParamArray(studio.settings));
  }, [studio.settings, status.effectsEnabled]);

  const c = status.capture;
  const supported = Object.entries(status.effectsSupported)
    .filter(([, v]) => v)
    .map(([k]) => t(`audioStudio.system.effects.${k}`));
  const noInput = c.running && c.silentMs > 4000;

  if (!systemAudio.available)
    return (
      <Section title={t('audioStudio.system.title')}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('audioStudio.system.unavailable')}
        </Text>
      </Section>
    );

  return (
    <View style={{ gap: spacing.lg }}>
      <Notice tone="info" message={t('audioStudio.system.intro')} />

      <Section
        title={t('audioStudio.system.effectsTitle')}
        right={
          <Switch
            value={status.effectsEnabled}
            onValueChange={on => {
              systemAudio.setEffectsEnabled(on);
              if (on)
                systemAudio.setEffectParams(toParamArray(studio.settings));
            }}
            trackColor={{ false: colors.disabled, true: colors.primary }}
            thumbColor={colors.surface}
            accessibilityLabel={t('audioStudio.system.effectsTitle')}
            testID="system-effects"
          />
        }
      >
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('audioStudio.system.effectsBody')}
        </Text>
        {supported.length ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('audioStudio.system.supported', { list: supported.join(', ') })}
          </Text>
        ) : null}
        {status.sessions.length ? (
          status.sessions.map(s => (
            <View key={s.sessionId} style={[styles.row, { gap: spacing.sm }]}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: s.attached
                      ? colors.success
                      : colors.textSecondary,
                  },
                ]}
              />
              <Text
                style={[
                  typography.body,
                  styles.flex,
                  { color: colors.textPrimary },
                ]}
              >
                {s.appLabel || s.packageName}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {s.attached
                  ? t('audioStudio.system.attached')
                  : t('audioStudio.system.detected')}
              </Text>
            </View>
          ))
        ) : (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('audioStudio.system.noSessions')}
          </Text>
        )}
      </Section>

      <Section title={t('audioStudio.system.captureTitle')}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('audioStudio.system.captureBody')}
        </Text>
        {!c.supported ? (
          <Notice
            tone="warning"
            message={t('audioStudio.system.captureUnsupported')}
          />
        ) : (
          <>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('audioStudio.system.outputTitle')}
            </Text>
            <ChipRow>
              {(['media', 'accessibility'] as const).map(m => (
                <Chip
                  key={m}
                  label={t(`audioStudio.system.output.${m}`)}
                  active={c.outputMode === m}
                  onPress={() => systemAudio.setCaptureOutput(m)}
                  testID={`system-output-${m}`}
                />
              ))}
            </ChipRow>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t(`audioStudio.system.outputHint.${c.outputMode}`)}
            </Text>
            {c.running ? (
              <Button
                label={t('audioStudio.system.stop')}
                iconName="square"
                variant="secondary"
                onPress={systemAudio.stopCapture}
                testID="system-capture-stop"
              />
            ) : (
              <Button
                label={t('audioStudio.system.start')}
                iconName="play"
                onPress={async () =>
                  setStartResult(await systemAudio.startCapture())
                }
                testID="system-capture-start"
              />
            )}
            {startResult && startResult !== 'ok' && !c.running ? (
              <Notice
                tone="error"
                message={t(`audioStudio.system.startErrors.${startResult}`)}
              />
            ) : null}
            {c.running ? (
              <View style={{ gap: spacing.xs }}>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('audioStudio.system.levels', {
                    input: Math.max(-99, Math.round(c.inputDb)),
                    output: Math.max(-99, Math.round(c.outputDb)),
                    latency: Math.round(c.latencyMs),
                  })}
                </Text>
                {noInput ? (
                  <Notice
                    tone="warning"
                    message={t('audioStudio.system.silent')}
                  />
                ) : (
                  <Notice
                    tone="success"
                    message={t('audioStudio.system.flowing')}
                  />
                )}
              </View>
            ) : null}
            {c.error ? (
              <Notice
                tone="error"
                message={t(`audioStudio.system.errors.${c.error}`, {
                  defaultValue: t('audioStudio.system.errors.failed'),
                })}
              />
            ) : null}
          </>
        )}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
