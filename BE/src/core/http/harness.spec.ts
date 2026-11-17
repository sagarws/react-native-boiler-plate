import { assertWritesAllowed, mask } from '../../../test/contract/harness';

describe('contract harness helpers', () => {
  it('masks nested and wildcard paths', () => {
    expect(mask({ data: { items: [{ id: 1, createdAt: 'x' }, { id: 2, createdAt: 'y' }], token: 't' } }, ['data.token', 'data.items.*.createdAt']))
      .toEqual({ data: { items: [{ id: 1, createdAt: '<masked>' }, { id: 2, createdAt: '<masked>' }], token: '<masked>' } });
  });
  it('refuses write cases without a non-prod CONTRACT_DB', () => {
    const c = { name: 'w', method: 'POST' as const, path: '/x' };
    expect(() => assertWritesAllowed(c, {})).toThrow(/refused/);
    expect(() => assertWritesAllowed(c, { CONTRACT_DB: 'prod' })).toThrow(/refused/);
    expect(() => assertWritesAllowed(c, { CONTRACT_DB: 'dev' })).not.toThrow();
    expect(() => assertWritesAllowed({ ...c, method: 'GET' }, {})).not.toThrow();
  });
});
