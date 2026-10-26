import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet } from 'react-native';
import { images } from '@/shared/assets';
import { hp, useTheme, wp } from '@/theme';

export interface ToggleSwitchProps {
  isOn: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  /** Track colour. Defaults to the brand colour when omitted. */
  trackColor?: string;
}

const TRACK_WIDTH = wp(45);
const TRACK_HEIGHT = hp(26);
const THUMB_SIZE = hp(20);
const PADDING = (TRACK_HEIGHT - THUMB_SIZE) / 2;

/**
 * Two-state switch with the brand glyph riding in the thumb — the control the
 * previous app used to pick Forward vs Return. The glyph mirrors on the off
 * state so the direction it points matches the mode.
 */
export function ToggleSwitch({
  isOn,
  onToggle,
  disabled = false,
  accessibilityLabel,
  trackColor,
}: ToggleSwitchProps) {
  const { colors, radius } = useTheme();
  const progress = useRef(new Animated.Value(isOn ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: isOn ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [isOn, progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TRACK_WIDTH - THUMB_SIZE - PADDING * 2],
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: isOn, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onToggle(!isOn)}
      style={[
        styles.track,
        {
          backgroundColor: trackColor ?? colors.primary,
          borderRadius: radius.pill,
          padding: PADDING,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.thumb,
          {
            backgroundColor: colors.surface,
            borderRadius: radius.pill,
            transform: [{ translateX }],
          },
        ]}
      >
        <Image
          source={images.icon_toggle_switch}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          style={[
            styles.icon,
            { transform: [{ rotateY: isOn ? '0deg' : '180deg' }] },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: TRACK_WIDTH, height: TRACK_HEIGHT, justifyContent: 'center' },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: hp(16), height: hp(16) },
});
