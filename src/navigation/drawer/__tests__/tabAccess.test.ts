import Config from 'react-native-config';
import {
  checkTabAccessPassword,
  cleanTabAccess,
  DEFAULT_TAB_ACCESS,
  firstTab,
  tabAccessStore,
} from '../tabAccess';

describe('tab access', () => {
  beforeEach(() => tabAccessStore.resetCacheForTest());

  it('shows Expense Tracker, OCR, 8D Audio Studio and Settings by default', () => {
    const on = Object.entries(DEFAULT_TAB_ACCESS)
      .filter(([, v]) => v)
      .map(([k]) => k);
    expect(on).toEqual([
      'ExpenseTracker',
      'Dashboard',
      'AudioStudio',
      'Settings',
    ]);
  });

  it('keeps stored booleans and defaults the rest', () => {
    const a = cleanTabAccess({ Utility: true, Settings: 'yes', Bogus: true });
    expect(a.Utility).toBe(true);
    expect(a.Settings).toBe(true);
    expect('Bogus' in a).toBe(false);
    expect(cleanTabAccess(null)).toEqual(DEFAULT_TAB_ACCESS);
  });

  it('saves a change and opens on the first tab still on', () => {
    tabAccessStore.set('ExpenseTracker', false);
    expect(tabAccessStore.read().ExpenseTracker).toBe(false);
    tabAccessStore.resetCacheForTest();
    expect(tabAccessStore.read().ExpenseTracker).toBe(false);
    expect(firstTab()).toBe('Dashboard');
    tabAccessStore.set('ExpenseTracker', true);
  });

  it('checks the password and locks after 5 wrong tries', () => {
    (Config as Record<string, string>).FEATURE_ACCESS_PASSWORD = 'secret12';
    const t0 = 1_000_000;
    expect(checkTabAccessPassword('secret12', t0)).toEqual({ ok: true });
    for (let i = 0; i < 4; i++)
      expect(checkTabAccessPassword('nope', t0)).toMatchObject({
        reason: 'wrong',
      });
    checkTabAccessPassword('nope', t0);
    expect(checkTabAccessPassword('secret12', t0 + 1000)).toMatchObject({
      reason: 'locked',
    });
    expect(checkTabAccessPassword('secret12', t0 + 31_000)).toEqual({
      ok: true,
    });
  });
});
