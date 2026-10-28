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
  /** `tab` opens a Settings tab directly (e.g. from File Management). */
  Settings: { tab?: 'general' | 'ocr' | 'files' | 'followup' } | undefined;
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
