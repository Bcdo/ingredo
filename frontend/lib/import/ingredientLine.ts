import type { UnitCode } from '../units';

// Closed bilingual token map onto canonical unit codes — a structured
// mapping, not language parsing (bilingual principle). Tokens match
// case-insensitively as whole words.
const UNIT_TOKENS: Record<string, UnitCode> = {
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
  stk: 'stk',
  stykk: 'stk',
  stykker: 'stk',
  pc: 'stk',
  pcs: 'stk',
  piece: 'stk',
  pieces: 'stk',
};

const FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
};

export type ParsedIngredientLine = {
  quantity: number | null;
  unit: string | null;
  name: string;
};

function parseAmount(input: string): { value: number; rest: string } | null {
  let m = input.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (m) {
    return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: input.slice(m[0].length) };
  }
  m = input.match(/^(\d+)\s*\/\s*(\d+)/);
  if (m) return { value: Number(m[1]) / Number(m[2]), rest: input.slice(m[0].length) };
  m = input.match(/^(\d+)\s*([½¼¾⅓⅔])/);
  if (m) return { value: Number(m[1]) + FRACTIONS[m[2]], rest: input.slice(m[0].length) };
  m = input.match(/^([½¼¾⅓⅔])/);
  if (m) return { value: FRACTIONS[m[1]], rest: input.slice(m[0].length) };
  m = input.match(/^(\d+(?:[.,]\d+)?)/);
  if (m) return { value: Number(m[1].replace(',', '.')), rest: input.slice(m[0].length) };
  return null;
}

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
