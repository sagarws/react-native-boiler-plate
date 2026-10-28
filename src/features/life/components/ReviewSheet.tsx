import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ChoiceList, Icon, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { lifeActions } from '../hooks/useLife';
import type { PeriodState } from '../services/periods';
import { INCOMPLETE_REASONS, type IncompleteReason, type Task } from '../types';
import { formatPeriod, formatQty } from '../utils/format';

export interface ReviewSheetProps {
  /** An ended, unmet period that still needs a reason. */
  item: (PeriodState & { task: Task }) | null;
  today: string;
  onClose: () => void;
}

/**
 * Period-end report for a target that wasn't met: what was done, and a
 * required reason ("Other" needs a short explanation). Supportive wording.
 */
export function ReviewSheet({ item, today, onClose }: ReviewSheetProps) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const [reason, setReason] = useState<IncompleteReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason(null);
    setNote('');
    setError(null);
  }, [item?.task.id, item?.start]);

  if (!item) return null;
  const { task } = item;
  const needsNote = reason === 'other' && note.trim().length < 3;

  const save = () => {
    if (!reason) return;
    const result = lifeActions.addReview(
      { taskId: task.id, periodStart: item.start, reason, note },
      today,
    );
    if (!result.ok) {
      setError(t(`life.error_${result.error}`));
      return;
    }
    onClose();
  };

  const caption = [typography.caption, { color: colors.textSecondary }];
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingBottom: bottom + spacing.md,
            },
          ]}
        >
          <View
            style={[
              styles.row,
              { padding: spacing.lg, paddingBottom: spacing.sm },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[typography.title, { color: colors.textPrimary }]}>
                {t('life.reviewTitle')}
              </Text>
              <Text style={caption} numberOfLines={2}>
                {t('life.reviewBody', {
                  task: task.name,
                  period: formatPeriod(item.start, item.end),
                })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('life.cancel')}
              onPress={onClose}
              style={styles.close}
              testID="review-close"
            >
              <Icon name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              gap: spacing.md,
            }}
          >
            <Text
              style={[typography.body, { color: colors.textPrimary }]}
              testID="review-numbers"
            >
              {t('life.reviewNumbers', {
                done: formatQty(item.completed),
                target: formatQty(item.target.quantity),
                unit: task.unit,
                percent: item.percent,
                remaining: formatQty(item.remaining),
              })}
            </Text>
            {!item.hasReports ? (
              <Text style={caption}>{t('life.reviewNoReports')}</Text>
            ) : null}
            <Text style={caption}>{t('life.reviewSupport')}</Text>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('life.reviewReason')}
            </Text>
            <ChoiceList
              testID="review-reason"
              accessibilityLabel={t('life.reviewReason')}
              value={reason ?? ('' as IncompleteReason)}
              onChange={r => {
                setReason(r);
                setError(null);
              }}
              choices={INCOMPLETE_REASONS.map(r => ({
                value: r,
                title: t(`life.reason_${r}`),
              }))}
            />
            <TextInput
              testID="review-note"
              accessibilityLabel={
                reason === 'other'
                  ? t('life.reviewNoteOther')
                  : t('life.reviewNote')
              }
              placeholder={
                reason === 'other'
                  ? t('life.reviewNoteOther')
                  : t('life.reviewNote')
              }
              placeholderTextColor={colors.placeholder}
              value={note}
              onChangeText={setNote}
              maxLength={500}
              multiline
              style={[
                typography.body,
                styles.note,
                {
                  color: colors.textPrimary,
                  borderColor: needsNote ? colors.warning : colors.border,
                  backgroundColor: colors.surface,
                  borderRadius: radius.md,
                  padding: spacing.md,
                },
              ]}
            />
            {error ? (
              <Notice tone="error" message={error} testID="review-error" />
            ) : null}
            <Button
              label={t('life.reviewSave')}
              onPress={save}
              disabled={!reason || needsNote}
              testID="review-save"
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { borderWidth: 1, minHeight: 72, textAlignVertical: 'top' },
});
