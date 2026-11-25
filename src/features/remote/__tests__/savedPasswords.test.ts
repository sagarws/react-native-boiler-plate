import { storage, StorageKeys } from '@/store/mmkv';
import { SavedPasswords, type SecretBox } from '../services/savedPasswords';

/** Reversible stand-in for the Keystore box; records what it was given. */
const box = (available = true): SecretBox & { sealed: string[] } => {
  const sealed: string[] = [];
  return {
    sealed,
    available,
    seal: async plain => {
      sealed.push(plain);
      return `sealed:${[...plain].reverse().join('')}`;
    },
    open: async value => {
      if (!value.startsWith('sealed:')) throw new Error('tampered');
      return [...value.slice(7)].reverse().join('');
    },
  };
};

beforeEach(() => storage.delete(StorageKeys.RemoteSavedPasswords));

describe('SavedPasswords', () => {
  it('saves sealed, never in plain text, and opens it again by device ID', async () => {
    const store = new SavedPasswords(box());
    expect(await store.save('0064 5969', 'Secret-Pass-1')).toBe(true);
    const raw = storage.getString(StorageKeys.RemoteSavedPasswords) ?? '';
    expect(raw).not.toContain('Secret-Pass-1');
    expect(store.has('00645969')).toBe(true);
    expect(store.ids()).toEqual(['00645969']);
    expect(await store.get('00645969')).toBe('Secret-Pass-1');
  });

  it('saves nothing when secure storage is not available', async () => {
    const store = new SavedPasswords(box(false));
    expect(await store.save('00645969', 'pw')).toBe(false);
    expect(store.ids()).toEqual([]);
    expect(await store.get('00645969')).toBeNull();
  });

  it('refuses bad IDs and empty passwords', async () => {
    const store = new SavedPasswords(box());
    expect(await store.save('not-an-id', 'pw')).toBe(false);
    expect(await store.save('00645969', '')).toBe(false);
    expect(store.ids()).toEqual([]);
  });

  it('drops an entry that can no longer be opened', async () => {
    storage.set(
      StorageKeys.RemoteSavedPasswords,
      JSON.stringify({ '00645969': { sealed: 'garbage', at: 1 } }),
    );
    const store = new SavedPasswords(box());
    expect(await store.get('00645969')).toBeNull();
    expect(store.has('00645969')).toBe(false);
  });

  it('forgets one, forgets all, and keeps the newest when full', async () => {
    const store = new SavedPasswords(box());
    await store.save('11111111', 'a');
    await store.save('22222222', 'b');
    store.forget('11111111');
    expect(store.ids()).toEqual(['22222222']);
    store.forgetAll();
    expect(store.ids()).toEqual([]);
    const now = jest.spyOn(Date, 'now');
    for (let i = 0; i < 55; i++) {
      now.mockReturnValue(1000 + i);
      await store.save(String(10_000_000 + i), `pw${i}`);
    }
    now.mockRestore();
    const ids = store.ids();
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('10000054');
    expect(ids).not.toContain('10000000');
  });

  it('ignores damaged storage', () => {
    storage.set(StorageKeys.RemoteSavedPasswords, '{not json');
    expect(new SavedPasswords(box()).ids()).toEqual([]);
  });
});
