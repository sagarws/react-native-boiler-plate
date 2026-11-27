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
  /** Side-menu tabs this phone shows (tab → true/false); see navigation/drawer/tabAccess.ts. */
  TabAccess: 'app.tabAccess',
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
  /** Remote Access: viewer + host preferences. */
  RemoteSettings: 'remote.settings',
  /** 8D Audio Studio: last library scan + imported files. */
  AudioStudioLibrary: 'audioStudio.library',
  /** 8D Audio Studio: liked songs, playlists, recently played. */
  AudioStudioCollections: 'audioStudio.collections',
  /** 8D Audio Studio: DSP settings, custom presets / EQ profiles, player prefs. */
  AudioStudioSettings: 'audioStudio.settings',
  /** 8D Audio Studio: the queue to restore on next launch. */
  AudioStudioSession: 'audioStudio.session',
  /** Share Live Camera: preferences (never the stream password). */
  LiveCameraSettings: 'liveCamera.settings',
  /** Remote Access: this install's Ed25519 identity (the device ID derives from it). */
  RemoteIdentity: 'remote.identity',
  /** Remote Access: saved / recent devices (pinned key fingerprints). */
  RemoteDevices: 'remote.devices',
  /** Remote Access: devices that connected to this phone, and blocked ones. */
  RemotePeers: 'remote.peers',
  /** Remote Access: unattended-password verifier (Argon2id; never the password). */
  RemoteUnattended: 'remote.unattended',
  /** Remote Access: connection history, newest first. */
  RemoteHistory: 'remote.history',
  /** Remote Access: other devices' passwords, sealed with an Android Keystore key (never plain). */
  RemoteSavedPasswords: 'remote.savedPasswords',
} as const;
