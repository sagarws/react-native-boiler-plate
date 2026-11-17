import path from 'path';
import dotenv from 'dotenv';

/**
 * Loads env files once. `.env.development.local` (gitignored) wins over `.env`.
 * dotenv never overrides variables already set in the process environment.
 */
let loaded = false;
export const loadEnv = (): void => {
  if (loaded) return;
  loaded = true;
  const root = path.resolve(__dirname, '..', '..', ...(__dirname.includes(`${path.sep}dist${path.sep}`) ? ['..'] : []));
  dotenv.config({ path: path.join(root, '.env.development.local') });
  dotenv.config({ path: path.join(root, '.env') });
};
