import { assertDatabaseAllowed, mongoOptions } from './mongo';

describe('assertDatabaseAllowed', () => {
  it('refuses the prod database without ALLOW_PROD_DB', () => {
    expect(() => assertDatabaseAllowed('mongodb+srv://u:p@c.x.net/prod?retryWrites=true', {})).toThrow(/production/);
  });
  it('allows prod only with ALLOW_PROD_DB=true', () => {
    expect(() => assertDatabaseAllowed('mongodb+srv://u:p@c.x.net/prod', { ALLOW_PROD_DB: 'true' })).not.toThrow();
  });
  it('allows dev', () => {
    expect(() => assertDatabaseAllowed('mongodb+srv://u:p@c.x.net/dev', {})).not.toThrow();
  });
  it('throws when MONGO_URI is missing', () => {
    expect(() => assertDatabaseAllowed(undefined as any, {})).toThrow(/MONGO_URI/);
  });
  it('uses legacy pool defaults', () => {
    expect(mongoOptions({})).toMatchObject({ maxPoolSize: 10, minPoolSize: 2, readPreference: 'secondaryPreferred' });
  });
});
