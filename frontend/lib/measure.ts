import type { UnitSystem } from './db/settings';
import { formatQuantity } from './quantity';
import { CANONICAL_MEASURES, type ScalingMode } from './units';

export type DisplayQuantity = { amountText: string; unitCode: string | null };

export type DisplayOptions = {
  scaleFactor: number;
  system: UnitSystem;
  locale: 'en' | 'nb';
  scaling?: ScalingMode;
};

const OZ_G = 28.3495;
const LB_G = 453.592;
const CUP_ML = 236.588;
const TBSP_ML = 15;
const QUARTER_CUP_ML = CUP_ML / 4;

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
];

// Entry-side inverse of the US display: a US unit typed into the recipe form
// becomes the metric value we store (cup → ml, oz/lb → g), rounded to one
// decimal. Everything else passes through. Storage stays metric-canonical;
// the US toggle shows the amount as cups/oz/lb again through displayQuantity,
// which rounds to kitchen fractions, so "1 cup" survives the round trip.
const US_TO_BASE: Record<string, { toBase: number; unit: 'ml' | 'g' }> = {
  cup: { toBase: CUP_ML, unit: 'ml' },
  oz: { toBase: OZ_G, unit: 'g' },
  lb: { toBase: LB_G, unit: 'g' },
};

export function toCanonical(
  quantity: number | null,
  unit: string | null
): { quantity: number | null; unit: string | null } {
  const us = unit !== null && Object.hasOwn(US_TO_BASE, unit) ? US_TO_BASE[unit] : undefined;
  if (quantity === null || !us) return { quantity, unit };
  return { quantity: Math.round(quantity * us.toBase * 10) / 10, unit: us.unit };
}

export function formatFraction(value: number): string {
  let whole = Math.floor(value);
  const rest = value - whole;
  let glyph = '';
  let bestDistance = rest; // distance to snapping down to the whole
  for (const [fraction, candidate] of FRACTIONS) {
    const distance = Math.abs(rest - fraction);
    if (distance < bestDistance) {
      bestDistance = distance;
      glyph = candidate;
    }
  }
  if (1 - rest < bestDistance) {
    whole += 1;
    glyph = '';
  }
  if (whole === 0 && glyph === '' && value > 0) glyph = '⅛'; // never render a non-zero amount as 0
  if (whole === 0) return glyph;
  return `${whole}${glyph}`;
}

export function displayQuantity(
  quantity: number | null,
  unit: string | null,
  opts: DisplayOptions
): DisplayQuantity | null {
  if (quantity === null) return null;
  const amount = opts.scaling === 'fixed' ? quantity : quantity * opts.scaleFactor;

  const measure =
    unit !== null && Object.hasOwn(CANONICAL_MEASURES, unit) ? CANONICAL_MEASURES[unit] : undefined;
  if (!measure || opts.system === 'metric') {
    // stk, free text, unit-less, and all of metric mode: unit unchanged.
    return { amountText: formatQuantity(amount, opts.locale), unitCode: unit };
  }
  if (unit === 'ts' || unit === 'ss') {
    // Culinarily identical to tsp/tbsp — relabeling only, no math.
    return { amountText: formatFraction(amount), unitCode: unit };
  }

  const base = amount * measure.toBase;
  if (measure.dimension === 'mass') {
    return base < LB_G
      ? { amountText: formatFraction(base / OZ_G), unitCode: 'oz' }
      : { amountText: formatFraction(base / LB_G), unitCode: 'lb' };
  }
  if (base < TBSP_ML) return { amountText: formatFraction(base / 5), unitCode: 'ts' };
  if (base < QUARTER_CUP_ML) return { amountText: formatFraction(base / TBSP_ML), unitCode: 'ss' };
  return { amountText: formatFraction(base / CUP_ML), unitCode: 'cup' };
}
