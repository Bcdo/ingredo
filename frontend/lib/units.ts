// Canonical unit codes. Stored in the DB; labels are localized via i18n
// (keys `units.<code>`). 'ts'/'ss'/'stk' follow Norwegian kitchen convention
// but are codes, not display text.
export const UNITS = ['g', 'kg', 'ml', 'dl', 'l', 'ts', 'ss', 'stk'] as const;
export type UnitCode = (typeof UNITS)[number];

export type ScalingMode = 'linear' | 'fixed';
export type Dimension = 'mass' | 'volume';

// Canonical units that participate in conversion, with factors to the
// dimension's base unit (mass: g, volume: ml). 'stk' is a count — absent
// here on purpose: it scales but never converts.
export const CANONICAL_MEASURES: Record<string, { dimension: Dimension; toBase: number }> = {
  g: { dimension: 'mass', toBase: 1 },
  kg: { dimension: 'mass', toBase: 1000 },
  ml: { dimension: 'volume', toBase: 1 },
  dl: { dimension: 'volume', toBase: 100 },
  l: { dimension: 'volume', toBase: 1000 },
  ts: { dimension: 'volume', toBase: 5 },
  ss: { dimension: 'volume', toBase: 15 },
};

// Display-only US codes (never stored). Converted tsp/tbsp amounts reuse
// the 'ts'/'ss' codes, whose English labels already read "tsp"/"tbsp".
export const US_DISPLAY_UNITS = ['oz', 'lb', 'cup'] as const;

export function isLocalizableUnit(code: string): boolean {
  return (
    (UNITS as readonly string[]).includes(code) ||
    (US_DISPLAY_UNITS as readonly string[]).includes(code)
  );
}
