/**
 * Side-effect import that loads the env files. MUST be imported before any legacy module:
 * many legacy modules read process.env at load time (S3 bucket/region, Redis port, queues…),
 * and `import` statements are evaluated before the body of main.ts runs.
 */
import { loadEnv } from './env';

loadEnv();
