export function parseQuantity(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function formatQuantity(quantity: number | null, locale: string = 'en'): string {
  if (quantity === null) return '';
  const text = String(Math.round(quantity * 100) / 100);
  return locale.startsWith('nb') ? text.replace('.', ',') : text;
}
