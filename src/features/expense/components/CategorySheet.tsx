import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Field, Sheet } from '@/features/followup';
import { Avatar, ColorPicker, FormField } from '@/features/life';
import type { IconName } from '@/shared/assets';
import { Button, Icon } from '@/shared/components';
import { categoryColor, useTheme, type CategoryColor } from '@/theme';
import {
  expenseActions,
  useExpenseErrorText,
  type CategoryLookup,
} from '../hooks/useExpense';
import type { ExpenseError } from '../store/expense.store';
import { CATEGORY_ICONS, type ExpenseCategory } from '../types';

interface Draft {
  id?: string;
  name: string;
  icon: IconName;
  color: CategoryColor;
}

const NEW: Draft = { name: '', icon: 'tag', color: 'violet' };

function IconGrid({
  value,
  color,
  onChange,
}: {
  value: IconName;
  color: string;
  onChange: (icon: IconName) => void;
}) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={[styles.wrap, { gap: spacing.sm }]}
      accessibilityRole="radiogroup"
    >
      {CATEGORY_ICONS.map((name, i) => {
        const selected = name === value;
        return (
          <Pressable
            key={name}
            testID={`category-icon-${name}`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t('expense.iconOption', {
              n: i + 1,
              total: CATEGORY_ICONS.length,
            })}
            onPress={() => onChange(name)}
            style={[
              styles.iconCell,
              {
                borderRadius: radius.md,
                backgroundColor: selected
                  ? categoryColor(color)
                  : colors.surfaceMuted,
              },
            ]}
          >
            <Icon
              name={name}
              size={22}
              color={selected ? colors.primaryForeground : colors.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Category manager: built-ins are fixed; custom categories can be added,
 * renamed, re-iconed and deleted (their expenses move to "Other").
 */
export function CategorySheet({
  visible,
  onClose,
  categories,
  lookup,
  usage,
}: {
  visible: boolean;
  onClose: () => void;
  categories: ExpenseCategory[];
  lookup: CategoryLookup;
  /** Number of expenses in a category. */
  usage: (id: string) => number;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const errorText = useExpenseErrorText();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<ExpenseError | null>(null);

  const close = () => {
    setDraft(null);
    setError(null);
    onClose();
  };

  const save = () => {
    if (!draft) return;
    const result = expenseActions.saveCategory(draft, lookup.reservedNames);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    setError(null);
  };

  const remove = (c: ExpenseCategory) => {
    const count = usage(c.id);
    Alert.alert(
      t('expense.deleteCategoryTitle', { name: c.name }),
      count
        ? t('expense.deleteCategoryMoves', { count })
        : t('expense.deleteCategoryEmpty'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => expenseActions.deleteCategory(c.id),
        },
      ],
    );
  };

  if (draft) {
    return (
      <Sheet
        visible={visible}
        title={draft.id ? t('expense.editCategory') : t('expense.newCategory')}
        onClose={close}
        testID="category-editor"
        footer={
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Button
              variant="soft"
              label={t('common.cancel')}
              onPress={() => {
                setDraft(null);
                setError(null);
              }}
              style={styles.flex}
            />
            <Button
              label={t('expense.save')}
              onPress={save}
              style={styles.flex}
              testID="category-save"
            />
          </View>
        }
      >
        <FormField
          label={t('expense.categoryName')}
          value={draft.name}
          onChangeText={name => {
            setDraft({ ...draft, name });
            setError(null);
          }}
          maxLength={40}
          placeholder={t('expense.categoryNamePlaceholder')}
          testID="category-name"
        />
        {error ? (
          <Text style={[typography.caption, { color: colors.error }]}>
            {errorText(error)}
          </Text>
        ) : null}
        <Field label={t('expense.categoryColor')}>
          <ColorPicker
            value={draft.color}
            onChange={c => setDraft({ ...draft, color: c as CategoryColor })}
            testID="category-color"
          />
        </Field>
        <Field label={t('expense.categoryIcon')}>
          <IconGrid
            value={draft.icon}
            color={draft.color}
            onChange={icon => setDraft({ ...draft, icon })}
          />
        </Field>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      title={t('expense.categoriesTitle')}
      subtitle={t('expense.categoriesHint')}
      onClose={close}
      testID="category-sheet"
      footer={
        <Button
          iconName="plus"
          label={t('expense.addCategory')}
          onPress={() => setDraft(NEW)}
          testID="category-add"
        />
      }
    >
      {categories.map(c => (
        <View
          key={c.id}
          style={[styles.row, { gap: spacing.md }]}
          testID={`category-row-${c.id}`}
        >
          <Avatar icon={c.icon} color={c.color} size={36} />
          <View style={styles.flex}>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {lookup.nameOf(c)}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {c.isDefault
                ? t('expense.builtIn')
                : t('expense.usedBy', { count: usage(c.id) })}
            </Text>
          </View>
          {c.isDefault ? null : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('expense.editCategoryNamed', {
                  name: c.name,
                })}
                onPress={() =>
                  setDraft({
                    id: c.id,
                    name: c.name,
                    icon: c.icon,
                    color: c.color,
                  })
                }
                style={styles.iconButton}
                testID={`category-edit-${c.id}`}
              >
                <Icon name="pencil" size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('expense.deleteCategoryNamed', {
                  name: c.name,
                })}
                onPress={() => remove(c)}
                style={styles.iconButton}
                testID={`category-delete-${c.id}`}
              >
                <Icon name="trash2" size={18} color={colors.error} />
              </Pressable>
            </>
          )}
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  iconCell: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
