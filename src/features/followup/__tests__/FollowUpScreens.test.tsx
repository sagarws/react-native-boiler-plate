import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { followUpStore } from '../store/followup.store';
import ContactDetailScreen from '../screens/ContactDetailScreen';
import ContactFormScreen from '../screens/ContactFormScreen';
import FollowUpScreen from '../screens/FollowUpScreen';
import { FollowUpSettings } from '../components/FollowUpSettings';

let mockParams: Record<string, unknown> | undefined;
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    dispatch: mockDispatch,
  }),
  useRoute: () => ({ params: mockParams }),
  StackActions: {
    replace: (name: string, params: object) => ({
      type: 'REPLACE',
      name,
      params,
    }),
  },
}));
jest.mock('@/specs/NativeFollowUp', () => ({
  __esModule: true,
  default: null,
}));

const TODAY = '2026-10-28';
type Renderer = ReactTestRenderer.ReactTestRenderer;

const mounted: Renderer[] = [];
async function render(node: React.ReactElement) {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(node);
  });
  mounted.push(r!);
  return r!;
}
const byId = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const text = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => n.children.filter(c => typeof c === 'string').join(''))
    .join('\n');
async function press(r: Renderer, id: string) {
  await ReactTestRenderer.act(async () => {
    byId(r, id).props.onPress();
  });
}
async function type(r: Renderer, id: string, value: string) {
  await ReactTestRenderer.act(async () => {
    byId(r, id).props.onChangeText(value);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${TODAY}T09:00:00`));
  storage.clearAll();
  followUpStore.resetCacheForTest();
  mockParams = undefined;
  jest.clearAllMocks();
});
afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  jest.useRealTimers();
});

function seed() {
  const c = followUpStore.createContact(
    { name: 'Asha Rao', phone: '9876543210', dial: '+91' },
    { day: '2026-10-27', type: 'call', purpose: 'Send quote' },
  );
  if (!c.ok) throw new Error(c.error);
  return c.value;
}

describe('Follow Up dashboard', () => {
  it('shows an empty state with an add button', async () => {
    const r = await render(<FollowUpScreen />);
    expect(text(r)).toContain('No contacts yet');
    await press(r, 'followup-add');
    expect(mockNavigate).toHaveBeenCalledWith('FollowUpContactForm', {});
  });

  it('lists overdue contacts with counts and completes from the card', async () => {
    const asha = seed();
    mockParams = { view: 'pending' };
    const r = await render(<FollowUpScreen />);
    expect(text(r)).toContain('Asha Rao');
    expect(text(r)).toContain('Overdue');
    await press(r, `contact-${asha.id}-done`);
    expect(has(r, 'complete-sheet')).toBe(true);
    await press(r, 'complete-outcome-successful');
    await press(r, 'complete-save');
    expect(followUpStore.read().activities[0].outcome).toBe('successful');
    expect(text(r)).toContain('Nothing pending');
  });
});

describe('contact form', () => {
  it('requires a valid mobile and saves with a first follow-up', async () => {
    const r = await render(<ContactFormScreen />);
    await type(r, 'contact-name', 'Ravi Kumar');
    await press(r, 'contact-save');
    expect(text(r)).toContain('Enter a mobile number.');
    expect(followUpStore.read().contacts).toEqual([]);

    const phone = r.root.findAll(
      n =>
        n.props.keyboardType === 'phone-pad' &&
        typeof n.props.onChangeText === 'function',
    )[0];
    await ReactTestRenderer.act(async () =>
      phone.props.onChangeText('9123456780'),
    );
    await ReactTestRenderer.act(async () => {
      r.root
        .findByProps({ accessibilityLabel: 'Schedule first follow-up' })
        .props.onToggle(true);
    });
    await press(r, 'contact-first-tomorrow');
    await press(r, 'contact-save');
    const d = followUpStore.read();
    expect(d.contacts[0]).toMatchObject({ name: 'Ravi Kumar' });
    expect(d.activities[0]).toMatchObject({
      day: '2026-10-29',
      contactId: d.contacts[0].id,
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'FollowUpContact' }),
    );
  });

  it('warns about a duplicate number instead of merging', async () => {
    const asha = seed();
    followUpStore.updateSettings({ defaultDial: '+91' });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<ContactFormScreen />);
    await type(r, 'contact-name', 'Asha again');
    const phone = r.root.findAll(
      n =>
        n.props.keyboardType === 'phone-pad' &&
        typeof n.props.onChangeText === 'function',
    )[0];
    await ReactTestRenderer.act(async () =>
      phone.props.onChangeText('09876543210'),
    );
    await press(r, 'contact-save');
    expect(alert).toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2]!;
    await ReactTestRenderer.act(async () => {
      buttons.find(b => b.text === 'Open existing')!.onPress!();
    });
    expect(mockNavigate).toHaveBeenCalledWith('FollowUpContact', {
      contactId: asha.id,
    });
    expect(followUpStore.read().contacts).toHaveLength(1);
  });
});

describe('contact details', () => {
  it('shows follow-ups and timeline, and schedules another', async () => {
    const asha = seed();
    mockParams = { contactId: asha.id };
    const r = await render(<ContactDetailScreen />);
    expect(text(r)).toContain('Send quote');
    await press(r, 'detail-schedule');
    await press(r, 'schedule-week');
    await press(r, 'schedule-save');
    expect(followUpStore.read().activities.map(a => a.day)).toEqual([
      '2026-10-27',
      '2026-11-04',
    ]);
  });

  it('deletes only after confirmation', async () => {
    const asha = seed();
    mockParams = { contactId: asha.id };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<ContactDetailScreen />);
    await press(r, 'detail-delete');
    expect(followUpStore.read().contacts).toHaveLength(1);
    await ReactTestRenderer.act(async () => {
      alert.mock.calls[0][2]!.find(b => b.style === 'destructive')!.onPress!();
    });
    expect(followUpStore.read().contacts).toEqual([]);
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('Follow Up settings', () => {
  it('adds suggested labels and manages them', async () => {
    const r = await render(<FollowUpSettings />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'fu-settings-labels').props.onToggle();
    });
    await press(r, 'fu-suggestions');
    const d = followUpStore.read();
    expect(d.categories.map(c => c.name)).toContain('Client');
    expect(d.tags.map(t => t.name)).toContain('Payment pending');
  });
});
