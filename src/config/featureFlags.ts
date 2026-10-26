/**
 * Parts of the UI that can be switched off per build.
 *
 * Typed as plain booleans rather than literals so the disabled branches stay
 * live code: they keep compiling and being type-checked, and turning one back
 * on is a one-line change rather than an archaeology exercise.
 */
export const FEATURES: {
  /**
   * Login → session gate from the boilerplate. Off: the OCR app is
   * credential-free and opens straight to onboarding / home. The auth and
   * session features stay in the codebase for apps that need them.
   */
  auth: boolean;
  /**
   * In-app UI language picker in Settings. Off while English is the only UI
   * translation — and to keep it from being confused with the OCR language.
   */
  languageSetting: boolean;
  /**
   * The gear on the login screen, and with it the API-endpoint override.
   * Only reachable when `auth` is on.
   */
  loginDevSettings: boolean;
} = {
  auth: false,
  languageSetting: false,
  loginDevSettings: false,
};
