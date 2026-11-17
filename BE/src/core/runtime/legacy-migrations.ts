/**
 * Legacy `config/db.ts` runs `runMigrations()` after every connect (each legacy process). In full
 * replacement mode the Nest processes take that over. Idempotent: it only runs when no Migration
 * record exists. Not called with LEGACY_BACKGROUND off (legacy processes still do it then).
 */
export const runLegacyMigrations = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runMigrations } = require('@legacy/migrations/migration');
  runMigrations();
};
