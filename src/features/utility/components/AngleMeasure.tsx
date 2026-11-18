import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/features/life';
import { Button, Card, ChoiceList, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { ensureCamera, openAppSettings } from '../services/camera';
import {
  utilityNative,
  UtilityError,
  type SightCapture,
} from '../services/native.service';
import {
  KNOWN_INPUT,
  RESULT_MODE,
  STEPS,
  TRIG_METHODS,
  solveTrig,
  type TrigError,
  type TrigMethod,
  type TrigResult,
} from '../services/trig';
import { formatLength, fromMeters, toMeters } from '../services/units';
import { utilityStore } from '../store/utility.store';
import { parseNumber } from '../services/convert';
import type { LengthUnit, UtilityPrefs } from '../types';

type Problem =
  | 'denied'
  | 'blocked'
  | 'no_sensor'
  | 'camera_failed'
  | 'failed'
  | TrigError
  | null;

const ICONS = {
  heightFromDistance: 'arrowUp',
  heightFromDeviceHeight: 'arrowUp',
  distanceFromDeviceHeight: 'move',
  floorLength: 'ruler',
} as const;

const fmtAngle = (a: number) => `${a > 0 ? '+' : ''}${a.toFixed(1)}°`;

/**
 * Angle (trigonometric) measuring: the user gives one known length — the
 * distance to the object, or the phone's height above the floor — then
 * aims the camera's crosshair at points; tilt angles + trigonometry give
 * the result. Works without ARCore.
 */
export function AngleMeasure({
  unit,
  prefs,
}: {
  unit: LengthUnit;
  prefs: UtilityPrefs;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [method, setMethod] = useState<TrigMethod>('heightFromDistance');
  const known = KNOWN_INPUT[method];
  const [texts, setTexts] = useState<
    Record<'distance' | 'deviceHeight', string>
  >(() => ({
    distance: prefs.sightDistance
      ? String(fromMeters(prefs.sightDistance, unit))
      : '',
    deviceHeight: prefs.sightDeviceHeight
      ? String(fromMeters(prefs.sightDeviceHeight, unit))
      : '',
  }));
  const [shownUnit, setShownUnit] = useState(unit);
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    method: TrigMethod;
    sights: SightCapture[];
    known: number;
    value: Extract<TrigResult, { ok: true }>;
  } | null>(null);

  // The unit changed: show the saved lengths in the new unit.
  if (shownUnit !== unit) {
    setShownUnit(unit);
    setTexts({
      distance: prefs.sightDistance
        ? String(fromMeters(prefs.sightDistance, unit))
        : '',
      deviceHeight: prefs.sightDeviceHeight
        ? String(fromMeters(prefs.sightDeviceHeight, unit))
        : '',
    });
  }

  const typed = parseNumber(texts[known]);
  const knownMeters = Number.isFinite(typed) ? toMeters(typed, unit) : NaN;
  const knownValid = knownMeters > 0 && knownMeters <= 10_000;

  const start = async () => {
    if (busy) return;
    setProblem(null);
    if (!knownValid) {
      setProblem('known_invalid');
      return;
    }
    utilityStore.updatePrefs(
      known === 'distance'
        ? { sightDistance: knownMeters }
        : { sightDeviceHeight: knownMeters },
    );
    const access = await ensureCamera();
    if (access !== 'granted') {
      setProblem(access === 'blocked' ? 'blocked' : 'denied');
      return;
    }
    setBusy(true);
    try {
      const steps = STEPS[method].map((step, i, all) =>
        t('utility.sightStep', {
          n: i + 1,
          total: all.length,
          text: t(`utility.sight_${step}`),
        }),
      );
      const sights = await utilityNative.sightAngles({
        steps,
        title: t(`utility.trig_${method}`),
        close: t('common.close'),
        capture: t('utility.sightCapture'),
        back: t('utility.sightBack'),
        steady: t('utility.sightSteady'),
        holdSteady: t('utility.sightHoldSteady'),
      });
      if (!sights) return;
      const value = solveTrig(method, knownMeters, sights);
      if (!value.ok) {
        setProblem(value.error);
        return;
      }
      setResult({ method, sights, known: knownMeters, value });
    } catch (error) {
      const code = error instanceof UtilityError ? error.code : 'failed';
      setProblem(
        code === 'camera_permission'
          ? 'denied'
          : code === 'no_sensor'
          ? 'no_sensor'
          : code === 'camera_failed'
          ? 'camera_failed'
          : 'failed',
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!result) return;
    utilityStore.saveMeasurement({
      mode: RESULT_MODE[result.method],
      meters: result.value.meters,
      source: 'angle',
      label: t(`utility.trig_${result.method}`),
    });
    setResult(null);
  };

  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {t('utility.angleIntro')}
          </Text>
          <Text style={caption}>{t('utility.angleAccuracy')}</Text>
        </View>
      </Card>
      <ChoiceList
        choices={TRIG_METHODS.map(m => ({
          value: m,
          title: t(`utility.trig_${m}`),
          description: t(`utility.trigDesc_${m}`),
          icon: ICONS[m],
        }))}
        value={method}
        onChange={m => {
          setMethod(m);
          setProblem(null);
        }}
        accessibilityLabel={t('utility.angleWhat')}
        testID="trig-method"
      />
      <FormField
        label={t(`utility.known_${known}`, { unit: t(`utility.unit_${unit}`) })}
        hint={t(`utility.knownHint_${known}`)}
        value={texts[known]}
        onChangeText={v => {
          setTexts(cur => ({ ...cur, [known]: v }));
          if (problem === 'known_invalid') setProblem(null);
        }}
        keyboardType="decimal-pad"
        maxLength={10}
        testID="trig-known"
      />
      <Text style={caption} testID="trig-formula">
        {t(`utility.trigFormula_${method}`)}
      </Text>
      {problem ? (
        <Notice
          tone="error"
          message={t(`utility.angleProblem_${problem}`)}
          action={
            problem === 'blocked'
              ? { label: t('utility.openSettings'), onPress: openAppSettings }
              : undefined
          }
          onDismiss={() => setProblem(null)}
          testID="trig-problem"
        />
      ) : null}
      {result ? (
        <Card testID="trig-result">
          <View style={{ gap: spacing.xs }}>
            <Text style={caption}>{t(`utility.trig_${result.method}`)}</Text>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>
              {formatLength(result.value.meters, unit)}
            </Text>
            <Text style={caption} testID="trig-uncertainty">
              {t('utility.trigUncertainty', {
                value: formatLength(result.value.uncertainty, unit),
              })}
            </Text>
            {STEPS[result.method].map((step, i) => (
              <Text key={step} style={caption}>
                {t(`utility.sightShort_${step}`)}:{' '}
                {fmtAngle(result.sights[i].elevation)}
              </Text>
            ))}
            {result.method !== 'heightFromDistance'
              ? result.value.distances.map((d, i) => (
                  <Text key={i} style={caption}>
                    {t('utility.trigDistanceN', {
                      n: result.value.distances.length > 1 ? i + 1 : '',
                      value: formatLength(d, unit),
                    })}
                  </Text>
                ))
              : null}
            {result.value.lowAngle ? (
              <Notice tone="warning" message={t('utility.trigLowAngle')} />
            ) : null}
            {result.value.assumedInLine ? (
              <Notice tone="info" message={t('utility.trigInLine')} />
            ) : null}
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Button
                size="sm"
                label={t('utility.saveMeasurement')}
                onPress={save}
                testID="trig-save"
              />
              <Button
                size="sm"
                variant="ghost"
                label={t('utility.discard')}
                onPress={() => setResult(null)}
              />
            </View>
          </View>
        </Card>
      ) : null}
      <Button
        label={t('utility.startAiming')}
        iconName="crosshair"
        onPress={() => {
          void start();
        }}
        loading={busy}
        testID="trig-start"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
});
