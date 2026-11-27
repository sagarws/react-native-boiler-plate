import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ExtractedTextScreen } from '@/features/capture';
import {
  PhotoWidgetEditScreen,
  PhotoWidgetsScreen,
} from '@/features/photoWidget';
import { ReminderFormScreen, RemindersScreen } from '@/features/reminders';
import { DashboardScreen } from '@/features/dashboard';
import { ExpenseTrackerScreen } from '@/features/expense';
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
  TaskDetailScreen,
  TaskFormScreen,
} from '@/features/life';
import {
  NetworkBrowserScreen,
  NetworkCallDetailScreen,
  NetworkCallsScreen,
  NetworkInspectorScreen,
} from '@/features/network';
import { AudioStudioScreen } from '@/features/audioStudio';
import { LiveCameraScreen } from '@/features/liveCamera';
import { RemoteAccessScreen, RemoteViewerScreen } from '@/features/remote';
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
  StopwatchScreen,
  TimerScreen,
  TimerEditScreen,
  LevelScreen,
  ConverterScreen,
  UtilityHubScreen,
  YouTubeDownloadScreen,
  WaterEjectScreen,
} from '@/features/utility';
import { DrawerHost } from './drawer';
import { firstTab } from './drawer/tabAccess';
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
        // The first side-menu tab that is switched on (Expense Tracker by
        // default); see drawer/tabAccess.ts.
        initialRouteName={firstTab()}
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        <Stack.Screen
          name={ROUTES.EXPENSE_TRACKER}
          component={ExpenseTrackerScreen}
        />
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
        <Stack.Screen name={ROUTES.LIFE_TASK} component={TaskDetailScreen} />
        <Stack.Screen name={ROUTES.REMINDERS} component={RemindersScreen} />
        <Stack.Screen
          name={ROUTES.REMINDER_FORM}
          component={ReminderFormScreen}
        />
        <Stack.Screen
          name={ROUTES.PHOTO_WIDGETS}
          component={PhotoWidgetsScreen}
        />
        <Stack.Screen
          name={ROUTES.PHOTO_WIDGET_EDIT}
          component={PhotoWidgetEditScreen}
        />
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
          name={ROUTES.UTILITY_STOPWATCH}
          component={StopwatchScreen}
        />
        <Stack.Screen name={ROUTES.UTILITY_TIMER} component={TimerScreen} />
        <Stack.Screen
          name={ROUTES.UTILITY_TIMER_EDIT}
          component={TimerEditScreen}
        />
        <Stack.Screen name={ROUTES.UTILITY_LEVEL} component={LevelScreen} />
        <Stack.Screen
          name={ROUTES.UTILITY_CONVERTER}
          component={ConverterScreen}
        />
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
        <Stack.Screen
          name={ROUTES.NETWORK_INSPECTOR}
          component={NetworkInspectorScreen}
        />
        <Stack.Screen
          name={ROUTES.NETWORK_BROWSER}
          component={NetworkBrowserScreen}
        />
        <Stack.Screen
          name={ROUTES.NETWORK_CALLS}
          component={NetworkCallsScreen}
        />
        <Stack.Screen
          name={ROUTES.NETWORK_CALL}
          component={NetworkCallDetailScreen}
        />
        <Stack.Screen
          name={ROUTES.REMOTE_ACCESS}
          component={RemoteAccessScreen}
        />
        <Stack.Screen name={ROUTES.LIVE_CAMERA} component={LiveCameraScreen} />
        <Stack.Screen
          name={ROUTES.AUDIO_STUDIO}
          component={AudioStudioScreen}
        />
        <Stack.Screen
          name={ROUTES.REMOTE_VIEWER}
          component={RemoteViewerScreen}
          // Full screen, no swipe-back: a stray edge swipe must reach the remote device.
          options={{
            animation: 'fade',
            gestureEnabled: false,
            orientation: 'all',
          }}
        />
        <Stack.Screen
          name={ROUTES.UTILITY_YOUTUBE}
          component={YouTubeDownloadScreen}
        />
        <Stack.Screen name={ROUTES.SETTINGS} component={SettingsScreen} />
        <Stack.Screen name={ROUTES.APPEARANCE} component={AppearanceScreen} />
        <Stack.Screen name={ROUTES.ABOUT} component={AboutScreen} />
      </Stack.Navigator>
    </DrawerHost>
  );
}
