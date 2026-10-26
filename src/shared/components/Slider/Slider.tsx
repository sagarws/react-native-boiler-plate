import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '@/theme';
import { styles, THUMB_SIZE } from './Slider.styles';
import type { SliderProps } from './Slider.types';

/**
 * Stepped slider built on `PanResponder`.
 *
 * Hand-rolled rather than pulling in `@react-native-community/slider`: that
 * package is a native module, so adding it costs a rebuild and a platform
 * dependency for one control, and its stock appearance would not take the
 * theme tokens. This is small enough that owning it is cheaper than owning the
 * integration.
 *
 * Gestures are read from `locationX`, which is already relative to the track,
 * so the control needs no page-coordinate measurement and works unchanged
 * inside a scrolling parent.
 */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  accessibilityLabel,
  accessibilityValueText,
  disabled = false,
  testID,
}: SliderProps) {
  const { colors, radius } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  // The responder is created once and outlives every re-render, so everything
  // it reads lives in refs; closing over props directly would freeze it on the
  // first render's values.
  const width = useRef(0);
  const behaviour = useRef({ value, min, max, step, onChange, disabled });
  useEffect(() => {
    behaviour.current = { value, min, max, step, onChange, disabled };
  });

  const emit = useRef((x: number) => {
    const current = behaviour.current;
    if (current.disabled || width.current <= 0) return;
    const ratio = Math.min(1, Math.max(0, x / width.current));
    const raw = current.min + ratio * (current.max - current.min);
    const snapped = Math.round(raw / current.step) * current.step;
    const next = Math.min(current.max, Math.max(current.min, snapped));
    // A drag crosses many pixels per step; only the crossings are worth
    // reporting, and the caller persists on every call.
    if (next !== current.value) current.onChange(next);
  }).current;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !behaviour.current.disabled,
      onMoveShouldSetPanResponder: () => !behaviour.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => emit(event.nativeEvent.locationX),
      onPanResponderMove: event => emit(event.nativeEvent.locationX),
    }),
  ).current;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    width.current = next;
    setTrackWidth(next);
  };

  const span = max - min;
  const ratio = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
  const fillWidth = trackWidth * ratio;

  const nudge = (direction: 1 | -1) => {
    if (disabled) return;
    const next = Math.min(max, Math.max(min, value + direction * step));
    if (next !== value) onChange(next);
  };

  return (
    <View
      style={[styles.container, { opacity: disabled ? 0.5 : 1 }]}
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      accessibilityValue={{
        min,
        max,
        now: value,
        text: accessibilityValueText,
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'increment') nudge(1);
        if (event.nativeEvent.actionName === 'decrement') nudge(-1);
      }}
    >
      <View
        onLayout={onLayout}
        {...responder.panHandlers}
        style={[
          styles.track,
          { backgroundColor: colors.lightGrey, borderRadius: radius.pill },
        ]}
      >
        <View
          style={[
            styles.fill,
            {
              width: fillWidth,
              backgroundColor: colors.primary,
              borderRadius: radius.pill,
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: fillWidth - THUMB_SIZE / 2,
              backgroundColor: colors.surface,
              borderColor: colors.primary,
              borderRadius: radius.pill,
            },
          ]}
        />
      </View>
    </View>
  );
}
