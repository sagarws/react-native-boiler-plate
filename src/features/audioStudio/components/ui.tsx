import React, { useEffect, useState, type PropsWithChildren } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from '@/shared/assets';
import { Button, Icon, Slider } from '@/shared/components';
import { useTheme } from '@/theme';

/* Small building blocks shared by the 8D Audio Studio screens. */

export function Chip({
  label,
  active,
  onPress,
  icon,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  icon?: IconName;
  testID?: string;
}) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: radius.lg,
          paddingHorizontal: spacing.md,
          gap: spacing.xs,
          backgroundColor: active
            ? colors.primary
            : pressed
            ? colors.primarySoft
            : colors.surfaceMuted,
        },
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={16}
          color={active ? colors.primaryForeground : colors.textPrimary}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          typography.label,
          { color: active ? colors.primaryForeground : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children }: PropsWithChildren) {
  const { spacing } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}
    >
      {children}
    </ScrollView>
  );
}

export function Section({
  title,
  right,
  children,
  style,
}: PropsWithChildren<{
  title: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}>) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          padding: spacing.lg,
          gap: spacing.md,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        <Text
          style={[typography.label, styles.flex, { color: colors.textPrimary }]}
        >
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** A labelled slider showing its value. */
export function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  testID,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  testID?: string;
}) {
  const { colors, typography } = useTheme();
  const text = format ? format(value) : `${Math.round(value * 100)}%`;
  return (
    <View>
      <View style={styles.row}>
        <Text
          style={[
            typography.caption,
            styles.flex,
            { color: colors.textSecondary },
          ]}
        >
          {label}
        </Text>
        <Text style={[typography.caption, { color: colors.textPrimary }]}>
          {text}
        </Text>
      </View>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        accessibilityLabel={label}
        accessibilityValueText={text}
        testID={testID}
      />
    </View>
  );
}

export function Artwork({
  uri,
  size,
  rounded = 8,
}: {
  uri: string | null;
  size: number;
  rounded?: number;
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        backgroundColor: colors.primarySoft,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name="audioLines" size={size * 0.45} color={colors.primaryText} />
      )}
    </View>
  );
}

/** Bottom sheet listing actions. */
export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  actions: {
    label: string;
    icon: IconName;
    onPress: () => void;
    destructive?: boolean;
  }[];
  onClose: () => void;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  const { bottom } = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingBottom: bottom + spacing.md,
            paddingTop: spacing.md,
          }}
        >
          <Text
            numberOfLines={1}
            style={[
              typography.label,
              {
                color: colors.textSecondary,
                paddingHorizontal: spacing.lg,
                paddingBottom: spacing.sm,
              },
            ]}
          >
            {title}
          </Text>
          {actions.map(a => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                a.onPress();
              }}
              style={({ pressed }) => [
                styles.sheetRow,
                { paddingHorizontal: spacing.lg, gap: spacing.md },
                pressed && { backgroundColor: colors.primarySoft },
              ]}
            >
              <Icon
                name={a.icon}
                size={20}
                color={a.destructive ? colors.error : colors.primaryText}
              />
              <Text
                style={[
                  typography.body,
                  { color: a.destructive ? colors.error : colors.textPrimary },
                ]}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Asks for a name (Android has no text prompt). */
export function NameDialog({
  visible,
  title,
  initial = '',
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (visible) setName(initial);
  }, [visible, initial]);
  const submit = () => {
    if (!name.trim()) return;
    onSubmit(name.trim());
    onClose();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[
          styles.backdrop,
          styles.center,
          { backgroundColor: colors.overlay },
        ]}
        onPress={onClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            onPress={() => {}}
            style={{
              width: 320,
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <Text style={[typography.h2, { color: colors.textPrimary }]}>
              {title}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              maxLength={60}
              onSubmitEditing={submit}
              placeholder={t('audioStudio.common.name')}
              placeholderTextColor={colors.placeholder}
              style={[
                typography.body,
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                },
              ]}
              testID="studio-name-input"
            />
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                size="sm"
                onPress={onClose}
                style={styles.flex}
              />
              <Button
                label={t('audioStudio.common.save')}
                size="sm"
                onPress={submit}
                disabled={!name.trim()}
                style={styles.flex}
                testID="studio-name-save"
              />
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  size = 24,
  active,
  disabled,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  active?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      hitSlop={8}
      testID={testID}
      style={({ pressed }) => [
        styles.iconBtn,
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <Icon
        name={icon}
        size={size}
        color={active ? colors.primary : colors.textPrimary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  center: { justifyContent: 'center', alignItems: 'center' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  input: { borderWidth: 1, minHeight: 46 },
  iconBtn: { padding: 6, alignItems: 'center', justifyContent: 'center' },
});
