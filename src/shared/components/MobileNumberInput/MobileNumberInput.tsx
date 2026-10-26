import React, { useState } from 'react';
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
import { useTheme } from '@/theme';
import { Button } from '../Button';
import { COUNTRIES, findCountry, MOBILE_MAX } from './countries';

export interface MobileNumberInputProps {
  countryCode: string;
  phone: string;
  onCountryCodeChange: (dial: string) => void;
  onPhoneChange: (phone: string) => void;
  placeholder?: string;
  // Renders a thin red border + helper text below the field when set.
  errorMessage?: string | null;
  autoFocus?: boolean;
}

// Composite phone input — a flag-based country code picker button + the
// national-number text input. Used wherever the worker enters their phone
// (onboarding, login). The component owns its picker modal state; the
// parent only owns the values.
export function MobileNumberInput({
  countryCode,
  phone,
  onCountryCodeChange,
  onPhoneChange,
  placeholder,
  errorMessage,
  autoFocus,
}: MobileNumberInputProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography, radius } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = findCountry(countryCode);

  const inputStyle = {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: errorMessage ? colors.destructive : colors.border,
  } as const;

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('profile.countryCode') ?? 'Country code'}
          style={({ pressed }) => [
            inputStyle,
            styles.countryButton,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[typography.body, { color: colors.text }]}>
            {selected ? selected.flag : '🌐'}{' '}
            <Text style={{ color: colors.mutedForeground }}>{countryCode}</Text>
          </Text>
        </Pressable>
        <TextInput
          value={phone}
          onChangeText={v =>
            onPhoneChange(v.replace(/\D/g, '').slice(0, MOBILE_MAX))
          }
          keyboardType="phone-pad"
          autoCorrect={false}
          maxLength={MOBILE_MAX}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          autoFocus={autoFocus}
          style={[inputStyle, { flex: 1 }]}
        />
      </View>
      {errorMessage ? (
        <Text
          style={[
            typography.caption,
            { color: colors.destructive, marginTop: spacing.xs },
          ]}
        >
          {errorMessage}
        </Text>
      ) : null}

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable onPress={() => setPickerOpen(false)} style={styles.backdrop}>
          <Pressable
            onPress={e => e.stopPropagation()}
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: spacing.xl,
              maxHeight: '70%',
            }}
          >
            <Text
              style={[
                typography.h2,
                { color: colors.text, marginBottom: spacing.md },
              ]}
            >
              {t('profile.countryCode')}
            </Text>
            <ScrollView>
              {COUNTRIES.map(c => {
                const isSelected = countryCode === c.dial;
                return (
                  <Pressable
                    key={c.iso}
                    onPress={() => {
                      onCountryCodeChange(c.dial);
                      setPickerOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: spacing.md,
                      paddingHorizontal: spacing.sm,
                      borderRadius: radius.md,
                      backgroundColor: isSelected
                        ? colors.accent
                        : 'transparent',
                      marginBottom: spacing.xs,
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{c.flag}</Text>
                    <Text
                      style={[
                        typography.body,
                        {
                          flex: 1,
                          marginLeft: spacing.md,
                          color: isSelected ? colors.primary : colors.text,
                          fontWeight: isSelected ? '700' : '500',
                        },
                      ]}
                    >
                      {c.name}
                    </Text>
                    <Text
                      style={[
                        typography.body,
                        {
                          color: colors.mutedForeground,
                          fontVariant: ['tabular-nums'],
                        },
                      ]}
                    >
                      {c.dial}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button
              label={t('common.close')}
              variant="secondary"
              onPress={() => setPickerOpen(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  countryButton: {
    minWidth: 110,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
});
