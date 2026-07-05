export function parseQuantity(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function formatQuantity(quantity: number | null): string {
  if (quantity === null) return '';
  return String(Math.round(quantity * 100) / 100);
}
