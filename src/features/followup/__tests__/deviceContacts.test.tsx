import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { check, request } from 'react-native-permissions';
import '@/i18n';
import { storage } from '@/store/mmkv';
import {
  birthDateOf,
  fillFrom,
  parseDeviceContacts,
  searchContacts,
  splitNumber,
} from '../services/deviceContacts';
import { followUpStore } from '../store/followup.store';
import ContactFormScreen from '../screens/ContactFormScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
  }),
  useRoute: () => ({ params: undefined }),
  StackActions: { replace: jest.fn() },
}));
jest.mock('@/specs/NativeFollowUp', () => ({
  __esModule: true,
  default: { getDeviceContacts: jest.fn(), pickDeviceContact: jest.fn() },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeFollowUp',
).default;

const DIALS = ['+44', '+1', '+91', '+353', '+61'];
const PHONEBOOK = JSON.stringify([
  {
    id: '1',
    name: 'Ravi Kumar',
    phones: ['+91 98765 43210', '080-2345 6789'],
    email: 'ravi@example.com',
    organization: 'Acme',
    birthday: '1990-05-12',
  },
  { id: '2', name: 'Meera', phones: ['+44 7700 900123'], birthday: '--03-04' },
  { id: '3', name: 'No number', phones: [] },
  { bad: true },
]);

describe('device contacts mapping', () => {
  it('parses, drops entries without numbers, and searches name or number', () => {
    const list = parseDeviceContacts(PHONEBOOK);
    expect(list.map(c => c.name)).toEqual(['Ravi Kumar', 'Meera']);
    expect(searchContacts(list, 'mee').map(c => c.id)).toEqual(['2']);
    expect(searchContacts(list, '900 12').map(c => c.id)).toEqual(['2']);
    expect(searchContacts(list, '2345').map(c => c.id)).toEqual(['1']);
    expect(searchContacts(list, '12')).toEqual([]);
    expect(parseDeviceContacts('nope')).toEqual([]);
  });

  it('splits international numbers into code + number', () => {
    expect(splitNumber('+91 98765 43210', '+44', DIALS)).toEqual({
      dial: '+91',
      phone: '9876543210',
    });
    expect(splitNumber('00353 87 123 4567', '+91', DIALS)).toEqual({
      dial: '+353',
      phone: '871234567',
    });
    // Unknown code: kept whole in the any-country format.
    expect(splitNumber('+49 1512 3456789', '+91', DIALS)).toEqual({
      dial: '+91',
      phone: '004915123456789',
    });
    // Local number keeps the selected code.
    expect(splitNumber('098765 43210', '+91', DIALS)).toEqual({
      dial: '+91',
      phone: '09876543210',
    });
  });

  it('fills the form fields, ignoring a birthday without a year', () => {
    const [ravi, meera] = parseDeviceContacts(PHONEBOOK);
    expect(fillFrom(ravi, ravi.phones[0], '+44', DIALS)).toEqual({
      name: 'Ravi Kumar',
      dial: '+91',
      phone: '9876543210',
      email: 'ravi@example.com',
      organization: 'Acme',
      birthDate: '1990-05-12',
    });
    expect(birthDateOf(meera.birthday)).toBe('');
  });
});

describe('contact form: choose from contacts', () => {
  type Renderer = ReactTestRenderer.ReactTestRenderer;
  let r: Renderer;
  const byId = (id: string) =>
    r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
  const has = (id: string) =>
    r.root.findAll(n => n.props.testID === id).length > 0;

  beforeEach(() => {
    storage.clearAll();
    followUpStore.resetCacheForTest();
    jest.clearAllMocks();
    native.getDeviceContacts.mockResolvedValue(PHONEBOOK);
  });
  afterEach(async () => {
    await ReactTestRenderer.act(async () => r.unmount());
  });

  it('asks for access on tap, lists contacts, and fills the chosen number', async () => {
    (check as jest.Mock).mockResolvedValueOnce('denied');
    (request as jest.Mock).mockResolvedValueOnce('granted');
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<ContactFormScreen />);
    });
    expect(native.getDeviceContacts).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () =>
      byId('contact-pick').props.onPress(),
    );
    expect(request).toHaveBeenCalled();
    expect(has('contacts-list')).toBe(true);
    await ReactTestRenderer.act(async () =>
      byId('contacts-search').props.onChangeText('ravi'),
    );
    // Two numbers: expand, then choose the first.
    await ReactTestRenderer.act(async () =>
      byId('device-contact-1').props.onPress(),
    );
    const number = r.root.findAll(
      n =>
        n.props.accessibilityLabel === '+91 98765 43210' &&
        typeof n.props.onPress === 'function',
    )[0];
    await ReactTestRenderer.act(async () => number.props.onPress());
    expect(has('contacts-list')).toBe(false);
    expect(byId('contact-name').props.value).toBe('Ravi Kumar');
    expect(byId('contact-email').props.value).toBe('ravi@example.com');
    expect(byId('contact-org').props.value).toBe('Acme');
    expect(byId('contact-birth-year').props.value).toBe('1990');
    expect(has('contact-filled')).toBe(true);
  });

  it('offers the system picker when access is refused', async () => {
    (check as jest.Mock).mockResolvedValueOnce('blocked');
    native.pickDeviceContact.mockResolvedValue(
      JSON.stringify({
        id: '9',
        name: 'Picked One',
        phones: ['+44 7700 900999'],
      }),
    );
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<ContactFormScreen />);
    });
    await ReactTestRenderer.act(async () =>
      byId('contact-pick').props.onPress(),
    );
    expect(native.getDeviceContacts).not.toHaveBeenCalled();
    expect(has('contacts-permission')).toBe(true);
    await ReactTestRenderer.act(async () =>
      byId('contacts-system-picker').props.onPress(),
    );
    expect(byId('contact-name').props.value).toBe('Picked One');
  });
});
