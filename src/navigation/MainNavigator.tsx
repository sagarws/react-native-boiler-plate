import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from '@/features/dashboard';
import { SettingsScreen } from '@/features/settings';
import { DrawerHost } from './drawer';
import { ROUTES } from './routes';
import type { MainStackParamList } from './types';

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Signed-in stack. Screens draw their own headers, so the navigator's is off;
 * the drawer wraps the whole stack, which is why it stays mounted across
 * pushes. Register new signed-in screens here and in `types.ts`.
 */
export default function MainNavigator() {
  return (
    <DrawerHost>
      <Stack.Navigator
        initialRouteName={ROUTES.DASHBOARD}
        screenOptions={{ headerShown: false }}>
        <Stack.Screen name={ROUTES.DASHBOARD} component={DashboardScreen} />
        <Stack.Screen name={ROUTES.SETTINGS} component={SettingsScreen} />
      </Stack.Navigator>
    </DrawerHost>
  );
}
