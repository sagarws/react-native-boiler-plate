import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, zIndex } from '@/theme';
import { CustomDrawer } from './CustomDrawer';
import { DrawerContext, type DrawerControls } from './DrawerContext';

/** Matches React Navigation's default drawer width so the panel sits where
 *  users expect it. */
function drawerWidth(): number {
  const { width, height } = Dimensions.get('window');
  const shortest = Math.min(width, height);
  return Math.min(shortest - 56, shortest >= 600 ? 320 : 280);
}

/**
 * Slide-in side panel hosting `CustomDrawer`.
 *
 * Opens only from a button (no edge swipe). An animated overlay gives that
 * behaviour without adding the gesture-handler and reanimated native
 * dependencies a drawer navigator would require.
 */
export function DrawerHost({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  // Kept mounted through the close animation so the panel slides out rather
  // than vanishing.
  const [isMounted, setIsMounted] = useState(false);
  const width = useMemo(drawerWidth, []);
  const progress = useRef(new Animated.Value(0)).current;

  const openDrawer = useCallback(() => {
    setIsMounted(true);
    setIsOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (isOpen) setIsMounted(true);
    const animation = Animated.timing(progress, {
      toValue: isOpen ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !isOpen) setIsMounted(false);
    });
    return () => animation.stop();
  }, [isOpen, progress]);

  // An open drawer owns the back button, exactly as a drawer navigator would.
  useEffect(() => {
    if (!isOpen) return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setIsOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [isOpen]);

  const controls = useMemo<DrawerControls>(
    () => ({ isOpen, openDrawer, closeDrawer }),
    [closeDrawer, isOpen, openDrawer],
  );

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, 0],
  });

  return (
    <DrawerContext.Provider value={controls}>
      <View style={styles.flex}>
        {children}
        {isMounted ? (
          <>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                styles.scrim,
                { backgroundColor: colors.scrim, opacity: progress },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                style={styles.flex}
                onPress={closeDrawer}
              />
            </Animated.View>
            <Animated.View
              style={[styles.panel, { width, transform: [{ translateX }] }]}
            >
              <CustomDrawer />
            </Animated.View>
          </>
        ) : null}
      </View>
    </DrawerContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { zIndex: zIndex.overlay },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: zIndex.modal,
  },
});
