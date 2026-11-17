import mongoose from 'mongoose';
import { getMongoDatabaseName } from '@legacy/utils/runtimeGuard';

/**
 * Opens the shared Mongo connection with the same pool/timeouts as legacy `config/db.ts`.
 *
 * Deliberately does NOT call legacy `connectDB()`: that also runs `runMigrations()`,
 * which must only run in one process (legacy) until Phase 6.
 * The legacy CONNECT_MONO_BY_API tunnel is not ported yet (dev-only convenience).
 */
export const assertDatabaseAllowed = (uri: string, env: NodeJS.ProcessEnv = process.env): void => {
  if (!uri) throw new Error('MONGO_URI is not set');
  const db = getMongoDatabaseName(uri);
  if (db === 'prod' && env.ALLOW_PROD_DB !== 'true') {
    throw new Error(
      'MONGO_URI points at the production database. Set ALLOW_PROD_DB=true only on the production host.',
    );
  }
};

export const mongoOptions = (env: NodeJS.ProcessEnv = process.env): mongoose.ConnectOptions => ({
  maxPoolSize: parseInt(env.MONGO_MAX_POOL_SIZE || '10', 10),
  minPoolSize: parseInt(env.MONGO_MIN_POOL_SIZE || '2', 10),
  readPreference: 'secondaryPreferred',
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
  maxIdleTimeMS: 30000,
});

export const connectMongo = async (env: NodeJS.ProcessEnv = process.env): Promise<typeof mongoose> => {
  const uri = env.MONGO_URI;
  assertDatabaseAllowed(uri, env);
  return mongoose.connect(uri, mongoOptions(env));
};
