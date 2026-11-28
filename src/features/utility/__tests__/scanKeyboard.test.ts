import {
  EMPTY_KB,
  parseGunScans,
  parseHosts,
  parseKbStatus,
  suffixText,
} from '../services/scanKeyboard.service';

describe('scan keyboard status', () => {
  it('reads a connected status', () => {
    expect(
      parseKbStatus(
        JSON.stringify({
          state: 'connected',
          host: { name: 'Office PC', address: 'AA:BB' },
          phoneName: 'Galaxy',
        }),
      ),
    ).toEqual({
      state: 'connected',
      host: { name: 'Office PC', address: 'AA:BB' },
      connecting: null,
      phoneName: 'Galaxy',
    });
  });

  it('falls back on broken or unknown input', () => {
    expect(parseKbStatus('not json')).toBe(EMPTY_KB);
    expect(parseKbStatus('{"state":"flying"}').state).toBe('unsupported');
    expect(parseKbStatus('{"state":"ready","host":{}}').host).toBeNull();
  });
});

describe('paired hosts', () => {
  it('keeps valid devices and uses the address when the name is missing', () => {
    expect(
      parseHosts(
        JSON.stringify([
          { name: '', address: '11:22', computer: true, last: true },
          { name: 'Phone' },
          null,
        ]),
      ),
    ).toEqual([
      {
        name: '11:22',
        address: '11:22',
        computer: true,
        connected: false,
        last: true,
      },
    ]);
    expect(parseHosts('{}')).toEqual([]);
  });
});

describe('gun session', () => {
  it('reads scanned codes with their typed flag', () => {
    expect(
      parseGunScans(
        JSON.stringify([
          { value: '8901234567890', format: 'EAN_13', typed: true },
          { value: 'abc', typed: false },
          { value: '' },
        ]),
      ),
    ).toEqual([
      { value: '8901234567890', format: 'EAN_13', typed: true },
      { value: 'abc', format: 'UNKNOWN', typed: false },
    ]);
  });

  it('maps the key pressed after each code', () => {
    expect(suffixText('enter')).toBe('\n');
    expect(suffixText('tab')).toBe('\t');
    expect(suffixText('none')).toBe('');
  });
});
