import type { NavigatorScreenParams } from '@react-navigation/native';

/** Pre-auth stack. */
export type AuthStackParamList = {
  Login: undefined;
};

/**
 * Which extraction the review screen opens: a saved one by id, or the latest
 * capture of this session (also the target of the floating button's
 * long-press deep link, rnboilerplate://capture/latest).
 */
export type ExtractedTextParams =
  | { source: 'latest' }
  | { source: 'history'; id: string };

/**
 * Main stack: the home dashboard behind a side drawer, with further screens
 * pushed on top of it.
 */
export type MainStackParamList = {
  Dashboard: undefined;
  /** Expense Tracker — the app's start screen; `tab` opens a section directly. */
  ExpenseTracker:
    | { tab?: 'overview' | 'add' | 'history' | 'analytics' }
    | undefined;
  ExtractedText: ExtractedTextParams;
  FileManagement: undefined;
  /** Manage Life; `tab` opens a section directly. */
  ManageLife:
    | {
        tab?:
          | 'dashboard'
          | 'projects'
          | 'today'
          | 'calendar'
          | 'history'
          | 'insights';
      }
    | undefined;
  LifeProject: { projectId: string };
  /** No projectId = new project. */
  LifeProjectForm: { projectId?: string };
  /** No taskId = new task in projectId. */
  LifeTaskForm: { projectId: string; taskId?: string };
  /** One task's details, calendar and chart. */
  LifeTask: { taskId: string };
  Reminders: undefined;
  /** No reminderId = new reminder (on [date] when given). */
  ReminderForm: { reminderId?: string; date?: string } | undefined;
  PhotoWidgets: undefined;
  PhotoWidgetEdit: { widgetId: string };
  /** Follow Up; `view` opens a list directly (e.g. from a reminder). */
  FollowUp:
    | { view?: 'pending' | 'today' | 'overdue' | 'upcoming' | 'done' | 'all' }
    | undefined;
  FollowUpContact: { contactId: string };
  /** No contactId = new contact. */
  FollowUpContactForm: { contactId?: string };
  Utility: undefined;
  UtilityCompass: undefined;
  UtilityScanner: undefined;
  UtilityDocuments: undefined;
  UtilityDocument: { documentId: string };
  UtilityWaterEject: undefined;
  UtilityMeasure: undefined;
  UtilityStopwatch: undefined;
  UtilityTimer: undefined;
  /** No timerId = new timer. */
  UtilityTimerEdit: { timerId?: string } | undefined;
  UtilityLevel: undefined;
  UtilityConverter: undefined;
  UtilityRecorder: undefined;
  /** `filter` opens a library tab directly (e.g. interrupted sessions). */
  UtilityRecordings:
    | {
        filter?:
          | 'all'
          | 'screenshots'
          | 'videos'
          | 'audio'
          | 'processing'
          | 'interrupted'
          | 'failed';
      }
    | undefined;
  UtilityRecording: { recordingId: string };
  /** Network Inspector: capture toggle, domains, privacy settings. */
  NetworkInspector: undefined;
  /** In-app browser with network capture; `url` is an http(s) address. */
  NetworkBrowser: { url: string };
  NetworkCalls: undefined;
  NetworkCall: { callId: string };
  /** Remote Access: connect, this phone, history; `tab` opens a section directly. */
  RemoteAccess: { tab?: 'connect' | 'phone' | 'history' } | undefined;
  /** The open remote session's screen (full screen). */
  RemoteViewer: undefined;
  UtilityYouTube: undefined;
  /** `tab` opens a Settings tab directly (e.g. from File Management). */
  Settings:
    | { tab?: 'general' | 'ocr' | 'files' | 'followup' | 'recording' | 'remote' }
    | undefined;
  Appearance: undefined;
  About: undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: undefined;
  Main: NavigatorScreenParams<MainStackParamList>;
};

// A global root param list gives `useNavigation()` full inference without a
// per-call generic.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList, MainStackParamList {}
  }
}
