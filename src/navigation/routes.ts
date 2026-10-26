/**
 * Typed route names. Screens and the drawer reference these constants rather
 * than string literals so a rename is a compile error, not a runtime one.
 */
export const ROUTES = {
  AUTH: 'Auth',
  LOGIN: 'Login',
  MAIN: 'Main',
  DASHBOARD: 'Dashboard',
  SETTINGS: 'Settings',
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];
