import { parseAmount } from '../quantity';
import type { UnitCode, UsUnitCode } from '../units';

// Closed bilingual token map onto canonical unit codes — a structured
// mapping, not language parsing (bilingual principle). Tokens match
// case-insensitively as whole words.
const UNIT_TOKENS: Record<string, UnitCode | UsUnitCode> = {
  g: 'g',
  gram: 'g',
  grams: 'g',
  gr: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  dl: 'dl',
  l: 'l',
  liter: 'l',
  litre: 'l',
  liters: 'l',
  litres: 'l',
  ts: 'ts',
  tsp: 'ts',
  teaspoon: 'ts',
  teaspoons: 'ts',
  teskje: 'ts',
  teskjeer: 'ts',
  ss: 'ss',
  tbsp: 'ss',
  tablespoon: 'ss',
  tablespoons: 'ss',
  spiseskje: 'ss',
  spiseskjeer: 'ss',
  // US units survive import as-is; the form converts them to metric on save.
  cup: 'cup',
  cups: 'cup',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  stk: 'stk',
  stykk: 'stk',
  stykker: 'stk',
  pc: 'stk',
  pcs: 'stk',
  piece: 'stk',
  pieces: 'stk',
};

export type ParsedIngredientLine = {
  quantity: number | null;
  unit: string | null;
  name: string;
};

// Conservative by design: only split what is unambiguous; anything else
// degrades to name-only text the review-and-fix form absorbs. Never
// returns an empty name for a non-empty line.
export function parseIngredientLine(line: string): ParsedIngredientLine {
  const trimmed = line.trim();
  if (trimmed === '') return { quantity: null, unit: null, name: '' };

  const amount = parseAmount(trimmed);
  if (!amount || !Number.isFinite(amount.value) || amount.value <= 0) {
    return { quantity: null, unit: null, name: trimmed };
  }

  const rest = amount.rest.trimStart();
  const tokenMatch = rest.match(/^([A-Za-zÀ-ÿ]+)(?=\s|$)/);
  const unit = tokenMatch ? (UNIT_TOKENS[tokenMatch[1].toLowerCase()] ?? null) : null;
  const name = (unit ? rest.slice(tokenMatch![1].length) : rest).trim();

  if (name === '') return { quantity: null, unit: null, name: trimmed };
  return { quantity: amount.value, unit, name };
}
