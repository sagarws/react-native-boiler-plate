import { createRequire } from 'node:module'

/**
 * Loads a module from @trackvid/automation-core at runtime.
 *
 * Lazy on purpose: a flow pulls in axios, form-data and its platform's helpers,
 * and a machine that never files a Snapdeal claim should not pay for Snapdeal's
 * dependencies at startup.
 *
 * `createRequire` rather than a bare `require()` because this file is ESM at
 * author time and bundled to CJS — the lint rule that bans `require()` is right
 * about imports, and this is a deliberate runtime load.
 *
 * The subpath must be a string literal at each call site, never built from a
 * variable: the Electron main process is bundled, and a bundler cannot follow a
 * computed require.
 */
const load = createRequire(import.meta.url)

export const loadCore = <T>(subpath: string): T => load(`@trackvid/automation-core/${subpath}`) as T
