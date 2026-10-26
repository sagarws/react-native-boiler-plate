import React from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { FEATURES } from '@/config';
import { OnboardingScreen, useOnboardingComplete } from '@/features/onboarding';
import { useSession } from '@/features/session';
import { useTheme } from '@/theme';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import { linking } from './linking';
import { ROUTES } from './routes';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { scheme, colors } = useTheme();
  const session = useSession();
  const onboarded = useOnboardingComplete();
  const signedIn = !FEATURES.auth || session != null;

  // Feed the app's own tokens to React Navigation so headers, card
  // backgrounds and transitions match the rest of the UI.
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme: NavTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
      notification: colors.error,
    },
  };

  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      {/* Swapping whole subtrees means finishing onboarding (or signing out,
          when auth is on) cannot leave a stale screen mounted behind. */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!signedIn ? (
          <Stack.Screen name={ROUTES.AUTH} component={AuthNavigator} />
        ) : !onboarded ? (
          <Stack.Screen name={ROUTES.ONBOARDING} component={OnboardingScreen} />
        ) : (
          <Stack.Screen name={ROUTES.MAIN} component={MainNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
