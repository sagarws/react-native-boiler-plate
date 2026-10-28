import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Button, Icon, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { lifeActions, useLifeData } from '../hooks/useLife';
import { evaluate, periodContaining, reportsIn } from '../services/periods';
import type { ProgressReport, Task } from '../types';
import { addDays } from '../utils/dates';
import { formatPeriod, formatQty, parseAmount } from '../utils/format';

export interface LogProgressSheetProps {
  task: Task | null;
  today: string;
  onClose: () => void;
}

/**
 * Quick progress entry: amount (with quick-add chips), day (today /
 * yesterday), optional note. Shows what the period total will be, and the
 * period's entries for correcting or deleting. Several entries add up.
 */
export function LogProgressSheet({
  task,
  today,
  onClose,
}: LogProgressSheetProps) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const data = useLifeData();
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<ProgressReport | null>(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    setDay(today);
    setAmount('');
    setNote('');
    setEditing(null);
    setMessage(null);
  }, [task?.id, today]);

  const live = task ? data.tasks.find(x => x.id === task.id) ?? task : null;
  const period = live ? periodContaining(live, editing?.day ?? day) : null;
  const state = useMemo(
    () =>
      live && period
        ? evaluate(live, period, {
            reports: data.reports,
            reviews: data.reviews,
            today,
          })
        : null,
    [live, period, data.reports, data.reviews, today],
  );
  if (!live) return null;

  const entries = period
    ? reportsIn(period, data.reports).sort((a, b) =>
        a.reportedAt < b.reportedAt ? 1 : -1,
      )
    : [];
  const value = parseAmount(amount);
  const valid = Number.isFinite(value) && value > 0;
  const target =
    state?.target.quantity ?? live.targets[live.targets.length - 1].quantity;
  const after =
    (state?.completed ?? 0) - (editing?.quantity ?? 0) + (valid ? value : 0);
  const yesterday = addDays(today, -1);
  const canYesterday = !!periodContaining(live, yesterday);
  const quick = [
    ...new Set(
      [target * 0.25, target * 0.5, state?.remaining ?? target].map(
        n => Math.round(n * 10) / 10,
      ),
    ),
  ].filter(n => n > 0);

  const save = () => {
    if (!valid || saving.current) return;
    saving.current = true;
    const result = editing
      ? lifeActions.editReport(editing.id, { quantity: value, note })
      : lifeActions.addReport(
          { taskId: live.id, day, quantity: value, note },
          today,
        );
    saving.current = false;
    if (!result.ok) {
      setMessage({ tone: 'error', text: t(`life.error_${result.error}`) });
      return;
    }
    setMessage({
      tone: 'success',
      text: t('life.logSaved', {
        total: formatQty(after),
        target: formatQty(target),
        unit: live.unit,
      }),
    });
    setAmount('');
    setNote('');
    setEditing(null);
  };

  const label = [typography.label, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];
  const input = [
    typography.body,
    styles.input,
    {
      color: colors.textPrimary,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    },
  ];
  const chip = (
    text: string,
    selected: boolean,
    onPress: () => void,
    testID: string,
  ) => (
    <Pressable
      key={testID}
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
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
        {text}
      </Text>
    </Pressable>
  );

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
                {editing ? t('life.editEntry') : t('life.logTitle')}
              </Text>
              <Text style={caption} numberOfLines={1}>
                {live.name}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={styles.close}
              testID="log-close"
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
            {state ? (
              <Text style={caption}>
                {t('life.logPeriod', {
                  period: formatPeriod(state.start, state.end),
                })}{' '}
                ·{' '}
                {t('life.targetLine', {
                  target: `${formatQty(target)} ${live.unit}`,
                })}
              </Text>
            ) : null}
            {!editing ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={label}>{t('life.logDay')}</Text>
                <View style={[styles.wrap, { gap: spacing.sm }]}>
                  {chip(
                    t('life.logToday'),
                    day === today,
                    () => setDay(today),
                    'log-day-today',
                  )}
                  {canYesterday
                    ? chip(
                        t('life.logYesterday'),
                        day === yesterday,
                        () => setDay(yesterday),
                        'log-day-yesterday',
                      )
                    : null}
                </View>
              </View>
            ) : null}
            <View style={{ gap: spacing.xs }}>
              <Text style={label}>
                {t('life.logAmount', { unit: live.unit })}
              </Text>
              <TextInput
                testID="log-amount"
                accessibilityLabel={t('life.logAmount', { unit: live.unit })}
                value={amount}
                onChangeText={text => {
                  setAmount(text);
                  setMessage(null);
                }}
                keyboardType="decimal-pad"
                autoFocus
                style={input}
              />
              <View style={[styles.wrap, { gap: spacing.sm }]}>
                {quick.map(q =>
                  chip(
                    t('life.quickAdd', { amount: formatQty(q) }),
                    false,
                    () => setAmount(String(q)),
                    `log-quick-${q}`,
                  ),
                )}
              </View>
            </View>
            <View style={{ gap: spacing.xs }}>
              <Text style={label}>{t('life.logNote')}</Text>
              <TextInput
                testID="log-note"
                accessibilityLabel={t('life.logNote')}
                value={note}
                onChangeText={setNote}
                maxLength={500}
                multiline
                style={[input, styles.note]}
              />
            </View>
            <Text style={caption} testID="log-after">
              {t('life.logAfter', {
                total: formatQty(Math.max(0, after)),
                target: formatQty(target),
                unit: live.unit,
              })}
            </Text>
            {message ? (
              <Notice
                tone={message.tone}
                message={message.text}
                testID="log-message"
              />
            ) : null}
            <View style={[styles.row, { gap: spacing.sm }]}>
              {editing ? (
                <Button
                  variant="ghost"
                  label={t('life.cancel')}
                  onPress={() => {
                    setEditing(null);
                    setAmount('');
                    setNote('');
                  }}
                  style={styles.flex}
                />
              ) : null}
              <Button
                label={t('life.logSave')}
                iconName="check"
                onPress={save}
                disabled={!valid}
                style={styles.flex}
                testID="log-save"
              />
            </View>

            {entries.length ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Text style={label}>{t('life.entries')}</Text>
                {entries.map(r => (
                  <View
                    key={r.id}
                    style={[
                      styles.row,
                      {
                        gap: spacing.sm,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.divider,
                        paddingTop: spacing.sm,
                      },
                    ]}
                    testID={`log-entry-${r.id}`}
                  >
                    <View style={styles.flex}>
                      <Text
                        style={[typography.body, { color: colors.textPrimary }]}
                      >
                        {formatQty(r.quantity)} {live.unit}
                        {r.edits.length ? ` · ${t('life.entryEdited')}` : ''}
                      </Text>
                      <Text style={caption} numberOfLines={2}>
                        {new Date(r.reportedAt).toLocaleString([], {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {r.note ? ` · ${r.note}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('life.editEntry')}
                      onPress={() => {
                        setEditing(r);
                        setAmount(String(r.quantity));
                        setNote(r.note);
                        setMessage(null);
                      }}
                      style={styles.close}
                      testID={`log-edit-${r.id}`}
                    >
                      <Icon
                        name="pencil"
                        size={18}
                        color={colors.textSecondary}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('life.deleteEntry')}
                      onPress={() => lifeActions.deleteReport(r.id)}
                      style={styles.close}
                      testID={`log-delete-${r.id}`}
                    >
                      <Icon
                        name="trash2"
                        size={18}
                        color={colors.textSecondary}
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
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
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: { minHeight: 36, justifyContent: 'center' },
  input: { borderWidth: 1, minHeight: 48 },
  note: { minHeight: 64, textAlignVertical: 'top', paddingTop: 12 },
});
