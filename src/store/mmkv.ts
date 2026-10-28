import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({ id: 'app.default' });

/** Every MMKV key the app uses, in one place so two features can't collide. */
export const StorageKeys = {
  Language: 'app.language',
  Session: 'session.user',
  ThemePreference: 'app.themePreference',
  ThemePreset: 'app.themePreset',
  TypographyPreset: 'app.typographyPreset',
  ApiBaseUrlOverride: 'app.apiBaseUrlOverride',
  CaptureSettings: 'capture.settings',
  CaptureHistory: 'capture.history',
  OnboardingComplete: 'app.onboardingComplete',
  /** File Management: the "Akshar" folder id in each connected Google account's Drive. */
  DriveRootFolders: 'files.driveRootFolders',
  /** Manage Life: schema version + change counter. */
  LifeMeta: 'life.meta',
  LifeProjects: 'life.projects',
  LifeTasks: 'life.tasks',
  LifeReports: 'life.reports',
  LifeReviews: 'life.reviews',
  /** Last AI recommendations (with the data version they were made from). */
  LifeRecommendations: 'life.recommendations',
  /** Follow Up: schema version + change counter. */
  FollowUpMeta: 'followup.meta',
  FollowUpContacts: 'followup.contacts',
  FollowUpActivities: 'followup.activities',
  FollowUpNotes: 'followup.notes',
  /** App-observed timeline entries (dialer/WhatsApp opened, rescheduled). */
  FollowUpEvents: 'followup.events',
  FollowUpCategories: 'followup.categories',
  FollowUpTags: 'followup.tags',
  FollowUpSettings: 'followup.settings',
  /** Utility: QR/barcode scan history. */
  UtilityScans: 'utility.scans',
  /** Utility: saved AR measurements. */
  UtilityMeasurements: 'utility.measurements',
  /** Utility: scanned documents (page files live in app storage). */
  UtilityDocuments: 'utility.documents',
  /** Utility: tool preferences (units, water-eject mode, …). */
  UtilityPrefs: 'utility.prefs',
} as const;
