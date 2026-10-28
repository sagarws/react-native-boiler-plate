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
  SETTINGS: 'Settings',
  APPEARANCE: 'Appearance',
  ABOUT: 'About',
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];
