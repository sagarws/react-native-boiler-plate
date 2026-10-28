import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainStackParamList } from '@/navigation/types';
import { Button, Header, Notice, SegmentedControl } from '@/shared/components';
import { useTheme } from '@/theme';
import { FormField, SectionTitle } from '../components/form';
import { ColorPicker, DateField, IconPicker } from '../components/pickers';
import { Avatar } from '../components/visuals';
import { lifeActions, useClock, useLifeData } from '../hooks/useLife';
import { pickPicture } from '../services/picture.service';
import type { ProjectInput } from '../store/life.store';
import type { Priority } from '../types';
import { addDays } from '../utils/dates';

/** Create / edit a project. Required: name, dates, colour, icon (or picture). */
export default function ProjectFormScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'LifeProjectForm'>>();
  const { today } = useClock();
  const data = useLifeData();
  const existing = params?.projectId
    ? data.projects.find(p => p.id === params.projectId)
    : undefined;

  const [form, setForm] = useState<ProjectInput>(() =>
    existing
      ? { ...existing }
      : {
          name: '',
          icon: 'layers',
          color: 'violet',
          startDate: today,
          deadline: addDays(today, 90),
          priority: 'medium',
        },
  );
  const [details, setDetails] = useState(!!existing);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ProjectInput>) => {
    setForm(f => ({ ...f, ...patch }));
    setError(null);
  };

  const save = () => {
    const result = existing
      ? lifeActions.updateProject(existing.id, form)
      : lifeActions.createProject(form);
    if (!result.ok) {
      // The form keeps everything the user typed.
      setError(t(`life.error_${result.error}`));
      return;
    }
    navigation.goBack();
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header
        label={existing ? t('life.projectFormEdit') : t('life.projectFormNew')}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <View style={[styles.row, { gap: spacing.md }]}>
          <Avatar
            icon={form.icon}
            imageUri={form.imageUri}
            color={form.color}
            size={56}
          />
          <View style={styles.flex}>
            <FormField
              label={t('life.name')}
              placeholder={t('life.namePlaceholder')}
              value={form.name}
              onChangeText={name => set({ name })}
              maxLength={80}
              testID="project-name"
            />
          </View>
        </View>
        <DateField
          label={t('life.startDate')}
          value={form.startDate}
          onChange={d => d && set({ startDate: d })}
          today={today}
          testID="project-start"
        />
        <DateField
          label={t('life.deadline')}
          value={form.deadline}
          onChange={d => d && set({ deadline: d })}
          today={today}
          min={form.startDate}
          testID="project-deadline"
        />
        <View style={[styles.wrap, { gap: spacing.sm }]}>
          {(
            [
              ['days30', 30],
              ['days90', 90],
              ['days180', 182],
              ['year1', 365],
            ] as const
          ).map(([key, n]) => (
            <Button
              key={key}
              size="sm"
              variant="soft"
              label={t(`life.${key}`)}
              onPress={() => set({ deadline: addDays(form.startDate, n) })}
              testID={`project-duration-${n}`}
            />
          ))}
        </View>
        <SectionTitle>{t('life.color')}</SectionTitle>
        <ColorPicker
          value={form.color}
          onChange={color => set({ color })}
          testID="project-color"
        />
        <SectionTitle>{t('life.icon')}</SectionTitle>
        <IconPicker
          value={form.icon}
          color={form.color}
          onChange={icon => set({ icon, imageUri: '' })}
          testID="project-icon"
        />
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            size="sm"
            variant="secondary"
            iconName="palette"
            label={t('life.pickPicture')}
            onPress={() => {
              void pickPicture().then(uri => uri && set({ imageUri: uri }));
            }}
            style={styles.flex}
            testID="project-picture"
          />
          {form.imageUri ? (
            <Button
              size="sm"
              variant="ghost"
              label={t('life.removePicture')}
              onPress={() => set({ imageUri: '' })}
              style={styles.flex}
            />
          ) : null}
        </View>

        <Button
          variant="ghost"
          label={t('life.moreDetails')}
          onPress={() => setDetails(v => !v)}
          testID="project-more"
        />
        {details ? (
          <View style={{ gap: spacing.md }}>
            <FormField
              label={t('life.description')}
              value={form.description ?? ''}
              onChangeText={description => set({ description })}
              multiline
              maxLength={500}
            />
            <FormField
              label={t('life.objective')}
              value={form.objective ?? ''}
              onChangeText={objective => set({ objective })}
              multiline
              maxLength={500}
            />
            <FormField
              label={t('life.successCriteria')}
              value={form.successCriteria ?? ''}
              onChangeText={successCriteria => set({ successCriteria })}
              multiline
              maxLength={500}
            />
            <FormField
              label={t('life.category')}
              value={form.category ?? ''}
              onChangeText={category => set({ category })}
              maxLength={80}
            />
            <SegmentedControl
              accessibilityLabel={t('life.priority')}
              value={form.priority ?? 'medium'}
              onChange={(priority: Priority) => set({ priority })}
              options={(['high', 'medium', 'low'] as const).map(p => ({
                value: p,
                label: t(`life.priority_${p}`),
              }))}
              testID="project-priority"
            />
            <FormField
              label={t('life.notes')}
              value={form.notes ?? ''}
              onChangeText={notes => set({ notes })}
              multiline
              maxLength={500}
            />
          </View>
        ) : null}

        {error ? (
          <Notice tone="error" message={error} testID="project-error" />
        ) : null}
        <Button
          label={existing ? t('life.save') : t('life.create')}
          iconName="check"
          onPress={save}
          testID="project-save"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
});
