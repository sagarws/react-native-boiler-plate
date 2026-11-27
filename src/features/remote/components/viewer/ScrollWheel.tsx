import React, { useEffect, useMemo, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

/*
 * A mouse scroll wheel for the remote screen: ▲ / ▼ scroll a step (hold to
 * keep scrolling), and the strip between them scrolls as the finger drags
 * along it (down = scroll down, like turning a wheel). Sends pixel deltas;
 * positive dy scrolls down.
 */

const STEP = 100;
const REPEAT_MS = 70;
const REPEAT_STEP = 60;
const DRAG_FACTOR = 3;

export interface ScrollWheelProps {
  onScroll: (dy: number) => void;
  top: number;
}

function ArrowButton({
  label,
  dir,
  onScroll,
}: {
  label: string;
  dir: 1 | -1;
  onScroll: (dy: number) => void;
}) {
  const { colors, typography } = useTheme();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dir < 0 ? 'Scroll up' : 'Scroll down'}
      onPressIn={() => {
        onScroll(dir * STEP);
        stop();
        timer.current = setInterval(
          () => onScroll(dir * REPEAT_STEP),
          REPEAT_MS,
        );
      }}
      onPressOut={stop}
      hitSlop={6}
      style={({ pressed }) => [
        styles.arrow,
        { backgroundColor: pressed ? colors.primary : 'transparent' },
      ]}
    >
      <Text style={[typography.h2, { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function ScrollWheel({ onScroll, top }: ScrollWheelProps) {
  const { colors, radius } = useTheme();
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  const lastY = useRef(0);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: e => {
          lastY.current = e.nativeEvent.pageY;
        },
        onPanResponderMove: e => {
          const y = e.nativeEvent.pageY;
          const dy = y - lastY.current;
          lastY.current = y;
          if (Math.abs(dy) >= 1) onScrollRef.current(dy * DRAG_FACTOR);
        },
      }),
    [],
  );

  return (
    <View
      style={[
        styles.wheel,
        { top, backgroundColor: colors.overlay, borderRadius: radius.xl },
      ]}
      testID="remote-scroll-wheel"
    >
      <ArrowButton label="▲" dir={-1} onScroll={onScroll} />
      <View
        {...responder.panHandlers}
        style={styles.strip}
        accessibilityLabel="Drag to scroll"
      >
        {[0, 1, 2, 3, 4, 5].map(i => (
          <View
            key={i}
            style={[styles.groove, { backgroundColor: colors.onPrimary }]}
          />
        ))}
      </View>
      <ArrowButton label="▼" dir={1} onScroll={onScroll} />
    </View>
  );
}

const styles = StyleSheet.create({
  wheel: {
    position: 'absolute',
    left: 8,
    width: 48,
    alignItems: 'center',
    paddingVertical: 4,
  },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    width: 44,
    height: 140,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 8,
  },
  groove: { width: 22, height: 2, borderRadius: 1, opacity: 0.6 },
});
