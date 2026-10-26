import React, { type PropsWithChildren } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

type ScreenContainerProps = PropsWithChildren<{
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  // Which screen edges should respect the device safe area. Defaults to none
  // because most screens are either stack screens with a navigation header
  // (which handles the top inset itself) or render their own top bar. Tab
  // screens without a header (Activity, Profile) opt in with `['top']`.
  edges?: Edge[];
}>;

const DEFAULT_EDGES: Edge[] = [];

// Wraps content in a safe-area-aware view. Anything that lays out from the
// screen edges (titles, buttons, tab bars) needs this so it doesn't collide
// with the status bar above or the navigation bar below.
export function ScreenContainer({
  children,
  scroll = false,
  style,
  edges = DEFAULT_EDGES,
}: ScreenContainerProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  // Only set the safe-area keys for the edges that opted in. Writing zeros
  // for the others would win against the `paddingHorizontal` / `paddingVertical`
  // set below (more-specific side keys override the shorthand in RN's style
  // resolution) and silently wipe out the screen's edge margin.
  const safeAreaPadding: ViewStyle = {
    ...(edges.includes('top') && { paddingTop: insets.top }),
    ...(edges.includes('bottom') && { paddingBottom: insets.bottom }),
    ...(edges.includes('left') && { paddingLeft: insets.left }),
    ...(edges.includes('right') && { paddingRight: insets.right }),
  };

  // App-wide screen edges: horizontal margin is the "screen padding" the
  // design system enforces on every page, vertical stays lighter. Screens
  // that need edge-to-edge (camera, keypad) opt out via `style={{ padding: 0 }}`
  // and re-apply the same values on their inner ScrollView/FlatList.
  const screenPadding: ViewStyle = {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  };

  if (scroll) {
    return (
      <ScrollView
        style={[
          styles.flex,
          { backgroundColor: colors.background },
          safeAreaPadding,
        ]}
        contentContainerStyle={[screenPadding, style]}
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View
      style={[
        styles.flex,
        { backgroundColor: colors.background },
        screenPadding,
        safeAreaPadding,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
