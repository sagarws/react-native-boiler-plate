import React, { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  StackActions,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormField, SectionTitle } from '@/features/life';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import {
  Button,
  Header,
  MobileNumberInput,
  Notice,
  ToggleSwitch,
} from '@/shared/components';
import { todayKey, type DayKey } from '@/shared/utils/dayKey';
import { pickPicture } from '@/shared/utils/pickFile';
import { categoryColor, useTheme } from '@/theme';
import { BirthDateInput } from '../components/BirthDateInput';
import { ContactAvatar } from '../components/ContactCard';
import {
  LabelEditorSheet,
  type LabelTarget,
} from '../components/LabelEditorSheet';
import {
  draftToInput,
  ScheduleFields,
  type ScheduleDraft,
} from '../components/ScheduleFields';
import { Chip, ChipRow, Field } from '../components/Sheet';
import { followUpActions, useFollowUpData } from '../hooks/useFollowUp';
import type { ContactInput, FollowUpError } from '../store/followup.store';
import { validateContact } from '../store/followup.store';

type FieldKey = 'name' | 'phone' | 'birth' | 'email' | 'schedule';

const FIELD_OF: Partial<Record<FollowUpError, FieldKey>> = {
  name_required: 'name',
  phone_required: 'phone',
  phone_invalid: 'phone',
  dial_invalid: 'phone',
  date_invalid: 'birth',
  email_invalid: 'email',
};

/**
 * New or edit contact. Name and mobile are required; everything else is
 * optional, including a first follow-up. Categories and tags come from
 * Follow Up settings and can be created here without leaving the form.
 */
export default function ContactFormScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'FollowUpContactForm'>>();
  const data = useFollowUpData();
  const existing = params?.contactId
    ? data.contacts.find(c => c.id === params.contactId) ?? null
    : null;
  const today = todayKey();

  const [form, setForm] = useState<ContactInput>(() => ({
    name: existing?.name ?? '',
    dial: existing?.dial || data.settings.defaultDial,
    phone: existing
      ? existing.dial
        ? existing.phone
        : `00${existing.e164}`
      : '',
    birthDate: existing?.birthDate ?? '',
    email: existing?.email ?? '',
    organization: existing?.organization ?? '',
    location: existing?.location ?? '',
    categoryId: existing?.categoryId ?? '',
    tagIds: existing?.tagIds ?? [],
    notes: existing?.notes ?? '',
    photoUri: existing?.photoUri ?? '',
  }));
  const [birth, setBirth] = useState<DayKey | '' | null>(
    existing?.birthDate ?? '',
  );
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [first, setFirst] = useState<ScheduleDraft>({
    day: null,
    time: '',
    type: data.settings.defaultType,
    purpose: '',
    reminder: data.settings.reminderByDefault,
  });
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [label, setLabel] = useState<LabelTarget | null>(null);
  const saving = useRef(false);

  const set = (patch: Partial<ContactInput>) => {
    setForm(f => ({ ...f, ...patch }));
    setErrors({});
  };
  const categories = data.categories.filter(
    c => c.isActive || c.id === form.categoryId,
  );
  const tags = data.tags.filter(
    tag => tag.isActive || form.tagIds?.includes(tag.id),
  );

  const persist = (
    input: ContactInput,
    schedule?: ReturnType<typeof draftToInput>,
  ) => {
    const result = existing
      ? followUpActions.updateContact(existing.id, input)
      : followUpActions.createContact(
          input,
          schedule?.ok ? schedule.value : undefined,
        );
    saving.current = false;
    if (!result.ok) {
      const field = FIELD_OF[result.error] ?? 'name';
      setErrors({ [field]: t(`followUp.error_${result.error}`) });
      return;
    }
    if (existing) navigation.goBack();
    // Replace the form with the new contact's page.
    else
      navigation.dispatch(
        StackActions.replace(ROUTES.FOLLOW_UP_CONTACT, {
          contactId: result.value.id,
        }),
      );
  };

  const save = () => {
    if (saving.current) return;
    if (birth === null) {
      setErrors({ birth: t('followUp.error_date_invalid') });
      return;
    }
    const input: ContactInput = { ...form, birthDate: birth };
    const error = validateContact(input);
    if (error) {
      setErrors({ [FIELD_OF[error] ?? 'name']: t(`followUp.error_${error}`) });
      return;
    }
    let schedule: ReturnType<typeof draftToInput> | undefined;
    if (!existing && withFollowUp) {
      schedule = draftToInput(first);
      if (!schedule.ok) {
        setErrors({
          schedule: t(
            schedule.error === 'date'
              ? 'followUp.error_date_invalid'
              : 'followUp.error_time_invalid',
          ),
        });
        return;
      }
    }
    saving.current = true;
    const duplicate = followUpActions.findDuplicate(
      input.phone,
      input.dial,
      existing?.id,
    );
    if (!duplicate) {
      persist(input, schedule);
      return;
    }
    // Same number already saved: offer the existing contact; never merge.
    Alert.alert(
      t('followUp.duplicateTitle'),
      t('followUp.duplicateMessage', { name: duplicate.name }),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => {
            saving.current = false;
          },
        },
        {
          text: t('followUp.openExisting'),
          onPress: () => {
            saving.current = false;
            navigation.navigate(ROUTES.FOLLOW_UP_CONTACT, {
              contactId: duplicate.id,
            });
          },
        },
        {
          text: t('followUp.saveAnyway'),
          onPress: () => persist(input, schedule),
        },
      ],
      { onDismiss: () => (saving.current = false) },
    );
  };

  const error = (key: FieldKey) =>
    errors[key] ? (
      <Text style={[typography.caption, { color: colors.error }]}>
        {errors[key]}
      </Text>
    ) : null;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header
        label={existing ? t('followUp.editContact') : t('followUp.newContact')}
      />
      <ScrollView
        testID="contact-form"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {Object.keys(errors).length ? (
          <Notice tone="error" message={t('followUp.fixErrors')} />
        ) : null}
        <View style={[styles.row, { gap: spacing.md }]}>
          <ContactAvatar
            name={form.name || '?'}
            photoUri={form.photoUri ?? ''}
            color={categoryColor(
              categories.find(c => c.id === form.categoryId)?.color ?? 'violet',
            )}
            size={64}
          />
          <View style={[styles.flex, { gap: spacing.xs }]}>
            <Button
              size="sm"
              variant="soft"
              iconName="camera"
              label={
                form.photoUri
                  ? t('followUp.changePhoto')
                  : t('followUp.addPhoto')
              }
              onPress={() => {
                void pickPicture().then(uri => uri && set({ photoUri: uri }));
              }}
              testID="contact-photo"
            />
            {form.photoUri ? (
              <Button
                size="sm"
                variant="ghost"
                label={t('followUp.removePhoto')}
                onPress={() => set({ photoUri: '' })}
              />
            ) : null}
          </View>
        </View>

        <FormField
          label={`${t('followUp.name')} *`}
          value={form.name}
          onChangeText={name => set({ name })}
          maxLength={80}
          autoCapitalize="words"
          testID="contact-name"
        />
        {error('name')}

        <Field label={`${t('followUp.mobile')} *`}>
          <MobileNumberInput
            countryCode={form.dial}
            phone={form.phone}
            onCountryCodeChange={dial => set({ dial })}
            onPhoneChange={phone => set({ phone })}
            errorMessage={errors.phone ?? null}
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('followUp.mobileHint')}
          </Text>
        </Field>

        <BirthDateInput
          value={form.birthDate ?? ''}
          onChange={setBirth}
          testID="contact-birth"
        />
        {error('birth')}

        <FormField
          label={t('followUp.email')}
          value={form.email}
          onChangeText={email => set({ email })}
          keyboardType="email-address"
          autoCapitalize="none"
          maxLength={200}
          testID="contact-email"
        />
        {error('email')}
        <FormField
          label={t('followUp.organization')}
          value={form.organization}
          onChangeText={organization => set({ organization })}
          maxLength={80}
          testID="contact-org"
        />
        <FormField
          label={t('followUp.location')}
          value={form.location}
          onChangeText={location => set({ location })}
          maxLength={200}
          testID="contact-location"
        />

        <Field label={t('followUp.category')}>
          {categories.length ? null : (
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('followUp.noCategories')}
            </Text>
          )}
          <ChipRow>
            {categories.map(c => (
              <Chip
                key={c.id}
                label={c.name}
                color={c.color}
                selected={form.categoryId === c.id}
                onPress={() =>
                  set({ categoryId: form.categoryId === c.id ? '' : c.id })
                }
                testID={`contact-category-${c.id}`}
              />
            ))}
            <Chip
              icon="plus"
              label={t('followUp.newCategory')}
              selected={false}
              onPress={() => setLabel({ kind: 'category', item: null })}
              testID="contact-new-category"
            />
          </ChipRow>
        </Field>

        <Field label={t('followUp.tags')}>
          {tags.length ? null : (
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('followUp.noTags')}
            </Text>
          )}
          <ChipRow>
            {tags.map(tag => {
              const on = form.tagIds?.includes(tag.id) ?? false;
              return (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  color={tag.color}
                  selected={on}
                  onPress={() =>
                    set({
                      tagIds: on
                        ? form.tagIds?.filter(id => id !== tag.id)
                        : [...(form.tagIds ?? []), tag.id],
                    })
                  }
                  testID={`contact-tag-${tag.id}`}
                />
              );
            })}
            <Chip
              icon="plus"
              label={t('followUp.newTag')}
              selected={false}
              onPress={() => setLabel({ kind: 'tag', item: null })}
              testID="contact-new-tag"
            />
          </ChipRow>
        </Field>

        <FormField
          label={t('followUp.notes')}
          value={form.notes}
          onChangeText={notes => set({ notes })}
          multiline
          maxLength={1000}
          testID="contact-notes"
        />

        {!existing ? (
          <>
            <View style={[styles.row, { gap: spacing.md }]}>
              <View style={styles.flex}>
                <SectionTitle>{t('followUp.firstFollowUp')}</SectionTitle>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('followUp.firstFollowUpHint')}
                </Text>
              </View>
              <ToggleSwitch
                isOn={withFollowUp}
                onToggle={setWithFollowUp}
                accessibilityLabel={t('followUp.firstFollowUp')}
              />
            </View>
            {withFollowUp ? (
              <ScheduleFields
                value={first}
                onChange={next => {
                  setFirst(next);
                  setErrors({});
                }}
                today={today}
                remindersOn={data.settings.remindersEnabled}
                testID="contact-first"
              />
            ) : null}
            {error('schedule')}
          </>
        ) : null}

        <Button
          label={t('followUp.saveContact')}
          onPress={save}
          testID="contact-save"
        />
      </ScrollView>
      <LabelEditorSheet
        target={label}
        onClose={() => setLabel(null)}
        onSaved={id =>
          label?.kind === 'category'
            ? set({ categoryId: id })
            : set({ tagIds: [...(form.tagIds ?? []), id] })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
