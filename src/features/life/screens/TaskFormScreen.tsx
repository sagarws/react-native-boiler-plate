import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainStackParamList } from '@/navigation/types';
import {
  Button,
  Card,
  Header,
  Notice,
  SegmentedControl,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { FormField, SectionTitle } from '../components/form';
import { ColorPicker, DateField, IconPicker } from '../components/pickers';
import {
  lifeActions,
  useClock,
  useDescribeTarget,
  useLifeData,
} from '../hooks/useLife';
import { evaluate, nextPeriodStart, periodsBetween } from '../services/periods';
import { suggestTargets, type TargetSuggestion } from '../services/targetHelp';
import { validateTask, type TaskInput } from '../store/life.store';
import type { FrequencyType, Priority } from '../types';
import { addDays } from '../utils/dates';
import { formatDay, formatQty, parseAmount } from '../utils/format';

const UNITS = [
  'minutes',
  'hours',
  'pages',
  'steps',
  'km',
  'litres',
  'reps',
  'lessons',
  'items',
  'currency',
] as const;
type FreqChoice = 'daily' | 'weekly' | 'everyN' | 'custom';

const toFrequency = (c: FreqChoice): FrequencyType =>
  c === 'daily' ? 'daily' : c === 'weekly' ? 'weekly' : 'interval';

/** Create / edit a measurable task, with a clear target summary before saving. */
export default function TaskFormScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, radius, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'LifeTaskForm'>>();
  const { today } = useClock();
  const data = useLifeData();
  const describe = useDescribeTarget();
  const existing = params.taskId
    ? data.tasks.find(x => x.id === params.taskId)
    : undefined;
  const project = data.projects.find(
    p => p.id === (existing?.projectId ?? params.projectId),
  );
  const latest = existing?.targets[existing.targets.length - 1];
  const unitLabel = (u: string) =>
    UNITS.includes(u as (typeof UNITS)[number]) ? t(`life.unit_${u}`) : u;

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [unit, setUnit] = useState(existing?.unit ?? t('life.unit_minutes'));
  const [customUnit, setCustomUnit] = useState(
    existing && !UNITS.some(u => t(`life.unit_${u}`) === existing.unit)
      ? existing.unit
      : '',
  );
  const [quantity, setQuantity] = useState(
    latest ? String(latest.quantity) : '',
  );
  const [freq, setFreq] = useState<FreqChoice>(
    !latest
      ? 'daily'
      : latest.frequency !== 'interval'
      ? latest.frequency
      : latest.intervalDays <= 6
      ? 'everyN'
      : 'custom',
  );
  const [interval, setIntervalText] = useState(
    String(latest?.frequency === 'interval' ? latest.intervalDays : 2),
  );
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [endDate, setEndDate] = useState<string | null>(
    existing?.endDate ?? null,
  );
  const [priority, setPriority] = useState<Priority>(
    existing?.priority ?? 'medium',
  );
  const [color, setColor] = useState(
    existing?.color ?? project?.color ?? 'violet',
  );
  const [icon, setIcon] = useState(existing?.icon ?? 'circleCheck');
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [help, setHelp] = useState({
    goal: '',
    days: '',
    baseline: '',
    minutes: '',
  });
  const [suggestions, setSuggestions] = useState<TargetSuggestion[] | null>(
    null,
  );

  const finalUnit = customUnit.trim() || unit;
  const target = {
    quantity: parseAmount(quantity),
    frequency: toFrequency(freq),
    intervalDays:
      freq === 'daily'
        ? 1
        : freq === 'weekly'
        ? 7
        : Math.round(Number(interval)),
  };
  const input: TaskInput = {
    projectId: project?.id ?? '',
    name,
    description,
    icon,
    color,
    unit: finalUnit,
    target,
    startDate,
    endDate,
    priority,
    notes,
  };
  const problem = validateTask(input);

  const history = useMemo(() => {
    if (!existing) return [];
    const inp = { reports: data.reports, reviews: data.reviews, today };
    return periodsBetween(existing, addDays(today, -42), addDays(today, -1))
      .map(p => evaluate(existing, p, inp))
      .filter(
        s =>
          s.status === 'achieved' ||
          s.status === 'missed' ||
          s.status === 'report_required',
      )
      .map(s => ({ completed: s.completed, target: s.target.quantity }));
  }, [existing, data.reports, data.reviews, today]);

  const save = () => {
    if (problem) {
      setError(t(`life.error_${problem}`));
      return;
    }
    const result = existing
      ? lifeActions.updateTask(existing.id, input, today)
      : lifeActions.createTask(input);
    if (!result.ok) {
      setError(t(`life.error_${result.error}`));
      return;
    }
    navigation.goBack();
  };

  const suggest = () => {
    const n = (s: string) => (s.trim() ? parseAmount(s) : undefined);
    setSuggestions(
      suggestTargets({
        frequency: target.frequency,
        intervalDays: target.intervalDays,
        goalTotal: n(help.goal),
        daysToDeadline: n(help.days),
        baseline: n(help.baseline),
        minutesPerDay: n(help.minutes),
        unitIsMinutes: finalUnit === t('life.unit_minutes'),
        unitIsHours: finalUnit === t('life.unit_hours'),
        history,
      }),
    );
  };

  const use = (q: number) => {
    const apply = () => setQuantity(String(q));
    // Never overwrite a chosen target without asking.
    if (quantity.trim() && parseAmount(quantity) !== q) {
      Alert.alert(
        t('life.helpTitle'),
        t('life.helpConfirm', { quantity: formatQty(q) }),
        [
          { text: t('life.cancel'), style: 'cancel' },
          { text: t('life.accept'), onPress: apply },
        ],
      );
    } else apply();
  };

  const chip = (
    label: string,
    selected: boolean,
    onPress: () => void,
    testID: string,
  ) => (
    <Pressable
      key={testID}
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          backgroundColor: selected ? colors.primary : colors.surfaceMuted,
        },
      ]}
    >
      <Text
        style={[
          typography.label,
          { color: selected ? colors.primaryForeground : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header
        label={existing ? t('life.taskFormEdit') : t('life.taskFormNew')}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {project ? <Text style={caption}>{project.name}</Text> : null}
        <FormField
          label={t('life.name')}
          placeholder={t('life.taskNamePlaceholder')}
          value={name}
          onChangeText={setName}
          maxLength={80}
          testID="task-name"
        />

        <SectionTitle>{t('life.unit')}</SectionTitle>
        <View
          style={[styles.wrap, { gap: spacing.sm }]}
          accessibilityRole="radiogroup"
        >
          {UNITS.map(u =>
            chip(
              unitLabel(u),
              !customUnit.trim() && unit === t(`life.unit_${u}`),
              () => {
                setUnit(t(`life.unit_${u}`));
                setCustomUnit('');
              },
              `task-unit-${u}`,
            ),
          )}
        </View>
        <FormField
          label={t('life.customUnit')}
          placeholder={t('life.customUnitPlaceholder')}
          value={customUnit}
          onChangeText={setCustomUnit}
          maxLength={30}
          testID="task-custom-unit"
        />

        <FormField
          label={t('life.targetQuantity')}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          testID="task-quantity"
        />
        <SectionTitle>{t('life.frequency')}</SectionTitle>
        <SegmentedControl
          accessibilityLabel={t('life.frequency')}
          value={freq}
          onChange={(f: FreqChoice) => {
            setFreq(f);
            if (f === 'everyN' && Number(interval) > 6) setIntervalText('2');
            if (f === 'custom' && Number(interval) <= 6) setIntervalText('14');
          }}
          options={[
            { value: 'daily' as const, label: t('life.freq_daily') },
            { value: 'weekly' as const, label: t('life.freq_weekly') },
            { value: 'everyN' as const, label: t('life.freq_everyN') },
            { value: 'custom' as const, label: t('life.freq_custom') },
          ]}
          testID="task-frequency"
        />
        {freq === 'everyN' || freq === 'custom' ? (
          <FormField
            label={t('life.intervalDays')}
            value={interval}
            onChangeText={setIntervalText}
            keyboardType="number-pad"
            testID="task-interval"
          />
        ) : null}

        <Card>
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {t('life.summary')}
          </Text>
          <Text
            style={[typography.title, { color: colors.primaryText }]}
            testID="task-summary"
          >
            {target.quantity > 0 && target.intervalDays >= 1
              ? describe(target, finalUnit)
              : t('life.noValue')}
          </Text>
          {existing ? (
            <Text style={caption}>
              {t('life.targetChangeNote', {
                date: formatDay(nextPeriodStart(existing, today)),
              })}
            </Text>
          ) : null}
        </Card>

        <Button
          variant="soft"
          iconName="sparkles"
          label={t('life.helpTarget')}
          onPress={() => setHelpOpen(v => !v)}
          testID="task-help"
        />
        {helpOpen ? (
          <Card testID="task-help-panel">
            <Text style={caption}>{t('life.helpIntro')}</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <FormField
                label={t('life.helpGoal', { unit: finalUnit })}
                value={help.goal}
                onChangeText={goal => setHelp(h => ({ ...h, goal }))}
                keyboardType="decimal-pad"
                testID="help-goal"
              />
              <FormField
                label={t('life.helpDeadline')}
                value={help.days}
                onChangeText={days => setHelp(h => ({ ...h, days }))}
                keyboardType="number-pad"
                testID="help-days"
              />
              <FormField
                label={t('life.helpBaseline')}
                value={help.baseline}
                onChangeText={baseline => setHelp(h => ({ ...h, baseline }))}
                keyboardType="decimal-pad"
              />
              <FormField
                label={t('life.helpTime')}
                value={help.minutes}
                onChangeText={minutes => setHelp(h => ({ ...h, minutes }))}
                keyboardType="number-pad"
              />
              <Button
                size="sm"
                label={t('life.helpSuggest')}
                onPress={suggest}
                testID="help-suggest"
              />
              {suggestions && !suggestions.length ? (
                <Text style={caption}>{t('life.helpNone')}</Text>
              ) : null}
              {suggestions?.map(s => (
                <View
                  key={`${s.basis}-${s.quantity}`}
                  style={[styles.row, { gap: spacing.sm }]}
                  testID={`help-suggestion-${s.basis}`}
                >
                  <View style={styles.flex}>
                    <Text
                      style={[typography.label, { color: colors.textPrimary }]}
                    >
                      {t('life.suggestionLabel')}:{' '}
                      {describe({ ...target, quantity: s.quantity }, finalUnit)}
                    </Text>
                    <Text style={caption}>
                      {t(`life.helpBasis_${s.basis}`, s.detail)}
                    </Text>
                  </View>
                  <Button
                    size="sm"
                    variant="secondary"
                    label={t('life.helpUse', {
                      quantity: formatQty(s.quantity),
                    })}
                    onPress={() => use(s.quantity)}
                  />
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <DateField
          label={t('life.startDate')}
          value={startDate}
          onChange={d => d && setStartDate(d)}
          today={today}
          testID="task-start"
        />
        <DateField
          label={t('life.endDate')}
          value={endDate}
          onChange={setEndDate}
          today={today}
          min={startDate}
          allowClear
          emptyLabel={t('life.noEndDate')}
          testID="task-end"
        />
        <SegmentedControl
          accessibilityLabel={t('life.priority')}
          value={priority}
          onChange={setPriority}
          options={(['high', 'medium', 'low'] as const).map(p => ({
            value: p,
            label: t(`life.priority_${p}`),
          }))}
          testID="task-priority"
        />
        <SectionTitle>{t('life.color')}</SectionTitle>
        <ColorPicker value={color} onChange={setColor} testID="task-color" />
        <SectionTitle>{t('life.icon')}</SectionTitle>
        <IconPicker
          value={icon}
          color={color}
          onChange={setIcon}
          testID="task-icon"
        />
        <FormField
          label={t('life.description')}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={500}
        />
        <FormField
          label={t('life.notes')}
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={500}
        />

        {error ? (
          <Notice tone="error" message={error} testID="task-error" />
        ) : null}
        <Button
          label={existing ? t('life.save') : t('life.create')}
          iconName="check"
          onPress={save}
          testID="task-save"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  chip: { minHeight: 36, justifyContent: 'center' },
});
