/**
 * Load a .env file when `dotenv` is installed, and do nothing when it is not.
 *
 * `dotenv` is an OPTIONAL peer of this package: Automated-Scripts depends on
 * it, Trackvid-CMS does not. A bare `require("dotenv").config()` at module
 * scope therefore resolves fine on the server and throws MODULE_NOT_FOUND
 * inside the desktop app's app.asar, before a single line of flow code runs.
 *
 * That is not hypothetical — it is exactly how every Myntra claim failed in the
 * packaged Windows build: "Cannot find module 'dotenv'", with a require stack
 * ending at common/db.js line 1.
 *
 * Skipping the file in Electron is correct rather than degraded: the desktop
 * app inlines its configuration at build time and publishes what the core needs
 * onto process.env at startup, so there is no .env on disk to read.
 *
 * Callers keep their own options, so a platform-local .env path still works.
 */
export function loadEnv(options: any): void;
