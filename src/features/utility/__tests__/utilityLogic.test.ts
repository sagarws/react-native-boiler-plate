import { storage } from '@/store/mmkv';
import { parseCode, safeUrl } from '../services/qr';
import { cardinal, formatLength } from '../services/units';
import { MAX_SCANS, utilityStore } from '../store/utility.store';

beforeEach(() => {
  storage.clearAll();
  utilityStore.resetCacheForTest();
});

describe('scanned code safety', () => {
  it('offers links only for clean http(s) URLs and flags risky ones', () => {
    expect(safeUrl('https://example.com/a?b=1')).toEqual({
      url: 'https://example.com/a?b=1',
      host: 'example.com',
      warning: null,
    });
    expect(safeUrl('http://example.com')?.warning).toBe('insecure');
    expect(safeUrl('https://192.168.0.1/login')?.warning).toBe('ip');
    expect(safeUrl('https://xn--pple-43d.com')?.warning).toBe('punycode');
    expect(safeUrl('https://bank.com@evil.example')?.warning).toBe(
      'credentials',
    );
    for (const unsafe of [
      // eslint-disable-next-line no-script-url -- unsafe input under test
      'javascript:alert(1)',
      'intent://scan#Intent;end',
      'file:///sdcard/x.apk',
      'data:text/html,<b>x</b>',
      'market://details?id=x',
      'https://exa mple.com',
    ]) {
      expect(safeUrl(unsafe)).toBeNull();
      expect(parseCode(unsafe, 'QR_CODE').kind).toBe('text');
    }
  });

  it('recognises phone, email, SMS, Wi-Fi, location and products', () => {
    expect(parseCode('tel:+44 7700 900123', 'QR_CODE')).toEqual({
      kind: 'phone',
      phone: '+447700900123',
    });
    expect(
      parseCode('mailto:a@b.co?subject=Hi%20there&body=x', 'QR_CODE'),
    ).toEqual({
      kind: 'email',
      email: 'a@b.co',
      subject: 'Hi there',
      body: 'x',
    });
    expect(parseCode('SMSTO:+919876543210:Hello', 'QR_CODE')).toMatchObject({
      kind: 'sms',
      phone: '+919876543210',
      body: 'Hello',
    });
    expect(
      parseCode('WIFI:T:WPA;S:My\\;Net;P:p@ss;H:true;;', 'QR_CODE'),
    ).toEqual({
      kind: 'wifi',
      ssid: 'My;Net',
      password: 'p@ss',
      security: 'WPA',
      hidden: true,
    });
    expect(parseCode('geo:12.97,77.59', 'QR_CODE')).toEqual({
      kind: 'geo',
      lat: 12.97,
      lng: 77.59,
    });
    expect(parseCode('4006381333931', 'EAN_13')).toEqual({
      kind: 'product',
      code: '4006381333931',
    });
    expect(parseCode('4006381333931', 'CODE_128').kind).toBe('text');
  });
});

describe('units', () => {
  it('formats metres in each unit', () => {
    expect(formatLength(1.2346, 'cm')).toMatch(/^123[.,]5 cm$/);
    expect(formatLength(1.2345, 'm')).toMatch(/^1[.,]23 m$/);
    expect(formatLength(1, 'in')).toMatch(/^39[.,]4 in$/);
    expect(formatLength(1, 'ft')).toMatch(/^3[.,]28 ft$/);
  });

  it('names compass points', () => {
    expect([0, 44, 46, 180, 292, 330, 338, 359.9, -10].map(cardinal)).toEqual([
      'N',
      'NE',
      'NE',
      'S',
      'W',
      'NW',
      'N',
      'N',
      'N',
    ]);
  });
});

describe('utility store', () => {
  it('keeps scan history newest first and capped', () => {
    for (let i = 0; i < MAX_SCANS + 5; i++)
      utilityStore.addScan({ value: `v${i}`, format: 'QR_CODE', kind: 'text' });
    const { scans } = utilityStore.read();
    expect(scans).toHaveLength(MAX_SCANS);
    expect(scans[0].value).toBe(`v${MAX_SCANS + 4}`);
    utilityStore.deleteScan(scans[0].id);
    expect(utilityStore.read().scans).toHaveLength(MAX_SCANS - 1);
    utilityStore.clearScans();
    expect(utilityStore.read().scans).toEqual([]);
  });

  it('refuses invalid measurements and persists valid ones', () => {
    expect(
      utilityStore.saveMeasurement({
        mode: 'length',
        meters: 0,
        source: 'plane',
      }),
    ).toBeNull();
    expect(
      utilityStore.saveMeasurement({
        mode: 'length',
        meters: NaN,
        source: 'plane',
      }),
    ).toBeNull();
    utilityStore.saveMeasurement({
      mode: 'height',
      meters: 0.75,
      source: 'depth',
    });
    utilityStore.resetCacheForTest();
    expect(utilityStore.read().measurements[0]).toMatchObject({
      mode: 'height',
      meters: 0.75,
    });
  });

  it('keeps document page order and returns pages to delete', () => {
    const doc = utilityStore.createDocument('  Receipt ', ['/a.jpg', '/b.jpg']);
    expect(doc.name).toBe('Receipt');
    utilityStore.updateDocument(doc.id, { pages: ['/b.jpg', '/a.jpg'] });
    utilityStore.resetCacheForTest();
    expect(utilityStore.read().documents[0].pages).toEqual([
      '/b.jpg',
      '/a.jpg',
    ]);
    expect(utilityStore.deleteDocument(doc.id)).toEqual(['/b.jpg', '/a.jpg']);
    expect(utilityStore.read().documents).toEqual([]);
  });

  it('validates preferences', () => {
    utilityStore.updatePrefs({ unit: 'ft', waterSeconds: 999 as number });
    expect(utilityStore.read().prefs).toMatchObject({
      unit: 'ft',
      waterSeconds: 30,
    });
  });
});
