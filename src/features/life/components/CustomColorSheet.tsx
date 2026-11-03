import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Slider, TextField } from '@/shared/components';
import { useTheme } from '@/theme';
import {
  hexToHsl,
  hslToHex,
  normalizeHex,
  type Hsl,
} from '../utils/customColor';

/** Hue samples drawn under the hue slider as a rainbow strip. */
const HUE_STRIP = Array.from({ length: 24 }, (_, i) => i * 15);

/**
 * Panel for picking any colour: hue / saturation / lightness sliders and a
 * hex field, with a live preview. Emits `#RRGGBB` on save.
 */
export function CustomColorSheet({
  visible,
  initial,
  onSave,
  onClose,
  testID,
}: {
  visible: boolean;
  /** Starting colour, `#RRGGBB`. */
  initial: string;
  onSave: (hex: string) => void;
  onClose: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, radius, spacing, typography } = useTheme();
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(initial));
  const [hexText, setHexText] = useState(initial);
  const [hexError, setHexError] = useState<string | null>(null);

  // Each opening starts from the colour currently chosen.
  useEffect(() => {
    if (visible) {
      setHsl(hexToHsl(initial));
      setHexText(initial);
      setHexError(null);
    }
  }, [visible, initial]);

  // A valid typed hex wins, so it is kept exactly (HSL rounding could shift it).
  const hex = normalizeHex(hexText) ?? hslToHex(hsl);
  const update = (patch: Partial<Hsl>) => {
    const next = { ...hsl, ...patch };
    setHsl(next);
    setHexText(hslToHex(next));
    setHexError(null);
  };
  const onHexChange = (text: string) => {
    setHexText(text);
    const norm = normalizeHex(text);
    if (norm) {
      setHsl(hexToHsl(norm));
      setHexError(null);
    } else {
      setHexError(text.trim() ? t('life.customColorInvalid') : null);
    }
  };

  const sliders: {
    key: keyof Hsl;
    label: string;
    max: number;
    unit: string;
  }[] = [
    { key: 'h', label: t('life.customColorHue'), max: 359, unit: '°' },
    { key: 's', label: t('life.customColorSaturation'), max: 100, unit: '%' },
    { key: 'l', label: t('life.customColorLightness'), max: 100, unit: '%' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.scrim,
          { backgroundColor: colors.overlay, padding: spacing.lg },
        ]}
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderRadius: radius.xl,
              padding: spacing.lg,
              gap: spacing.md,
            },
          ]}
          testID={testID}
        >
          <Text style={[typography.h2, { color: colors.textPrimary }]}>
            {t('life.customColorTitle')}
          </Text>
          <View
            style={[
              styles.preview,
              { backgroundColor: hex, borderRadius: radius.lg },
            ]}
            accessibilityLabel={t('life.customColorPreview', { hex })}
            testID={`${testID}-preview`}
          >
            <Text
              style={[typography.title, { color: colors.primaryForeground }]}
            >
              {hex}
            </Text>
          </View>
          {sliders.map(s => (
            <View key={s.key} style={{ gap: spacing.xs }}>
              <View style={styles.row}>
                <Text
                  style={[
                    typography.caption,
                    styles.flex,
                    { color: colors.textSecondary },
                  ]}
                >
                  {s.label}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {`${hsl[s.key]}${s.unit}`}
                </Text>
              </View>
              {s.key === 'h' ? (
                <View
                  style={[styles.strip, { borderRadius: radius.pill }]}
                  pointerEvents="none"
                >
                  {HUE_STRIP.map(h => (
                    <View
                      key={h}
                      style={[
                        styles.flex,
                        { backgroundColor: hslToHex({ h, s: 80, l: 50 }) },
                      ]}
                    />
                  ))}
                </View>
              ) : null}
              <Slider
                value={hsl[s.key]}
                min={0}
                max={s.max}
                step={1}
                onChange={v => update({ [s.key]: v })}
                accessibilityLabel={s.label}
                accessibilityValueText={`${hsl[s.key]}${s.unit}`}
                testID={`${testID}-${s.key}`}
              />
            </View>
          ))}
          <TextField
            label={t('life.customColorHex')}
            placeholder="#7C3AED"
            value={hexText}
            onChangeText={onHexChange}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            error={hexError}
            testID={`${testID}-hex`}
          />
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Button
              variant="ghost"
              size="sm"
              label={t('life.cancel')}
              onPress={onClose}
              style={styles.flex}
              testID={`${testID}-cancel`}
            />
            <Button
              size="sm"
              label={t('life.save')}
              onPress={() => onSave(hex)}
              style={styles.flex}
              testID={`${testID}-save`}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center' },
  sheet: { maxWidth: 420, width: '100%', alignSelf: 'center' },
  preview: { height: 64, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  strip: { flexDirection: 'row', height: 8, overflow: 'hidden' },
});
