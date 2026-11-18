import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { DEFAULT_ALERT } from '@/services/alarms';
import { storage } from '@/store/mmkv';
import { useReminderAlarmSync } from '../hooks/useReminders';
import ReminderFormScreen from '../screens/ReminderFormScreen';
import RemindersScreen from '../screens/RemindersScreen';
import { remindersStore } from '../store/reminders.store';

let mockParams: Record<string, unknown> | undefined;
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
  useIsFocused: () => true,
}));
jest.mock('@/specs/NativeAlarms', () => ({
  __esModule: true,
  default: {
    sync: jest.fn(),
    dismiss: jest.fn(),
    getRinging: jest.fn(),
    getArmed: jest.fn(),
    pickRingtone: jest.fn(),
    ringtoneTitle: jest.fn(),
    previewRingtone: jest.fn(),
    stopPreview: jest.fn(),
    hasVibrator: jest.fn(),
    canScheduleExactAlarms: jest.fn(),
    openExactAlarmSettings: jest.fn(),
    canUseFullScreenIntent: jest.fn(),
    openFullScreenIntentSettings: jest.fn(),
  },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeAlarms',
).default;

const NOW = new Date(2026, 10, 18, 10, 0).getTime();
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
const press = (r: Renderer, id: string) =>
  ReactTestRenderer.act(async () => {
    await byId(r, id).props.onPress();
  });
const type = (r: Renderer, id: string, value: string) =>
  ReactTestRenderer.act(async () => {
    r.root
      .findAll(n => n.props.testID === id && 'onChangeText' in n.props)[0]
      .props.onChangeText(value);
  });

const seed = (
  title: string,
  extra: Partial<Parameters<typeof remindersStore.create>[0]> = {},
) => {
  const r = remindersStore.create(
    {
      title,
      description: '',
      date: '2026-11-20',
      time: '09:30',
      category: 'personal',
      customLabel: '',
      repeat: 'never',
      alert: DEFAULT_ALERT,
      ...extra,
    },
    NOW - 86_400_000 * 30,
  );
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  storage.clearAll();
  remindersStore.resetCacheForTest();
  mockParams = undefined;
  jest.clearAllMocks();
  native.sync.mockImplementation(async (_g: string, json: string) =>
    JSON.stringify({ armed: JSON.parse(json).length, exact: true }),
  );
  native.hasVibrator.mockResolvedValue(true);
  native.canUseFullScreenIntent.mockResolvedValue(true);
});
afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  jest.useRealTimers();
});

describe('Reminders dashboard', () => {
  it('shows the next reminder, the calendar and the lists', async () => {
    seed('Dentist', { date: '2026-11-20' });
    seed("Mum's birthday", {
      category: 'birthday',
      date: '1960-11-19',
      time: '08:00',
      repeat: 'yearly',
    });
    seed('Old one', { date: '2026-11-01' });
    const r = await render(<RemindersScreen />);
    expect(has(r, 'reminders-next')).toBe(true);
    expect(text(r)).toContain("Mum's birthday");
    expect(text(r)).toContain('in 22 h 0 min');
    expect(has(r, 'reminders-calendar-dots-2026-11-19')).toBe(true);
    expect(has(r, 'reminders-calendar-dots-2026-11-20')).toBe(true);
    expect(text(r)).toContain('Upcoming (2)');

    await ReactTestRenderer.act(async () => {
      byId(r, 'reminders-calendar-day-2026-11-20').props.onPress();
    });
    expect(text(r)).toContain('Dentist');

    await ReactTestRenderer.act(async () => {
      byId(r, 'reminders-list').props.onChange('past');
    });
    expect(text(r)).toContain('Old one');
  });

  it('switches a reminder off and on', async () => {
    const r1 = seed('Dentist');
    const r = await render(<RemindersScreen />);
    await ReactTestRenderer.act(async () => {
      r.root
        .findAll(
          n =>
            n.props.accessibilityLabel === 'Reminder on: Dentist' &&
            typeof n.props.onPress === 'function',
        )[0]
        .props.onPress();
    });
    expect(remindersStore.read()[0].enabled).toBe(false);
    expect(native.dismiss).toHaveBeenCalledWith(`reminder:${r1.id}`);
    expect(text(r)).toContain('Off (1)');
  });

  it('shows an empty day and an empty upcoming list', async () => {
    const r = await render(<RemindersScreen />);
    expect(has(r, 'reminders-day-empty')).toBe(true);
    expect(has(r, 'reminders-empty-upcoming')).toBe(true);
  });
});

describe('Reminder form', () => {
  it('creates a yearly birthday reminder with its alarm settings', async () => {
    mockParams = { date: '2026-12-05' };
    const r = await render(<ReminderFormScreen />);
    await type(r, 'reminder-title', 'Ravi turns 30');
    await press(r, 'reminder-category-birthday');
    await press(r, 'reminder-time-07:00');
    await ReactTestRenderer.act(async () => {
      byId(r, 'reminder-alert-mode').props.onChange('priority');
    });
    await press(r, 'reminder-save');
    const [saved] = remindersStore.read();
    expect(saved).toMatchObject({
      title: 'Ravi turns 30',
      category: 'birthday',
      // Birthdays repeat every year by default.
      repeat: 'yearly',
      date: '2026-12-05',
      time: '07:00',
      alert: { mode: 'priority' },
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('explains missing titles, bad times and past one-offs', async () => {
    mockParams = { date: '2026-11-18' };
    const r = await render(<ReminderFormScreen />);
    await press(r, 'reminder-save');
    expect(text(r)).toContain('Enter a title.');
    await type(r, 'reminder-title', 'Call bank');
    await type(r, 'reminder-time', '25:99');
    await press(r, 'reminder-save');
    expect(text(r)).toContain('Enter a time like 09:30.');
    await type(r, 'reminder-time', '07:00');
    await press(r, 'reminder-save');
    expect(text(r)).toContain('That time has already passed');
    expect(remindersStore.read()).toHaveLength(0);
  });

  it('edits and deletes a reminder', async () => {
    const existing = seed('Dentist');
    mockParams = { reminderId: existing.id };
    const r = await render(<ReminderFormScreen />);
    await type(r, 'reminder-title', 'Dentist (moved)');
    await press(r, 'reminder-repeat-monthly');
    await press(r, 'reminder-save');
    expect(remindersStore.read()[0]).toMatchObject({
      title: 'Dentist (moved)',
      repeat: 'monthly',
    });
    const alert = jest.spyOn(Alert, 'alert');
    await press(r, 'reminder-delete');
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    await ReactTestRenderer.act(async () => {
      buttons.find(b => b.style === 'destructive')?.onPress?.();
    });
    expect(remindersStore.read()).toHaveLength(0);
    expect(native.dismiss).toHaveBeenCalledWith(`reminder:${existing.id}`);
    alert.mockRestore();
  });
});

describe('Alarm sync', () => {
  function Host() {
    useReminderAlarmSync();
    return null;
  }

  it('hands every enabled reminder to the alarm engine after changes', async () => {
    seed('Dentist');
    await render(<Host />);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(native.sync).toHaveBeenLastCalledWith(
      'reminder',
      expect.stringContaining('"key":"reminder:'),
    );
    const sent = JSON.parse(native.sync.mock.calls.at(-1)![1]);
    expect(sent[0]).toMatchObject({
      title: 'Dentist',
      date: '2026-11-20',
      time: '09:30',
      repeat: 'never',
    });

    await ReactTestRenderer.act(async () => {
      remindersStore.setEnabled(remindersStore.read()[0].id, false);
      jest.advanceTimersByTime(500);
    });
    expect(JSON.parse(native.sync.mock.calls.at(-1)![1])).toEqual([]);
  });
});
