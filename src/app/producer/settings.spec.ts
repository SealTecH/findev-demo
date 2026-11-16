import { DEFAULT_SETTINGS, SETTINGS_SCHEMA, settingError } from './settings';

const definition = (key: string) => SETTINGS_SCHEMA.find((s) => s.key === key)!;

describe('settings', () => {
  it('defaults match the task: 5 instruments, 100 updates, 500 ms', () => {
    expect(DEFAULT_SETTINGS).toEqual({ instrumentCount: 5, updatesPerBatch: 100, intervalMs: 500 });
  });

  describe.each([
    { key: 'instrumentCount', label: 'Instrument count', min: 1, max: 50 },
    { key: 'updatesPerBatch', label: 'Updates per batch', min: 1, max: 1_000 },
    { key: 'intervalMs', label: 'Batch interval', min: 50, max: 2_000 },
  ] as const)('$key range $min–$max', ({ key, label, min, max }) => {
    const check = (value: unknown) => settingError(definition(key), value);

    it('accepts both bounds', () => {
      expect(check(min)).toBeNull();
      expect(check(max)).toBeNull();
    });

    it('rejects values just outside the bounds', () => {
      expect(check(min - 1)).toBe(`${label} must be at least ${min}.`);
      expect(check(max + 1)).toBe(`${label} must be at most ${max}.`);
    });

    it.each([2.5, Number.NaN, Number.POSITIVE_INFINITY, '10', true])(
      'rejects non-integer %s',
      (value) => {
        expect(check(value)).toBe(`${label} must be a whole number.`);
      },
    );

    it.each([undefined, null])('reports a missing value (%s) as required', (value) => {
      expect(check(value)).toBe(`${label} is required.`);
    });
  });

  it('schema keys are unique and every default is within its range', () => {
    const keys = SETTINGS_SCHEMA.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SETTINGS_SCHEMA) {
      expect(settingError(s, s.default)).toBeNull();
    }
  });
});
