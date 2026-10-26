import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  EmptyState,
  Header,
  Icon,
  Notice,
} from '@/shared/components';
import type { MainStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme';
import { ToolButton } from '../components/ToolButton';
import { ResultMeta } from '../components/ResultMeta';
import {
  useExtractedText,
  type ExtractedSource,
} from '../hooks/useExtractedText';
import type { TextSelection } from '../utils/text';

type Feedback = 'copied' | 'copyFailed' | 'saved' | null;

type Params = Pick<MainStackParamList, 'ExtractedText'>;

const FEEDBACK_MS = 2500;

export default function ExtractedTextScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, radius, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<Params, 'ExtractedText'>>();
  const source: ExtractedSource =
    params.source === 'history'
      ? { kind: 'history', id: params.id }
      : { kind: 'latest' };
  const extraction = useExtractedText(source);
  const { text, setText, result, state } = extraction;

  const input = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [forcedSelection, setForcedSelection] = useState<
    TextSelection | undefined
  >();
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = setTimeout(() => setFeedback(null), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const hasSelection = selection != null && selection.end > selection.start;

  const onCopy = useCallback(async () => {
    const ok = await extraction.copy(hasSelection ? selection : null);
    setFeedback(ok ? 'copied' : 'copyFailed');
  }, [extraction, hasSelection, selection]);

  const onSelectAll = useCallback(() => {
    setEditing(true);
    const all = { start: 0, end: text.length };
    setForcedSelection(all);
    setSelection(all);
    requestAnimationFrame(() => input.current?.focus());
  }, [text.length]);

  const onToggleEdit = useCallback(() => {
    if (editing) {
      extraction.save();
      setEditing(false);
      setForcedSelection(undefined);
      input.current?.blur();
      setFeedback('saved');
    } else {
      setEditing(true);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [editing, extraction]);

  const onClear = useCallback(() => {
    Alert.alert(t('extracted.clear'), t('extracted.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('extracted.clear'),
        style: 'destructive',
        onPress: () => {
          extraction.clear();
          setSelection(null);
          setForcedSelection(undefined);
        },
      },
    ]);
  }, [extraction, t]);

  const onDelete = useCallback(() => {
    Alert.alert(t('extracted.delete'), t('extracted.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          extraction.remove();
          navigation.goBack();
        },
      },
    ]);
  }, [extraction, navigation, t]);

  const onSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    setSelection(event.nativeEvent.selection);
    setForcedSelection(undefined);
  };

  const canDelete = params.source === 'history' && state === 'ready';
  const deleteButton = canDelete ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('extracted.delete')}
      onPress={onDelete}
      style={styles.headerAction}
    >
      <Icon name="trash2" size={20} color={colors.error} />
    </Pressable>
  ) : null;

  const goHome = () => navigation.goBack();
  const isEmpty = text.length === 0;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('extracted.title')} right={deleteButton} />

      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : state === 'missing' || !result ? (
        <View style={styles.center}>
          <EmptyState
            icon="triangleAlert"
            title={t('extracted.missingTitle')}
            message={t('extracted.missingBody')}
            action={{ label: t('extracted.backHome'), onPress: goHome }}
            testID="extracted-missing"
          />
        </View>
      ) : (
        <>
          <View style={[styles.body, { padding: spacing.lg, gap: spacing.md }]}>
            <ResultMeta result={result} text={text} />
            {feedback ? (
              <Notice
                tone={feedback === 'copyFailed' ? 'error' : 'success'}
                message={t(`extracted.${feedback}`)}
                testID="extracted-feedback"
              />
            ) : null}
            <Card
              flat
              style={[
                styles.editorCard,
                editing && { borderColor: colors.primary },
              ]}
            >
              {isEmpty && !editing ? (
                <View style={styles.center}>
                  <EmptyState
                    compact
                    icon="textSelect"
                    title={t('extracted.emptyTitle')}
                    message={t('extracted.emptyBody')}
                  />
                </View>
              ) : (
                <TextInput
                  ref={input}
                  testID="extracted-editor"
                  accessibilityLabel={t('extracted.editorLabel')}
                  value={text}
                  onChangeText={setText}
                  editable={editing}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  selection={forcedSelection}
                  onSelectionChange={onSelectionChange}
                  placeholder={t('extracted.placeholder')}
                  placeholderTextColor={colors.placeholder}
                  selectionColor={colors.primary}
                  style={[
                    typography.reading,
                    styles.editor,
                    {
                      color: colors.textPrimary,
                      padding: spacing.lg,
                      borderRadius: radius.xl,
                    },
                  ]}
                />
              )}
            </Card>
          </View>

          <View
            style={[
              styles.toolbar,
              {
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                paddingBottom: Math.max(bottom, spacing.md),
                backgroundColor: colors.surface,
                borderTopColor: colors.divider,
                gap: spacing.sm,
              },
            ]}
          >
            <Button
              label={
                hasSelection
                  ? t('extracted.copySelection')
                  : t('extracted.copy')
              }
              iconName="copy"
              size="lg"
              onPress={onCopy}
              disabled={isEmpty}
              testID="extracted-copy"
            />
            <View style={[styles.tools, { gap: spacing.sm }]}>
              <ToolButton
                icon="textSelect"
                label={t('extracted.selectAll')}
                onPress={onSelectAll}
                disabled={isEmpty}
                testID="extracted-select-all"
              />
              <ToolButton
                icon={editing ? 'check' : 'pencil'}
                label={editing ? t('extracted.save') : t('extracted.edit')}
                onPress={onToggleEdit}
                active={editing}
                testID="extracted-edit"
              />
              <ToolButton
                icon="share2"
                label={t('extracted.share')}
                onPress={() => {
                  void extraction.share();
                }}
                disabled={isEmpty}
                testID="extracted-share"
              />
              <ToolButton
                icon="x"
                label={t('extracted.clear')}
                onPress={onClear}
                disabled={isEmpty}
                testID="extracted-clear"
              />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  editorCard: { flex: 1 },
  editor: { flex: 1 },
  headerAction: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: { borderTopWidth: StyleSheet.hairlineWidth },
  tools: { flexDirection: 'row' },
});
