import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ExtractedTextScreen } from '@/features/capture';
import { DashboardScreen } from '@/features/dashboard';
import { FileManagementScreen } from '@/features/files';
import {
  AboutScreen,
  AppearanceScreen,
  SettingsScreen,
} from '@/features/settings';
import { DrawerHost } from './drawer';
import { ROUTES } from './routes';
import type { MainStackParamList } from './types';

const Stack = createNativeStackNavigator<MainStackParamList>();

/**
 * Main stack. Screens draw their own headers, so the navigator's is off; the
 * drawer wraps the whole stack, which is why it stays mounted across pushes.
 * Register new screens here and in `types.ts`.
 */
export default function MainNavigator() {
  return (
    <DrawerHost>
      <Stack.Navigator
        initialRouteName={ROUTES.DASHBOARD}
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        <Stack.Screen name={ROUTES.DASHBOARD} component={DashboardScreen} />
        <Stack.Screen
          name={ROUTES.EXTRACTED_TEXT}
          component={ExtractedTextScreen}
        />
        <Stack.Screen
          name={ROUTES.FILE_MANAGEMENT}
          component={FileManagementScreen}
        />
        <Stack.Screen name={ROUTES.SETTINGS} component={SettingsScreen} />
        <Stack.Screen name={ROUTES.APPEARANCE} component={AppearanceScreen} />
        <Stack.Screen name={ROUTES.ABOUT} component={AboutScreen} />
      </Stack.Navigator>
    </DrawerHost>
  );
}
