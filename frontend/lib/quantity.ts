const FRACTION_GLYPHS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};
const GLYPH_CLASS = `[${Object.keys(FRACTION_GLYPHS).join('')}]`;

// Reads a leading amount in any of the shapes recipes use: "2", "1,5",
// "1/2", "1 1/2", "½", "1½". Returns the value and the unconsumed remainder,
// so the importer can go on to read a unit and a name. Shared with the form's
// quantity field, which requires the remainder to be empty.
export function parseAmount(input: string): { value: number; rest: string } | null {
  let m = input.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (m) {
    return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: input.slice(m[0].length) };
  }
  m = input.match(/^(\d+)\s*\/\s*(\d+)/);
  if (m) return { value: Number(m[1]) / Number(m[2]), rest: input.slice(m[0].length) };
  m = input.match(new RegExp(`^(\\d+)\\s*(${GLYPH_CLASS})`));
  if (m) return { value: Number(m[1]) + FRACTION_GLYPHS[m[2]], rest: input.slice(m[0].length) };
  m = input.match(new RegExp(`^(${GLYPH_CLASS})`));
  if (m) return { value: FRACTION_GLYPHS[m[1]], rest: input.slice(m[0].length) };
  m = input.match(/^(\d+(?:[.,]\d+)?)/);
  if (m) return { value: Number(m[1].replace(',', '.')), rest: input.slice(m[0].length) };
  return null;
}

export function parseQuantity(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const amount = parseAmount(trimmed);
  if (!amount || amount.rest.trim() !== '') return null;
  if (!Number.isFinite(amount.value) || amount.value <= 0) return null;
  return amount.value;
}

export function formatQuantity(quantity: number | null, locale: string = 'en'): string {
  if (quantity === null) return '';
  const text = String(Math.round(quantity * 100) / 100);
  return locale.startsWith('nb') ? text.replace('.', ',') : text;
}
