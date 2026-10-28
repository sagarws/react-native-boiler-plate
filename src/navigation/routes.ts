/**
 * Typed route names. Screens and the drawer reference these constants rather
 * than string literals so a rename is a compile error, not a runtime one.
 */
export const ROUTES = {
  AUTH: 'Auth',
  LOGIN: 'Login',
  ONBOARDING: 'Onboarding',
  MAIN: 'Main',
  DASHBOARD: 'Dashboard',
  EXTRACTED_TEXT: 'ExtractedText',
  FILE_MANAGEMENT: 'FileManagement',
  MANAGE_LIFE: 'ManageLife',
  LIFE_PROJECT: 'LifeProject',
  LIFE_PROJECT_FORM: 'LifeProjectForm',
  LIFE_TASK_FORM: 'LifeTaskForm',
  FOLLOW_UP: 'FollowUp',
  FOLLOW_UP_CONTACT: 'FollowUpContact',
  FOLLOW_UP_CONTACT_FORM: 'FollowUpContactForm',
  UTILITY: 'Utility',
  UTILITY_COMPASS: 'UtilityCompass',
  UTILITY_SCANNER: 'UtilityScanner',
  UTILITY_DOCUMENTS: 'UtilityDocuments',
  UTILITY_DOCUMENT: 'UtilityDocument',
  UTILITY_WATER_EJECT: 'UtilityWaterEject',
  UTILITY_MEASURE: 'UtilityMeasure',
  SETTINGS: 'Settings',
  APPEARANCE: 'Appearance',
  ABOUT: 'About',
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];
