export interface SettingDefinition {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export const SETTINGS_SCHEMA = [
  {
    key: 'instrumentCount',
    label: 'Instrument count',
    hint: 'Number of fictional instruments to generate data for.',
    unit: 'instruments',
    min: 1,
    max: 50,
    default: 5,
  },
  {
    key: 'updatesPerBatch',
    label: 'Updates per batch',
    hint: 'Total number of market updates in each generated batch.',
    unit: 'updates',
    min: 1,
    max: 1_000,
    default: 100,
  },
  {
    key: 'intervalMs',
    label: 'Batch interval',
    hint: 'Requested time between batches.',
    unit: 'ms',
    min: 50,
    max: 2_000,
    default: 500,
  },
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof SETTINGS_SCHEMA)[number]['key'];

export type ProducerSettings = Readonly<Record<SettingKey, number>>;

export const DEFAULT_SETTINGS = Object.fromEntries(
  SETTINGS_SCHEMA.map((s) => [s.key, s.default]),
) as ProducerSettings;

export function settingError(definition: SettingDefinition, value: unknown): string | null {
  if (value === null || value === undefined) return `${definition.label} is required.`;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `${definition.label} must be a whole number.`;
  }
  if (value < definition.min) return `${definition.label} must be at least ${definition.min}.`;
  if (value > definition.max) return `${definition.label} must be at most ${definition.max}.`;
  return null;
}

/** Nominal generation rate across all instruments, in updates per second. */
export function nominalRate(settings: ProducerSettings): number {
  return (settings.updatesPerBatch * 1_000) / settings.intervalMs;
}
