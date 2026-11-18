import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({ id: 'app.default' });

/**
 * Network Inspector's captured requests/responses: their own file, so large
 * bodies don't bloat the main store and "Clear all" can't touch other data.
 */
export const networkStorage = new MMKV({ id: 'app.networkInspector' });

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
  /** Utility: stopwatch and countdown timer (timestamps only). */
  UtilityClock: 'utility.clock',
  /** Reminders: every reminder with its alert settings. */
  Reminders: 'reminders.items',
  /** Expense Tracker: schema version (drives migrations). */
  ExpenseMeta: 'expense.meta',
  /** Expense Tracker: the "expenses" table. */
  ExpenseRecords: 'expense.records',
  /** Expense Tracker: the "expense_categories" table (defaults + custom). */
  ExpenseCategories: 'expense.categories',
  /** Expense Tracker: monthly budget and the payment awaiting confirmation. */
  ExpenseSettings: 'expense.settings',
  /** Network Inspector: capture toggle, session, domains, limits (main store). */
  NetworkSettings: 'network.settings',
  /** Network Inspector (networkStorage): ordered call summaries, newest first. */
  NetworkIndex: 'network.index',
  /** Network Inspector (networkStorage): prefix + record id → full record. */
  NetworkRecordPrefix: 'network.record.',
} as const;
