import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { check, request } from 'react-native-permissions';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { expenseStore } from '../store/expense.store';
import ExpenseTrackerScreen from '../screens/ExpenseTrackerScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
  useIsFocused: () => true,
}));
jest.mock('@/specs/NativeUtility', () => ({
  __esModule: true,
  default: { scanBarcode: jest.fn() },
}));
jest.mock('@/specs/NativeExpense', () => ({
  __esModule: true,
  default: {
    getUpiApps: jest.fn(),
    launchUpiApp: jest.fn(),
    launchUpiChooser: jest.fn(),
    pickQrImage: jest.fn(),
    openUpiApp: jest.fn(),
  },
}));
const utility: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeUtility',
).default;
const upi: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeExpense',
).default;

type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];

async function render() {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<ExpenseTrackerScreen />);
  });
  mounted.push(r!);
  return r!;
}
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const texts = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .flatMap(n => n.props.children)
    .flat(Infinity)
    .filter((c): c is string => typeof c === 'string');
async function press(r: Renderer, id: string) {
  const node = r.root.findAll(
    n => n.props.testID === id && typeof n.props.onPress === 'function',
  )[0];
  if (!node) throw new Error(`no pressable "${id}"`);
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
}
async function type(r: Renderer, id: string, value: string) {
  const node = r.root.findAll(
    n => n.props.testID === id && typeof n.props.onChangeText === 'function',
  )[0];
  if (!node) throw new Error(`no input "${id}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onChangeText(value);
  });
}
/** Presses the destructive button of the last Alert. */
async function confirmAlert(alert: jest.SpyInstance) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[];
  await ReactTestRenderer.act(async () => {
    buttons.find(b => b.style === 'destructive')?.onPress?.();
  });
}

// A shop's QR (merchant code 5411): pays with the link by default.
const QR =
  'upi://pay?pa=ramstores@okaxis&pn=Ram%20Stores&mc=5411&am=500&cu=INR';
// A person's QR (no merchant code): pays by scanning in the app by default.
const PERSONAL_QR = 'upi://pay?pa=friend@kotakbank&pn=Asha&mode=02';
const GPAY = {
  packageName: 'com.google.android.apps.nbu.paisa.user',
  label: 'Google Pay',
  icon: '',
};

beforeEach(() => {
  storage.clearAll();
  expenseStore.resetCacheForTest();
  jest.clearAllMocks();
  (check as jest.Mock).mockResolvedValue('granted');
  (request as jest.Mock).mockResolvedValue('granted');
  utility.scanBarcode.mockResolvedValue(
    JSON.stringify({ value: QR, format: 'QR_CODE' }),
  );
  upi.getUpiApps.mockResolvedValue(JSON.stringify([GPAY]));
  upi.launchUpiApp.mockResolvedValue(
    JSON.stringify({ result: 'ok', response: 'txnId=1&Status=SUCCESS' }),
  );
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('Expense Tracker overview', () => {
  it('shows the dashboard summary and an empty state', async () => {
    const r = await render();
    const all = texts(r);
    for (const label of [
      'Spent today',
      'Spent this month',
      'Transactions this month',
      'Monthly budget',
      'Not set',
    ])
      expect(all).toContain(label);
    expect(has(r, 'overview-empty')).toBe(true);
    expect(all).toContain('Scan QR & Pay');
  });

  it('sets a monthly budget and shows progress against it', async () => {
    expenseStore.createExpense({
      amount: 500_000,
      categoryId: 'food',
      description: '',
      paymentMethod: 'cash',
      status: 'paid',
      transactionDate: new Date().toISOString(),
    });
    const r = await render();
    await press(r, 'sum-budget');
    await type(r, 'budget-amount', '20000');
    await press(r, 'budget-save');
    expect(expenseStore.read().settings.monthlyBudget).toBe(2_000_000);
    expect(texts(r)).toContain('25% of budget used');
    expect(texts(r)).toContain('₹15,000 left');
  });
});

describe('adding an expense', () => {
  it('validates, saves, and updates the summary', async () => {
    const r = await render();
    await press(r, 'expense-tab-add');
    await press(r, 'add-save');
    expect(texts(r)).toContain('Enter an amount like 250 or 99.50.');
    expect(expenseStore.read().expenses).toHaveLength(0);

    await type(r, 'add-amount', '250');
    await press(r, 'add-cat-grocery');
    await press(r, 'add-method-cash');
    await type(r, 'add-description', 'Vegetables');
    await press(r, 'add-save');

    const [saved] = expenseStore.read().expenses;
    expect(saved).toMatchObject({
      amount: 25_000,
      categoryId: 'grocery',
      paymentMethod: 'cash',
      status: 'paid',
      description: 'Vegetables',
    });
    expect(texts(r)).toContain('₹250 expense saved.');

    await press(r, 'expense-tab-overview');
    expect(texts(r).filter(t => t === '₹250').length).toBeGreaterThanOrEqual(2);
    expect(has(r, `recent-${saved.id}`)).toBe(true);
  });
});

describe('Scan QR & Pay', () => {
  async function startScan(amount: string) {
    const r = await render();
    await press(r, 'expense-tab-add');
    if (amount) await type(r, 'add-amount', amount);
    await press(r, 'add-cat-shopping');
    await type(r, 'add-description', 'Shirt');
    await press(r, 'add-scan');
    return r;
  }

  it('asks which amount, lists UPI apps, opens one and records it as paid', async () => {
    const r = await startScan('450');
    expect(has(r, 'pay-choose-amount')).toBe(true);
    expect(texts(r)).toContain('Ram Stores');
    expect(texts(r)).toContain('ramstores@okaxis');

    await press(r, 'pay-amount-entered');
    expect(upi.getUpiApps).toHaveBeenCalledWith(
      'upi://pay?pa=ramstores@okaxis&pn=Ram%20Stores&mc=5411&am=450.00&cu=INR&tn=Shirt',
    );
    expect(has(r, 'pay-apps')).toBe(true);
    expect(texts(r)).toContain('Google Pay');

    await press(r, `pay-app-${GPAY.packageName}`);
    expect(upi.launchUpiApp).toHaveBeenCalledWith(
      expect.stringContaining('am=450.00'),
      GPAY.packageName,
    );
    // Recorded as paid on redirect, with no "did it go through?" question.
    const [paid] = expenseStore.read().expenses;
    expect(paid).toMatchObject({
      amount: 45_000,
      status: 'paid',
      paymentMethod: 'upi',
      categoryId: 'shopping',
      merchantName: 'Ram Stores',
      merchantUpiId: 'ramstores@okaxis',
    });
    expect(has(r, 'pay-confirm')).toBe(false);
    expect(has(r, 'pay-apps')).toBe(false);
    expect(texts(r)).toContain('₹450 payment marked as paid.');
  });

  it('uses the QR amount when none was typed, and records it as paid even if the UPI app reports a failure', async () => {
    upi.launchUpiApp.mockResolvedValue(
      JSON.stringify({ result: 'ok', response: 'txnId=1&Status=FAILURE' }),
    );
    const r = await startScan('');
    expect(has(r, 'pay-choose-amount')).toBe(false);
    // The QR's own amount is passed through exactly as scanned.
    expect(upi.getUpiApps).toHaveBeenCalledWith(
      expect.stringContaining('&am=500&'),
    );
    await press(r, `pay-app-${GPAY.packageName}`);
    expect(expenseStore.read().expenses[0]).toMatchObject({
      amount: 50_000,
      status: 'paid',
    });
  });

  it('records it as paid when scanning in the UPI app', async () => {
    utility.scanBarcode.mockResolvedValue(
      JSON.stringify({ value: PERSONAL_QR, format: 'QR_CODE' }),
    );
    const r = await startScan('200');
    await press(r, `pay-app-${GPAY.packageName}`);
    expect(upi.openUpiApp).toHaveBeenCalledWith(GPAY.packageName);
    expect(upi.launchUpiApp).not.toHaveBeenCalled();
    expect(expenseStore.read().expenses[0]).toMatchObject({
      amount: 20_000,
      status: 'paid',
    });
  });

  it('pays a signed QR at its own amount, untouched', async () => {
    const signed =
      'upi://pay?pa=shop@hdfcbank&pn=Shop&mc=5411&am=120.00&cu=INR&tr=T1&sign=abc%2B%3D';
    utility.scanBarcode.mockResolvedValue(
      JSON.stringify({ value: signed, format: 'QR_CODE' }),
    );
    const r = await startScan('99');
    expect(has(r, 'pay-choose-amount')).toBe(false);
    expect(upi.getUpiApps).toHaveBeenCalledWith(signed);
  });

  it('drops the pending record when the UPI app could not be opened', async () => {
    upi.launchUpiApp.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'launch_failed' }),
    );
    const r = await startScan('500');
    await press(r, `pay-app-${GPAY.packageName}`);
    expect(expenseStore.read().expenses).toHaveLength(0);
    expect(expenseStore.read().settings.awaitingConfirmationId).toBe('');
    expect(texts(r)).toContain("UPI app didn't open");
  });

  it('explains a blocked camera and does not scan', async () => {
    (check as jest.Mock).mockResolvedValue('blocked');
    const r = await startScan('500');
    expect(utility.scanBarcode).not.toHaveBeenCalled();
    expect(texts(r)).toContain('Camera access is off');
  });

  it('refuses an invalid typed amount before opening the camera', async () => {
    const r = await startScan('12.345');
    expect(utility.scanBarcode).not.toHaveBeenCalled();
    expect(texts(r)).toContain('Check the amount');
  });

  it('forgets a confirmation question left over from an older version', async () => {
    const created = expenseStore.createExpense({
      amount: 9_900,
      categoryId: 'food',
      description: '',
      paymentMethod: 'upi',
      status: 'pending',
      transactionDate: new Date().toISOString(),
      merchantName: 'Cafe',
      merchantUpiId: 'cafe@ybl',
    });
    if (!created.ok) throw new Error('create failed');
    expenseStore.setAwaitingConfirmation(created.value.id);
    const r = await render();
    expect(has(r, 'pay-confirm')).toBe(false);
    expect(expenseStore.find(created.value.id)?.status).toBe('pending');
    expect(expenseStore.read().settings.awaitingConfirmationId).toBe('');
  });
});

describe('history', () => {
  function seed() {
    const make = (
      amount: number,
      status: 'paid' | 'pending',
      description: string,
    ) => {
      const r = expenseStore.createExpense({
        amount,
        categoryId: 'food',
        description,
        paymentMethod: 'upi',
        status,
        transactionDate: new Date().toISOString(),
      });
      if (!r.ok) throw new Error('seed failed');
      return r.value;
    };
    return [
      make(10_000, 'paid', 'Breakfast'),
      make(20_000, 'pending', 'Dinner'),
    ];
  }

  it('filters to pending from the overview and updates the status', async () => {
    const [breakfast, dinner] = seed();
    const r = await render();
    const review = r.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Review' &&
        typeof n.props.onPress === 'function',
    )[0];
    await ReactTestRenderer.act(async () => review.props.onPress());
    expect(has(r, `txn-${dinner.id}`)).toBe(true);
    expect(has(r, `txn-${breakfast.id}`)).toBe(false);

    await press(r, `txn-${dinner.id}`);
    await press(r, 'edit-status-paid');
    await press(r, 'edit-save');
    expect(expenseStore.find(dinner.id)?.status).toBe('paid');
  });

  it('searches and deletes after confirmation', async () => {
    const [breakfast, dinner] = seed();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render();
    await press(r, 'expense-tab-history');
    await type(r, 'history-search', 'break');
    expect(has(r, `txn-${breakfast.id}`)).toBe(true);
    expect(has(r, `txn-${dinner.id}`)).toBe(false);

    await press(r, `txn-${breakfast.id}`);
    await press(r, 'edit-delete');
    expect(alert).toHaveBeenCalled();
    expect(expenseStore.find(breakfast.id)).toBeDefined();
    await confirmAlert(alert);
    expect(expenseStore.find(breakfast.id)).toBeUndefined();
    alert.mockRestore();
  });
});

describe('categories', () => {
  it('adds a custom category that can then be picked', async () => {
    const r = await render();
    await press(r, 'expense-tab-add');
    await press(r, 'add-manage-categories');
    await press(r, 'category-add');
    await type(r, 'category-name', 'Pets');
    await press(r, 'category-icon-cake');
    await press(r, 'category-save');
    const pets = expenseStore.read().categories.find(c => c.name === 'Pets');
    expect(pets).toMatchObject({ icon: 'cake', isDefault: false });
    await press(r, 'category-sheet-close');
    expect(has(r, `add-cat-${pets!.id}`)).toBe(true);
  });

  it('will not duplicate a built-in name', async () => {
    const r = await render();
    await press(r, 'expense-tab-add');
    await press(r, 'add-manage-categories');
    await press(r, 'category-add');
    await type(r, 'category-name', 'fuel');
    await press(r, 'category-save');
    expect(texts(r)).toContain('A category with this name already exists.');
  });
});

describe('analytics', () => {
  it('charts paid spending by category and method', async () => {
    expenseStore.createExpense({
      amount: 30_000,
      categoryId: 'fuel',
      description: '',
      paymentMethod: 'card',
      status: 'paid',
      transactionDate: new Date().toISOString(),
    });
    const r = await render();
    await press(r, 'expense-tab-analytics');
    expect(has(r, 'analytics-trend')).toBe(true);
    const all = texts(r);
    expect(all).toContain('Fuel');
    expect(all).toContain('Card');
    expect(all).toContain('₹300');
  });
});
