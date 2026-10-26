import React from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSession } from '@/features/session';
import { useTheme } from '@/theme';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import { ROUTES } from './routes';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { scheme, colors } = useTheme();
  const session = useSession();

  // Feed the app's own tokens to React Navigation so headers, card
  // backgrounds and the tab bar match the rest of the UI.
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme: NavTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      {/* Swapping the whole subtree on auth state means a sign-out cannot
          leave a signed-in screen mounted behind the login form. */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <Stack.Screen name={ROUTES.MAIN} component={MainNavigator} />
        ) : (
          <Stack.Screen name={ROUTES.AUTH} component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
