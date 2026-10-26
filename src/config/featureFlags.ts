/**
 * Parts of the UI that can be switched off per build.
 *
 * Typed as plain booleans rather than literals so the disabled branches stay
 * live code: they keep compiling and being type-checked, and turning one back
 * on is a one-line change rather than an archaeology exercise.
 */
export const FEATURES: {
  /** In-app language picker in Settings. */
  languageSetting: boolean;
  /**
   * The gear on the login screen, and with it the API-endpoint override.
   * Hidden means the app always uses the built-in `API_BASE_URL`.
   * Switch off for store builds.
   */
  loginDevSettings: boolean;
} = {
  languageSetting: true,
  loginDevSettings: true,
};
