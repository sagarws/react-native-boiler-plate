import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDay } from '@/features/life';
import {
  Button,
  Card,
  EmptyState,
  Header,
  Icon,
  Loader,
  Notice,
  SegmentedControl,
} from '@/shared/components';
import { toDayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';
import { useUtilityData } from '../hooks/useUtility';
import { ensureCamera, openAppSettings } from '../services/camera';
import {
  utilityNative,
  UtilityError,
  type ArSupport,
  type MeasureResult,
} from '../services/native.service';
import { formatLength } from '../services/units';
import { utilityStore } from '../store/utility.store';
import { MEASURE_MODES, UNITS, type MeasureMode } from '../types';

type Problem =
  | 'denied'
  | 'blocked'
  | 'ar_unsupported'
  | 'ar_install_declined'
  | 'ar_failed'
  | null;

/**
 * AR Measure (ARCore): length between two points, height (vertical
 * difference) and distance to a surface. Works only where ARCore runs; on
 * other phones it says so instead of guessing from the camera image.
 */
export default function MeasureScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const { prefs, measurements } = useUtilityData();
  const [support, setSupport] = useState<ArSupport | null>(null);
  const [mode, setMode] = useState<MeasureMode>('length');
  const [problem, setProblem] = useState<Problem>(null);
  const [last, setLast] = useState<MeasureResult | null>(null);
  const [busy, setBusy] = useState(false);

  const checkSupport = useCallback(() => {
    setSupport(null);
    utilityNative.arSupport().then(setSupport, () => setSupport('unknown'));
  }, []);
  useEffect(checkSupport, [checkSupport]);

  const start = async () => {
    if (busy) return;
    setProblem(null);
    const access = await ensureCamera();
    if (access !== 'granted') {
      setProblem(access === 'blocked' ? 'blocked' : 'denied');
      return;
    }
    setBusy(true);
    try {
      const keys = [
        'close',
        'reset',
        'addPoint',
        'capture',
        'save',
        'initializing',
        'lowLight',
        'tooFast',
        'fewFeatures',
        'cameraUnavailable',
        'lostPoints',
        'doneHint',
        'aimSurface',
        'captureHint',
        'firstPoint',
        'secondPoint',
        'secondPointHeight',
      ];
      const labels: Record<string, string> = Object.fromEntries(
        keys.map(k => [k, t(`utility.ar_${k}`)]),
      );
      labels.close = t('common.close');
      MEASURE_MODES.forEach(
        m => (labels[`mode_${m}`] = t(`utility.measure_${m}`)),
      );
      const result = await utilityNative.measure(mode, prefs.unit, labels);
      if (result && result.meters > 0) setLast(result);
    } catch (error) {
      const code = error instanceof UtilityError ? error.code : 'ar_failed';
      setProblem(
        code === 'camera_permission'
          ? 'denied'
          : code === 'ar_unsupported' || code === 'unavailable'
          ? 'ar_unsupported'
          : code === 'ar_install_declined'
          ? 'ar_install_declined'
          : 'ar_failed',
      );
      if (code === 'ar_unsupported') setSupport('unsupported');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!last) return;
    utilityStore.saveMeasurement({
      mode: last.mode,
      meters: last.meters,
      source: last.source,
    });
    setLast(null);
  };

  const unsupported = support === 'unsupported';

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_measure')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {support === null ? (
          <Loader />
        ) : unsupported ? (
          <EmptyState
            icon="ruler"
            title={t('utility.arUnsupportedTitle')}
            message={t('utility.arUnsupportedBody')}
            testID="measure-unsupported"
          />
        ) : (
          <>
            {support === 'install_required' ? (
              <Notice tone="info" message={t('utility.arInstallNote')} />
            ) : support === 'unknown' ? (
              <Notice
                tone="info"
                message={t('utility.arUnknown')}
                action={{ label: t('utility.tryAgain'), onPress: checkSupport }}
              />
            ) : null}
            {problem ? (
              <Notice
                tone="error"
                message={t(`utility.measureProblem_${problem}`)}
                action={
                  problem === 'blocked'
                    ? {
                        label: t('utility.openSettings'),
                        onPress: openAppSettings,
                      }
                    : undefined
                }
                onDismiss={() => setProblem(null)}
                testID="measure-problem"
              />
            ) : null}
            <Card>
              <View style={{ gap: spacing.sm }}>
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {t('utility.measureIntro')}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('utility.measureAccuracy')}
                </Text>
              </View>
            </Card>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('utility.measureMode')}
            </Text>
            <SegmentedControl
              options={MEASURE_MODES.map(m => ({
                value: m,
                label: t(`utility.measure_${m}`),
              }))}
              value={mode}
              onChange={setMode}
              accessibilityLabel={t('utility.measureMode')}
              testID="measure-mode"
            />
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t(`utility.measureHint_${mode}`)}
            </Text>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('utility.unit')}
            </Text>
            <SegmentedControl
              options={UNITS.map(u => ({
                value: u,
                label: t(`utility.unit_${u}`),
              }))}
              value={prefs.unit}
              onChange={unit => utilityStore.updatePrefs({ unit })}
              accessibilityLabel={t('utility.unit')}
              testID="measure-unit"
            />
            {last ? (
              <Card testID="measure-result">
                <View style={{ gap: spacing.sm }}>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {t(`utility.measure_${last.mode}`)}
                  </Text>
                  <Text style={[typography.h1, { color: colors.textPrimary }]}>
                    {formatLength(last.meters, prefs.unit)}
                  </Text>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {t(`utility.source_${last.source || 'plane'}`)}
                  </Text>
                  <View style={[styles.row, { gap: spacing.sm }]}>
                    <Button
                      size="sm"
                      label={t('utility.saveMeasurement')}
                      onPress={save}
                      testID="measure-save"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      label={t('utility.discard')}
                      onPress={() => setLast(null)}
                    />
                  </View>
                </View>
              </Card>
            ) : null}
            <Button
              label={t('utility.startMeasuring')}
              iconName="ruler"
              onPress={() => {
                void start();
              }}
              loading={busy}
              testID="measure-start"
            />
          </>
        )}

        <Text
          style={[
            typography.title,
            { color: colors.textPrimary, marginTop: spacing.md },
          ]}
        >
          {t('utility.savedMeasurements')}
        </Text>
        {measurements.length ? (
          measurements.map(m => (
            <View
              key={m.id}
              style={[
                styles.row,
                {
                  gap: spacing.sm,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceMuted,
                },
              ]}
            >
              <Icon name="ruler" size={18} color={colors.textSecondary} />
              <View style={styles.flex}>
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {formatLength(m.meters, prefs.unit)} ·{' '}
                  {t(`utility.measure_${m.mode}`)}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {formatDay(toDayKey(new Date(m.at)))}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  Alert.alert(t('utility.deleteMeasurementTitle'), undefined, [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('utility.delete'),
                      style: 'destructive',
                      onPress: () => utilityStore.deleteMeasurement(m.id),
                    },
                  ])
                }
                accessibilityRole="button"
                accessibilityLabel={t('utility.delete')}
                hitSlop={8}
              >
                <Icon name="trash2" size={18} color={colors.error} />
              </Pressable>
            </View>
          ))
        ) : (
          <EmptyState
            compact
            icon="ruler"
            title={t('utility.noMeasurements')}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
