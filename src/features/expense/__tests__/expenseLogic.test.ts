import { storage, StorageKeys } from '@/store/mmkv';
import {
  budgetState,
  byCategory,
  byMethod,
  dailySeries,
  inRange,
  monthlySeries,
  summarize,
  weeklySeries,
  weekStart,
} from '../services/analytics';
import {
  applyFilters,
  countActiveFilters,
  EMPTY_FILTERS,
} from '../services/filters';
import { buildUpiUri, parseUpiQr, parseUpiResponse } from '../services/upi';
import { expenseStore, SCHEMA_VERSION } from '../store/expense.store';
import type { Expense, ExpenseInput } from '../types';
import {
  formatInr,
  parseAmount,
  toAmountInput,
  toUpiAmount,
} from '../utils/money';
import { draftErrors, emptyDraft, toInput } from '../hooks/useExpenseForm';

const NOW = new Date(2026, 10, 9, 15, 0); // Mon 9 Nov 2026, 15:00 local

function input(patch: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    amount: 25_000,
    categoryId: 'food',
    description: 'Lunch',
    paymentMethod: 'upi',
    status: 'paid',
    transactionDate: NOW.toISOString(),
    ...patch,
  };
}

function expense(patch: Partial<Expense> = {}): Expense {
  return {
    id: Math.random().toString(36).slice(2),
    amount: 10_000,
    categoryId: 'food',
    description: '',
    merchantName: '',
    merchantUpiId: '',
    paymentMethod: 'upi',
    status: 'paid',
    transactionDate: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...patch,
  };
}

const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h).toISOString();

beforeEach(() => {
  storage.clearAll();
  expenseStore.resetCacheForTest();
});

describe('money', () => {
  it('parses typed amounts into paise', () => {
    expect(parseAmount('250')).toBe(25_000);
    expect(parseAmount('99.5')).toBe(9_950);
    expect(parseAmount('₹ 1,250.75')).toBe(125_075);
    expect(parseAmount('.75')).toBe(75);
  });

  it('rejects zero, negatives, too many decimals and junk', () => {
    for (const bad of [
      '',
      '0',
      '0.00',
      '-5',
      '1.234',
      'abc',
      '1e5',
      '.',
      '1..2',
    ])
      expect(parseAmount(bad)).toBeNull();
    expect(parseAmount('100000001')).toBeNull(); // over ₹1 crore
  });

  it('formats with Indian digit grouping', () => {
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(50_000)).toBe('₹500');
    expect(formatInr(12_345_650)).toBe('₹1,23,456.50');
    expect(formatInr(-150)).toBe('-₹1.50');
    expect(toUpiAmount(50_005)).toBe('500.05');
    expect(toAmountInput(50_000)).toBe('500');
    expect(toAmountInput(50_050)).toBe('500.50');
  });
});

describe('UPI QR parsing', () => {
  it('reads payee, name, amount, merchant code and reference', () => {
    const r = parseUpiQr(
      'upi://pay?pa=shop.name@okaxis&pn=Ram%20Stores&am=500.50&cu=INR&mc=5411&tr=ORD-1',
    );
    expect(r).toMatchObject({
      ok: true,
      payee: {
        upiId: 'shop.name@okaxis',
        name: 'Ram Stores',
        amount: 50_050,
        merchantCode: '5411',
        reference: 'ORD-1',
        signed: false,
        personal: false,
      },
    });
  });

  it('accepts a QR without amount or currency', () => {
    const r = parseUpiQr('UPI://PAY?pa=friend@ybl&pn=Asha');
    expect(r.ok && r.payee.amount).toBeNull();
    // "0" means the payer enters the amount.
    const zero = parseUpiQr('upi://pay?pa=friend@ybl&am=0.00');
    expect(zero.ok && zero.payee.amount).toBeNull();
  });

  it('rejects anything that is not a valid UPI payment request', () => {
    expect(parseUpiQr('https://pay.example.com')).toEqual({
      ok: false,
      error: 'not_upi',
    });
    expect(parseUpiQr('upi://mandate?pa=a@b')).toEqual({
      ok: false,
      error: 'not_upi',
    });
    expect(parseUpiQr('upi://pay?pn=NoPayee')).toEqual({
      ok: false,
      error: 'invalid_upi_id',
    });
    expect(parseUpiQr('upi://pay?pa=not-an-id')).toEqual({
      ok: false,
      error: 'invalid_upi_id',
    });
    expect(parseUpiQr('upi://pay?pa=a@b@c')).toEqual({
      ok: false,
      error: 'invalid_upi_id',
    });
    expect(parseUpiQr('upi://pay?pa=x@okaxis&pa=y@okaxis')).toEqual({
      ok: false,
      error: 'invalid_upi_id',
    });
    expect(parseUpiQr('upi://pay?pa=x@okaxis&am=-5')).toEqual({
      ok: false,
      error: 'invalid_amount',
    });
    expect(parseUpiQr('upi://pay?pa=x@okaxis&am=1.234')).toEqual({
      ok: false,
      error: 'invalid_amount',
    });
    expect(parseUpiQr('upi://pay?pa=x@okaxis&am=5&am=500')).toEqual({
      ok: false,
      error: 'invalid_amount',
    });
    expect(parseUpiQr('upi://pay?pa=x@okaxis&cu=USD')).toEqual({
      ok: false,
      error: 'unsupported_currency',
    });
    expect(parseUpiQr(`upi://pay?pa=x@okaxis&pn=${'a'.repeat(3000)}`)).toEqual({
      ok: false,
      error: 'not_upi',
    });
  });

  it('strips control and bidi characters from the payee name', () => {
    const r = parseUpiQr('upi://pay?pa=x@okaxis&pn=Good%E2%80%AEShop%0A');
    expect(r.ok && r.payee.name).toBe('GoodShop');
  });

  it('drops malformed optional fields instead of passing them on', () => {
    const r = parseUpiQr('upi://pay?pa=x@okaxis&mc=12&tr=%3Cscript%3E');
    expect(r.ok && r.payee.merchantCode).toBe('');
    expect(r.ok && r.payee.reference).toBe('');
  });
});

describe('UPI link building', () => {
  const parse = (qr: string) => {
    const r = parseUpiQr(qr);
    if (!r.ok) throw new Error(r.error);
    return r.payee;
  };

  it("keeps the QR's own parameters exactly as scanned", () => {
    const qr =
      'upi://pay?pa=shop@okaxis&pn=Ram%20%26%20Sons&mc=5411&mode=02&purpose=00&orgid=000000&am=450&cu=INR';
    expect(buildUpiUri(parse(qr), 45_000, 'Groceries')).toBe(
      `${qr}&tn=Groceries`,
    );
  });

  it('sets the amount and currency when the QR has none', () => {
    const payee = parse('upi://pay?pa=friend@ybl&pn=Asha');
    expect(payee.personal).toBe(true);
    expect(buildUpiUri(payee, 7_550, '')).toBe(
      'upi://pay?pa=friend@ybl&pn=Asha&am=75.50&cu=INR',
    );
  });

  it('replaces the amount when the user chose theirs', () => {
    const payee = parse('upi://pay?pa=shop@okaxis&am=500&mc=5411');
    expect(payee.personal).toBe(false);
    expect(buildUpiUri(payee, 45_000, '')).toBe(
      'upi://pay?pa=shop@okaxis&am=450.00&mc=5411&cu=INR',
    );
  });

  it('never adds a note to a signed QR', () => {
    const qr = 'upi://pay?pa=shop@okaxis&mc=5411&am=10&cu=INR&sign=xyz';
    const payee = parse(qr);
    expect(payee.signed).toBe(true);
    expect(buildUpiUri(payee, 1_000, 'note')).toBe(qr);
  });

  it('drops junk parameter names', () => {
    const payee = parse('upi://pay?pa=a@ybl&%3Cx%3E=1&ok=2');
    expect(payee.params).toEqual([
      ['pa', 'a@ybl'],
      ['ok', '2'],
    ]);
  });

  it('reads the UPI app report only as a hint', () => {
    expect(parseUpiResponse('txnId=1&responseCode=00&Status=SUCCESS')).toBe(
      'success',
    );
    expect(parseUpiResponse('Status=FAILURE')).toBe('failure');
    expect(parseUpiResponse('status=submitted&x=1')).toBe('submitted');
    expect(parseUpiResponse('')).toBe('unknown');
  });
});

describe('expense store', () => {
  it('seeds the 12 built-in categories and records the schema version', () => {
    const { categories } = expenseStore.read();
    expect(categories.map(c => c.id)).toEqual([
      'food',
      'grocery',
      'shopping',
      'transport',
      'fuel',
      'medical',
      'entertainment',
      'bills',
      'education',
      'travel',
      'personalCare',
      'other',
    ]);
    expect(categories.every(c => c.isDefault)).toBe(true);
    expect(JSON.parse(storage.getString(StorageKeys.ExpenseMeta)!)).toEqual({
      schemaVersion: SCHEMA_VERSION,
    });
  });

  it('migrates without touching other features or existing user rows', () => {
    storage.set(StorageKeys.FollowUpContacts, '[{"id":"c1"}]');
    storage.set(
      StorageKeys.ExpenseCategories,
      JSON.stringify([
        { id: 'pets', name: 'Pets', icon: 'tag', color: 'teal' },
      ]),
    );
    storage.set(
      StorageKeys.ExpenseRecords,
      JSON.stringify([
        expense({ id: 'keep', categoryId: 'pets' }),
        expense({ id: 'orphan', categoryId: 'gone' }),
        { id: 'bad', amount: -1 },
        'junk',
      ]),
    );
    const data = expenseStore.read();
    expect(storage.getString(StorageKeys.FollowUpContacts)).toBe(
      '[{"id":"c1"}]',
    );
    expect(data.categories).toHaveLength(13);
    expect(data.categories.at(-1)).toMatchObject({
      id: 'pets',
      name: 'Pets',
      isDefault: false,
    });
    expect(data.expenses.map(e => [e.id, e.categoryId])).toEqual([
      ['keep', 'pets'],
      ['orphan', 'other'],
    ]);
  });

  it('creates, updates and deletes expenses with validation', () => {
    expect(expenseStore.createExpense(input({ amount: 0 }))).toEqual({
      ok: false,
      error: 'amount_invalid',
    });
    expect(expenseStore.createExpense(input({ amount: 1.5 }))).toEqual({
      ok: false,
      error: 'amount_invalid',
    });
    expect(expenseStore.createExpense(input({ categoryId: 'nope' }))).toEqual({
      ok: false,
      error: 'category_missing',
    });
    expect(expenseStore.createExpense(input({ transactionDate: 'x' }))).toEqual(
      { ok: false, error: 'date_invalid' },
    );

    const created = expenseStore.createExpense(
      input({ merchantName: 'Cafe‮', merchantUpiId: 'bad id' }),
    );
    if (!created.ok) throw new Error('create failed');
    expect(created.value).toMatchObject({
      merchantName: 'Cafe',
      merchantUpiId: '',
    });

    const updated = expenseStore.updateExpense(
      created.value.id,
      input({ amount: 30_000, status: 'pending' }),
    );
    expect(updated.ok && updated.value).toMatchObject({
      amount: 30_000,
      status: 'pending',
    });
    expect(expenseStore.setStatus(created.value.id, 'paid').ok).toBe(true);
    expect(expenseStore.find(created.value.id)?.status).toBe('paid');

    // Persisted: a fresh load sees the same row.
    expenseStore.resetCacheForTest();
    expect(expenseStore.find(created.value.id)?.amount).toBe(30_000);

    expect(expenseStore.deleteExpense(created.value.id).ok).toBe(true);
    expect(expenseStore.read().expenses).toHaveLength(0);
    expect(expenseStore.deleteExpense('missing')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('manages custom categories; built-ins are fixed', () => {
    expect(
      expenseStore.saveCategory({ name: ' ', icon: 'tag', color: 'teal' }),
    ).toEqual({ ok: false, error: 'name_required' });
    expect(
      expenseStore.saveCategory(
        { name: 'grocery', icon: 'tag', color: 'teal' },
        ['Grocery'],
      ),
    ).toEqual({ ok: false, error: 'name_taken' });
    const pets = expenseStore.saveCategory({
      name: 'Pets',
      icon: 'tag',
      color: 'teal',
    });
    if (!pets.ok) throw new Error('save failed');
    expect(
      expenseStore.saveCategory({ name: 'pets', icon: 'tag', color: 'rose' }),
    ).toEqual({ ok: false, error: 'name_taken' });
    const renamed = expenseStore.saveCategory({
      id: pets.value.id,
      name: 'Pet care',
      icon: 'cake',
      color: 'rose',
    });
    expect(renamed.ok && renamed.value).toMatchObject({
      name: 'Pet care',
      icon: 'cake',
      color: 'rose',
    });
    expect(
      expenseStore.saveCategory({
        id: 'food',
        name: 'Eats',
        icon: 'tag',
        color: 'rose',
      }),
    ).toEqual({ ok: false, error: 'default_category' });
    expect(expenseStore.deleteCategory('food')).toEqual({
      ok: false,
      error: 'default_category',
    });

    expenseStore.createExpense(input({ categoryId: pets.value.id }));
    expect(expenseStore.deleteCategory(pets.value.id)).toEqual({
      ok: true,
      value: { moved: 1 },
    });
    expect(expenseStore.read().expenses[0].categoryId).toBe('other');
  });

  it('stores the budget and clears a confirmation whose expense was deleted', () => {
    expect(expenseStore.setBudget(0)).toEqual({
      ok: false,
      error: 'budget_invalid',
    });
    expect(expenseStore.setBudget(2_000_000).ok).toBe(true);
    expect(expenseStore.read().settings.monthlyBudget).toBe(2_000_000);
    expect(expenseStore.setBudget(null).ok).toBe(true);
    expect(expenseStore.read().settings.monthlyBudget).toBeNull();

    const created = expenseStore.createExpense(input({ status: 'pending' }));
    if (!created.ok) throw new Error('create failed');
    expenseStore.setAwaitingConfirmation(created.value.id);
    expenseStore.deleteExpense(created.value.id);
    expect(expenseStore.read().settings.awaitingConfirmationId).toBe('');
  });

  it('notifies subscribers on change', () => {
    const listener = jest.fn();
    const unsubscribe = expenseStore.subscribe(listener);
    expenseStore.createExpense(input());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expenseStore.createExpense(input());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('analytics', () => {
  const data = [
    expense({ amount: 10_000, transactionDate: at(2026, 11, 9) }),
    expense({
      amount: 5_000,
      transactionDate: at(2026, 11, 9),
      status: 'pending',
    }),
    expense({
      amount: 7_000,
      transactionDate: at(2026, 11, 9),
      status: 'failed',
    }),
    expense({
      amount: 20_000,
      transactionDate: at(2026, 11, 3),
      categoryId: 'fuel',
      paymentMethod: 'cash',
    }),
    expense({
      amount: 40_000,
      transactionDate: at(2026, 10, 15),
      categoryId: 'travel',
    }),
  ];

  it('counts only paid money as spent; pending reported apart', () => {
    expect(summarize(data, NOW)).toEqual({
      today: 10_000,
      month: 30_000,
      monthCount: 4,
      pendingCount: 1,
      pendingAmount: 5_000,
    });
  });

  it('works out the budget, including going over', () => {
    expect(budgetState(null, 100)).toBeNull();
    expect(budgetState(50_000, 30_000)).toEqual({
      budget: 50_000,
      spent: 30_000,
      percent: 60,
      remaining: 20_000,
    });
    expect(budgetState(20_000, 30_000)?.remaining).toBe(-10_000);
  });

  it('builds daily, weekly and monthly series ending now', () => {
    const daily = dailySeries(data, NOW);
    expect(daily).toHaveLength(7);
    expect(daily.at(-1)).toEqual({ start: '2026-11-09', total: 10_000 });
    expect(daily[0].start).toBe('2026-11-03');
    expect(daily[0].total).toBe(20_000);

    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // Monday
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // Sunday → previous Monday
    const weekly = weeklySeries(data, NOW, 2);
    expect(weekly).toEqual([
      { start: '2026-11-02', total: 20_000 },
      { start: '2026-11-09', total: 10_000 },
    ]);

    const monthly = monthlySeries(data, NOW, 2);
    expect(monthly).toEqual([
      { start: '2026-10-01', total: 40_000 },
      { start: '2026-11-01', total: 30_000 },
    ]);
  });

  it('breaks spending down by category and payment method', () => {
    const month = inRange(data, 'month', NOW);
    expect(byCategory(month)).toEqual([
      { key: 'fuel', total: 20_000, count: 1 },
      { key: 'food', total: 10_000, count: 1 },
    ]);
    expect(byMethod(inRange(data, 'all', NOW))).toEqual([
      { key: 'upi', total: 50_000, count: 2 },
      { key: 'cash', total: 20_000, count: 1 },
    ]);
  });
});

describe('history filters', () => {
  const rows = [
    expense({
      id: 'a',
      description: 'Pizza',
      transactionDate: at(2026, 11, 1),
      status: 'paid',
    }),
    expense({
      id: 'b',
      merchantName: 'Shell Petrol',
      categoryId: 'fuel',
      paymentMethod: 'card',
      transactionDate: at(2026, 11, 5),
      status: 'pending',
      amount: 150_000,
    }),
    expense({
      id: 'c',
      merchantUpiId: 'chemist@ybl',
      categoryId: 'medical',
      transactionDate: at(2026, 10, 20),
      status: 'failed',
    }),
  ];
  const name = (id: string) =>
    ({ food: 'Food & Dining', fuel: 'Fuel', medical: 'Medical & Health' }[id] ??
    id);

  it('sorts newest first and searches every text field', () => {
    expect(applyFilters(rows, EMPTY_FILTERS, name).map(e => e.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    const q = (query: string) =>
      applyFilters(rows, { ...EMPTY_FILTERS, query }, name).map(e => e.id);
    expect(q('pizza')).toEqual(['a']);
    expect(q('shell')).toEqual(['b']);
    expect(q('chemist@')).toEqual(['c']);
    expect(q('medical')).toEqual(['c']);
    expect(q('1,500')).toEqual(['b']);
  });

  it('filters by category, method, status and date range', () => {
    const f = (patch: Partial<typeof EMPTY_FILTERS>) =>
      applyFilters(rows, { ...EMPTY_FILTERS, ...patch }, name).map(e => e.id);
    expect(f({ categoryIds: ['fuel', 'medical'] })).toEqual(['b', 'c']);
    expect(f({ methods: ['card'] })).toEqual(['b']);
    expect(f({ statuses: ['pending'] })).toEqual(['b']);
    expect(f({ from: '2026-11-01', to: '2026-11-04' })).toEqual(['a']);
    expect(
      countActiveFilters({
        ...EMPTY_FILTERS,
        query: 'x',
        methods: ['upi'],
        from: '2026-11-01',
      }),
    ).toBe(2);
  });
});

describe('expense form validation', () => {
  it('needs a valid amount and time, not in the future', () => {
    const d = emptyDraft(NOW);
    expect(draftErrors(d, NOW)).toEqual(['amount']);
    expect(draftErrors({ ...d, amount: '120', time: '25:00' }, NOW)).toEqual([
      'time',
    ]);
    expect(
      draftErrors({ ...d, amount: '120', day: '2026-11-10' }, NOW),
    ).toEqual(['future']);
    const ok = toInput({ ...d, amount: '120.5', time: '09:30' }, NOW);
    expect(ok).toMatchObject({
      amount: 12_050,
      categoryId: 'food',
      status: 'paid',
    });
    expect(new Date(ok!.transactionDate).getHours()).toBe(9);
  });
});
