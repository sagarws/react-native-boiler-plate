import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ColorPicker, FormField, IconPicker } from '@/features/life';
import { Button, Notice } from '@/shared/components';
import { followUpActions } from '../hooks/useFollowUp';
import type { Category, Tag } from '../types';
import { Field, Sheet } from './Sheet';

export type LabelTarget =
  | { kind: 'category'; item: Category | null }
  | { kind: 'tag'; item: Tag | null };

/**
 * Creates or renames a category (name, colour, icon) or tag (name, colour).
 * Opens over the contact form too, so a new label never loses the form.
 */
export function LabelEditorSheet({
  target,
  onClose,
  onSaved,
}: {
  target: LabelTarget | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [color, setColor] = useState('violet');
  const [icon, setIcon] = useState('tag');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(target?.item?.name ?? '');
    setColor(
      target?.item?.color ?? (target?.kind === 'tag' ? 'blue' : 'violet'),
    );
    setIcon(target?.kind === 'category' ? target.item?.icon ?? 'tag' : 'tag');
    setError(null);
  }, [target]);

  if (!target) return null;
  const isCategory = target.kind === 'category';

  const save = () => {
    const result = isCategory
      ? followUpActions.saveCategory({ id: target.item?.id, name, color, icon })
      : followUpActions.saveTag({ id: target.item?.id, name, color });
    if (!result.ok) {
      setError(t(`followUp.error_${result.error}`));
      return;
    }
    onSaved?.(result.value.id);
    onClose();
  };

  return (
    <Sheet
      visible
      title={t(
        target.item
          ? isCategory
            ? 'followUp.editCategory'
            : 'followUp.editTag'
          : isCategory
          ? 'followUp.newCategory'
          : 'followUp.newTag',
      )}
      onClose={onClose}
      testID="label-sheet"
      footer={
        <Button label={t('followUp.save')} onPress={save} testID="label-save" />
      }
    >
      {error ? <Notice tone="error" message={error} /> : null}
      <FormField
        label={t('followUp.labelName')}
        value={name}
        onChangeText={text => {
          setName(text);
          setError(null);
        }}
        autoFocus
        maxLength={80}
        testID="label-name"
      />
      <Field label={t('followUp.color')}>
        <ColorPicker value={color} onChange={setColor} testID="label-color" />
      </Field>
      {isCategory ? (
        <Field label={t('followUp.icon')}>
          <IconPicker
            value={icon}
            color={color}
            onChange={setIcon}
            testID="label-icon"
          />
        </Field>
      ) : null}
    </Sheet>
  );
}
