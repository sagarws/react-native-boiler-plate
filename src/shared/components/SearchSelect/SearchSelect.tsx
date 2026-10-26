import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';

export interface SearchSelectOption {
  id: string;
  name: string;
  // Optional secondary line below the name, e.g. a category or company.
  hint?: string;
}

export interface SearchSelectProps {
  // Currently selected option id (or null when no selection).
  value: string | null;
  options: SearchSelectOption[];
  onChange: (id: string | null) => void;
  // Label rendered above the field. Pass undefined to render nothing.
  label?: string;
  // Placeholder shown in the trigger when nothing is selected.
  placeholder?: string;
  // Placeholder for the search input inside the modal.
  searchPlaceholder?: string;
  // Modal title; defaults to `label` if not provided.
  modalTitle?: string;
  // Disables interaction; the trigger reads selected option but won't open.
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  // Allow clearing the selection from inside the modal.
  clearable?: boolean;
  // Empty-list copy. Defaults to a translated fallback.
  emptyText?: string;
}

export function SearchSelect({
  value,
  options,
  onChange,
  label,
  placeholder,
  searchPlaceholder,
  modalTitle,
  disabled,
  loading,
  error,
  clearable = true,
  emptyText,
}: SearchSelectProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography, radius, shadows } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => options.find(o => o.id === value) ?? null,
    [options, value],
  );

  // Reset the search field every time the modal opens so users don't see a
  // stale filter from a previous interaction.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      if (o.name.toLowerCase().includes(q)) return true;
      if (o.hint && o.hint.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [options, query]);

  const triggerColor = selected ? colors.text : colors.mutedForeground;
  const triggerLabel = selected?.name ?? placeholder ?? '';

  return (
    <View>
      {label ? (
        <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
      ) : null}

      <Pressable
        onPress={() => {
          if (disabled || loading) return;
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder ?? 'Select'}
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            marginTop: label ? spacing.xs : 0,
            opacity: disabled || loading ? 0.6 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text
          style={[typography.body, { color: triggerColor, flex: 1 }]}
          numberOfLines={1}
        >
          {loading ? t('common.loading') ?? 'Loading…' : triggerLabel}
        </Text>
        {selected && clearable && !loading ? (
          <Pressable
            hitSlop={8}
            onPress={e => {
              e.stopPropagation();
              onChange(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('common.clear') ?? 'Clear'}
            style={styles.clearBtn}
          >
            <Text
              style={[
                typography.caption,
                { color: colors.mutedForeground, fontWeight: '700' },
              ]}
            >
              ✕
            </Text>
          </Pressable>
        ) : (
          <Text
            style={[
              typography.body,
              { color: colors.mutedForeground, marginLeft: spacing.sm },
            ]}
          >
            ▾
          </Text>
        )}
      </Pressable>

      {error ? (
        <Text
          style={[
            typography.caption,
            { color: colors.danger, marginTop: spacing.xs },
          ]}
        >
          {error}
        </Text>
      ) : null}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
          onPress={() => setOpen(false)}
          accessibilityLabel={t('common.cancel') ?? 'Cancel'}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.center}
          >
            <Pressable
              onPress={() => {}}
              style={[
                styles.sheet,
                shadows.lg ?? null,
                {
                  backgroundColor: colors.popover,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                  marginHorizontal: spacing.lg,
                },
              ]}
            >
              <View
                style={{
                  paddingHorizontal: spacing.lg,
                  paddingTop: spacing.lg,
                  paddingBottom: spacing.md,
                }}
              >
                <Text style={[typography.h2, { color: colors.text }]}>
                  {modalTitle ?? label ?? ''}
                </Text>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={
                    searchPlaceholder ?? t('common.search') ?? 'Search…'
                  }
                  placeholderTextColor={colors.mutedForeground}
                  autoCorrect={false}
                  autoCapitalize="none"
                  style={[
                    typography.body,
                    {
                      color: colors.text,
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: radius.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      marginTop: spacing.md,
                    },
                  ]}
                />
              </View>

              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                <FlatList
                  data={filtered}
                  keyExtractor={item => item.id}
                  keyboardShouldPersistTaps="handled"
                  style={{ maxHeight: 320 }}
                  ItemSeparatorComponent={() => (
                    <View
                      style={{
                        height: StyleSheet.hairlineWidth,
                        backgroundColor: colors.border,
                      }}
                    />
                  )}
                  ListEmptyComponent={
                    <View
                      style={{
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.lg,
                      }}
                    >
                      <Text
                        style={[
                          typography.body,
                          {
                            color: colors.mutedForeground,
                            textAlign: 'center',
                          },
                        ]}
                      >
                        {emptyText ?? t('common.noResults') ?? 'No results'}
                      </Text>
                    </View>
                  }
                  renderItem={({ item }) => {
                    const isSelected = item.id === value;
                    return (
                      <Pressable
                        onPress={() => {
                          onChange(item.id);
                          setOpen(false);
                        }}
                        style={({ pressed }) => ({
                          paddingHorizontal: spacing.lg,
                          paddingVertical: spacing.md,
                          backgroundColor: pressed
                            ? colors.accent
                            : 'transparent',
                          flexDirection: 'row',
                          alignItems: 'center',
                        })}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              typography.body,
                              {
                                color: colors.text,
                                fontWeight: isSelected ? '700' : '500',
                              },
                            ]}
                          >
                            {item.name}
                          </Text>
                          {item.hint ? (
                            <Text
                              style={[
                                typography.caption,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              {item.hint}
                            </Text>
                          ) : null}
                        </View>
                        {isSelected ? (
                          <Text
                            style={[
                              typography.body,
                              { color: colors.primary, marginLeft: spacing.sm },
                            ]}
                          >
                            ✓
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  }}
                />
              )}

              <Pressable
                onPress={() => setOpen(false)}
                style={{
                  paddingVertical: spacing.md,
                  alignItems: 'center',
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                }}
              >
                <Text
                  style={[typography.body, { color: colors.mutedForeground }]}
                >
                  {t('common.cancel') ?? 'Cancel'}
                </Text>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  clearBtn: {
    marginLeft: 8,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  sheet: { borderWidth: 1, overflow: 'hidden' },
  loadingRow: { paddingVertical: 24, alignItems: 'center' },
});
