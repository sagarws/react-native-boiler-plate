import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import { Button, Header, Notice, ToggleSwitch } from '@/shared/components';
import { pickPicture } from '@/shared/utils/pickFile';
import { useTheme } from '@/theme';
import { FormField, SectionTitle } from '../../components/form';
import { ColorPicker, DateField, IconPicker } from '../../components/pickers';
import { useClock } from '../../hooks/useLife';
import { formatDate } from '../services/plannerFormat';
import { Chips } from '../components/Chips';
import { plannerActions, usePlannerData } from '../hooks/usePlanner';
import {
  TEMPLATE_KEYS,
  templateNodes,
  type TemplateKey,
} from '../services/plannerQueries';
import type { PlannerError, ProjectInput } from '../store/planner.store';
import type { OptionalMode, Priority, ProgressModel } from '../types';

const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low'];

/**
 * Create / edit a long-term project. Required: name, start, target date
 * (may be marked as an estimate), colour. Target-date changes are kept in
 * the project's deadline history. New projects can start from a template;
 * after creating, the mind map opens.
 */
export default function PlannerProjectFormScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'PlannerProjectForm'>>();
  const data = usePlannerData();
  const { today } = useClock();
  const existing = params?.projectId
    ? data.projects.find(p => p.id === params.projectId)
    : undefined;
  const year = Number(today.slice(0, 4));

  const [form, setForm] = useState<ProjectInput>(() =>
    existing
      ? {
          name: existing.name,
          startDate: existing.startDate,
          targetDate: existing.targetDate,
          targetEstimated: existing.targetEstimated,
          color: existing.color,
          description: existing.description,
          vision: existing.vision,
          successCriteria: existing.successCriteria,
          category: existing.category,
          priority: existing.priority,
          icon: existing.icon,
          imageUri: existing.imageUri,
          coverUri: existing.coverUri,
          progressModel: existing.progressModel,
          optionalMode: existing.optionalMode,
        }
      : {
          name: '',
          startDate: today,
          targetDate: `${year + 20}-12-31`,
          targetEstimated: true,
          color: 'violet',
          icon: 'compass',
          priority: 'medium',
          progressModel: 'equal',
          optionalMode: 'count',
        },
  );
  const [template, setTemplate] = useState<TemplateKey | 'none'>('none');
  const [error, setError] = useState<PlannerError | null>(null);
  const set = (patch: Partial<ProjectInput>) => {
    setForm(f => ({ ...f, ...patch }));
    setError(null);
  };
  const label = [typography.label, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];

  const save = () => {
    if (existing) {
      const r = plannerActions.updateProject(existing.id, form);
      if (!r.ok) return setError(r.error);
      navigation.goBack();
      return;
    }
    const r = plannerActions.createProject(
      form,
      template === 'none'
        ? undefined
        : (rootId, projectId) =>
            templateNodes(
              template,
              rootId,
              projectId,
              form.startDate,
              form.targetDate,
              k => t(`planner.tpl.${k}`),
            ),
    );
    if (!r.ok) return setError(r.error);
    navigation.replace(ROUTES.PLANNER_MAP, { projectId: r.value.id });
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header
        label={existing ? t('planner.editProject') : t('planner.createProject')}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <FormField
          label={t('planner.projectName')}
          value={form.name}
          onChangeText={name => set({ name })}
          maxLength={120}
          placeholder={t('planner.projectNamePlaceholder')}
          testID="plan-name"
        />
        <View style={[styles.row, { gap: spacing.sm }]}>
          <View style={styles.flex}>
            <DateField
              label={t('planner.startDate')}
              value={form.startDate}
              onChange={d => d && set({ startDate: d })}
              today={today}
              yearNav
              testID="plan-start"
            />
          </View>
          <View style={styles.flex}>
            <DateField
              label={t('planner.targetDate')}
              value={form.targetDate}
              onChange={d => d && set({ targetDate: d })}
              today={today}
              yearNav
              testID="plan-target"
            />
          </View>
        </View>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <View style={styles.flex}>
            <Text style={label}>{t('planner.targetIsEstimate')}</Text>
            <Text style={caption}>{t('planner.targetIsEstimateHint')}</Text>
          </View>
          <ToggleSwitch
            isOn={!!form.targetEstimated}
            onToggle={v => set({ targetEstimated: v })}
            accessibilityLabel={t('planner.targetIsEstimate')}
          />
        </View>
        {existing?.deadlineHistory.length ? (
          <Text style={caption}>
            {t('planner.deadlineHistory', {
              list: existing.deadlineHistory
                .map(h => formatDate(h.from))
                .join(' → '),
            })}
          </Text>
        ) : null}
        <Text style={label}>{t('planner.color')}</Text>
        <ColorPicker
          value={form.color}
          onChange={color => set({ color })}
          testID="plan-color"
        />

        {!existing ? (
          <>
            <SectionTitle>{t('planner.templateTitle')}</SectionTitle>
            <Chips
              options={[
                { value: 'none', label: t('planner.template_none') },
                ...TEMPLATE_KEYS.map(k => ({
                  value: k,
                  label: t(`planner.template_${k}`),
                })),
              ]}
              value={template}
              onChange={v => setTemplate(v as TemplateKey | 'none')}
              accessibilityLabel={t('planner.templateTitle')}
              testID="plan-template"
            />
            <Text style={caption}>{t('planner.templateHint')}</Text>
          </>
        ) : null}

        <SectionTitle>{t('planner.optional')}</SectionTitle>
        <FormField
          label={t('planner.vision')}
          value={form.vision}
          onChangeText={vision => set({ vision })}
          multiline
          maxLength={2000}
        />
        <FormField
          label={t('planner.description')}
          value={form.description}
          onChangeText={description => set({ description })}
          multiline
          maxLength={2000}
        />
        <FormField
          label={t('planner.successCriteria')}
          value={form.successCriteria}
          onChangeText={successCriteria => set({ successCriteria })}
          multiline
          maxLength={2000}
        />
        <FormField
          label={t('planner.categoryText')}
          value={form.category}
          onChangeText={category => set({ category })}
          maxLength={120}
        />
        <Text style={label}>{t('planner.priority')}</Text>
        <Chips
          options={PRIORITIES.map(p => ({
            value: p,
            label: t(`life.priority_${p}`),
          }))}
          value={form.priority ?? 'medium'}
          onChange={p => set({ priority: p as Priority })}
          accessibilityLabel={t('planner.priority')}
          testID="plan-priority"
        />
        <Text style={label}>{t('planner.icon')}</Text>
        <IconPicker
          value={form.icon ?? 'compass'}
          color={form.color}
          onChange={icon => set({ icon })}
          testID="plan-icon"
        />
        {(['imageUri', 'coverUri'] as const).map(key => (
          <View key={key} style={[styles.row, { gap: spacing.sm }]}>
            {form[key] ? (
              <Image
                source={{ uri: form[key] }}
                style={[styles.thumb, { borderRadius: radius.md }]}
              />
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              label={t(
                key === 'imageUri' ? 'planner.picture' : 'planner.coverImage',
              )}
              onPress={async () => {
                const uri = await pickPicture();
                if (uri) set({ [key]: uri });
              }}
            />
            {form[key] ? (
              <Button
                size="sm"
                variant="ghost"
                label={t('planner.remove')}
                onPress={() => set({ [key]: '' })}
              />
            ) : null}
          </View>
        ))}

        <SectionTitle>{t('planner.progressSettings')}</SectionTitle>
        <Chips
          options={[
            { value: 'equal', label: t('planner.model_equal') },
            { value: 'weighted', label: t('planner.model_weighted') },
          ]}
          value={form.progressModel ?? 'equal'}
          onChange={v => set({ progressModel: v as ProgressModel })}
          accessibilityLabel={t('planner.progressSettings')}
          testID="plan-model"
        />
        <Chips
          options={[
            { value: 'count', label: t('planner.optional_count') },
            { value: 'exclude', label: t('planner.optional_exclude') },
          ]}
          value={form.optionalMode ?? 'count'}
          onChange={v => set({ optionalMode: v as OptionalMode })}
          accessibilityLabel={t('planner.optionalMode')}
          testID="plan-optional"
        />
        <Text style={caption}>{t('planner.progressExplain')}</Text>

        {error ? (
          <Notice
            tone="error"
            message={t(`planner.error_${error}`)}
            testID="plan-error"
          />
        ) : null}
        <Button
          label={existing ? t('planner.save') : t('planner.createAndOpen')}
          iconName="check"
          onPress={save}
          disabled={!form.name.trim()}
          testID="plan-save"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  thumb: { width: 48, height: 48 },
});
