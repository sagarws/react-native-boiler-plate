import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';

const SIZE = 48;
/** Idle: faint, so the remote screen behind it stays readable. */
const IDLE_OPACITY = 0.4;
/** Further than this and a touch is a drag, not a tap. */
const TAP_SLOP = 8;

export interface FloatingToolButtonProps {
  /** The toolbar is open: the button is shown at full strength. */
  active: boolean;
  /** Something needs attention (a warning in the toolbar's status). */
  attention: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * The viewer's tools behind one round button (like AnyDesk's): faint while
 * idle, solid while the toolbar is open, and draggable anywhere on the screen
 * so it never sits on what you are working on.
 */
export function FloatingToolButton({
  active,
  attention,
  onPress,
  accessibilityLabel,
}: FloatingToolButtonProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Starts at the right edge, a third of the way down: clear of the toolbar
  // it opens (top) and of the quick-keys row (bottom).
  const [pos, setPos] = useState({
    x: width - SIZE - 12,
    y: Math.max(insets.top + 120, Math.round(height * 0.35)),
  });
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const posRef = useRef(pos);
  posRef.current = pos;
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  const bounds = useRef({ width, height, insets });
  bounds.current = { width, height, insets };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Never let the remote-screen gestures underneath take the touch.
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: Animated.event([null, { dx: drag.x, dy: drag.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_e, g) => {
          drag.setValue({ x: 0, y: 0 });
          if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) {
            pressRef.current();
            return;
          }
          const b = bounds.current;
          setPos({
            x: Math.min(
              b.width - SIZE - 4,
              Math.max(4, posRef.current.x + g.dx),
            ),
            y: Math.min(
              b.height - SIZE - b.insets.bottom - 4,
              Math.max(b.insets.top + 4, posRef.current.y + g.dy),
            ),
          });
        },
        onPanResponderTerminate: () => drag.setValue({ x: 0, y: 0 }),
      }),
    [drag],
  );

  return (
    <Animated.View
      {...responder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: active }}
      onAccessibilityTap={onPress}
      testID="remote-floating-tools"
      style={[
        styles.button,
        {
          left: pos.x,
          top: pos.y,
          opacity: active ? 1 : IDLE_OPACITY,
          backgroundColor: active ? colors.primary : colors.overlay,
          borderColor: colors.onPrimary,
          transform: drag.getTranslateTransform(),
        },
      ]}
    >
      <Icon
        name={active ? 'x' : 'menu'}
        size={22}
        color={active ? colors.primaryForeground : colors.onPrimary}
      />
      {attention && !active ? (
        <View style={[styles.dot, { backgroundColor: colors.warning }]} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
  },
  dot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
