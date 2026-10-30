import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ExtractedTextScreen } from '@/features/capture';
import { DashboardScreen } from '@/features/dashboard';
import { FileManagementScreen } from '@/features/files';
import {
  ContactDetailScreen,
  ContactFormScreen,
  FollowUpScreen,
} from '@/features/followup';
import {
  ManageLifeScreen,
  ProjectDetailScreen,
  ProjectFormScreen,
  TaskFormScreen,
} from '@/features/life';
import {
  AboutScreen,
  AppearanceScreen,
  SettingsScreen,
} from '@/features/settings';
import {
  CompassScreen,
  DocumentScreen,
  DocumentsScreen,
  RecorderScreen,
  RecordingDetailScreen,
  RecordingsScreen,
  MeasureScreen,
  ScannerScreen,
  UtilityHubScreen,
  WaterEjectScreen,
} from '@/features/utility';
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
        <Stack.Screen name={ROUTES.MANAGE_LIFE} component={ManageLifeScreen} />
        <Stack.Screen
          name={ROUTES.LIFE_PROJECT}
          component={ProjectDetailScreen}
        />
        <Stack.Screen
          name={ROUTES.LIFE_PROJECT_FORM}
          component={ProjectFormScreen}
        />
        <Stack.Screen name={ROUTES.LIFE_TASK_FORM} component={TaskFormScreen} />
        <Stack.Screen name={ROUTES.FOLLOW_UP} component={FollowUpScreen} />
        <Stack.Screen
          name={ROUTES.FOLLOW_UP_CONTACT}
          component={ContactDetailScreen}
        />
        <Stack.Screen
          name={ROUTES.FOLLOW_UP_CONTACT_FORM}
          component={ContactFormScreen}
        />
        <Stack.Screen name={ROUTES.UTILITY} component={UtilityHubScreen} />
        <Stack.Screen name={ROUTES.UTILITY_COMPASS} component={CompassScreen} />
        <Stack.Screen name={ROUTES.UTILITY_SCANNER} component={ScannerScreen} />
        <Stack.Screen
          name={ROUTES.UTILITY_DOCUMENTS}
          component={DocumentsScreen}
        />
        <Stack.Screen
          name={ROUTES.UTILITY_DOCUMENT}
          component={DocumentScreen}
        />
        <Stack.Screen
          name={ROUTES.UTILITY_WATER_EJECT}
          component={WaterEjectScreen}
        />
        <Stack.Screen name={ROUTES.UTILITY_MEASURE} component={MeasureScreen} />
        <Stack.Screen
          name={ROUTES.UTILITY_RECORDER}
          component={RecorderScreen}
        />
        <Stack.Screen
          name={ROUTES.UTILITY_RECORDINGS}
          component={RecordingsScreen}
        />
        <Stack.Screen
          name={ROUTES.UTILITY_RECORDING}
          component={RecordingDetailScreen}
        />
        <Stack.Screen name={ROUTES.SETTINGS} component={SettingsScreen} />
        <Stack.Screen name={ROUTES.APPEARANCE} component={AppearanceScreen} />
        <Stack.Screen name={ROUTES.ABOUT} component={AboutScreen} />
      </Stack.Navigator>
    </DrawerHost>
  );
}
