/// <reference types="vite/client" />

/**
 * Renderer build-time configuration. electron-vite exposes `.env` keys prefixed
 * with RENDERER_VITE_ (and VITE_) here and inlines them at build time.
 */
interface ImportMetaEnv {
  /**
   * Login prefill, read only under `import.meta.env.DEV` — see LoginPage.
   *
   * Vite inlines whatever is here at build time, so anything read outside that
   * guard ships as a literal string inside app.asar. A password read here
   * unguarded is a published password.
   */
  readonly RENDERER_VITE_LOGIN_EMAIL?: string
  readonly RENDERER_VITE_LOGIN_PASSWORD?: string
}

/**
 * `IMPERSON_LOGIN=true` in .env — this build offers "sign in as a user id".
 * Inlined at build time by electron.vite.config.ts; false when unset.
 */
declare const __IMPERSON_LOGIN__: boolean

/**
 * `AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS=true` in .env — a running process
 * re-captures an expired login on an auto-login platform and carries on.
 * Inlined at build time by electron.vite.config.ts; false when unset.
 */
declare const __AUTO_SESSION_CAPTURE__: boolean

/**
 * The core's MAX_CLAIM_ATTEMPTS, inlined at build time (electron.vite.config.ts):
 * "unlimited", a number, or whatever was written there. Read only through
 * `claimAttemptLimit` in shared/constants/claims.ts.
 */
declare const __MAX_CLAIM_ATTEMPTS__: unknown
