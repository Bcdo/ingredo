// Pure shopping-list aggregation: ingredient rows in, merged items out.
// Merge key = normalized name + unit bucket. Mass/volume quantities convert
// to base units (g/ml) and sum; 'stk' and free-text units merge only with
// their exact unit; unit-less rows form their own bucket. No name stemming:
// 'tomat' and 'tomater' stay separate lines (bilingual, no language parsing).
import { CANONICAL_MEASURES, type ScalingMode } from './units';

export type PlanIngredientRow = {
  entryServings: number;
  recipeServings: number;
  recipeTitle: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  scaling: ScalingMode;
};

export type AggregatedItem = {
  name: string;
  normalizedName: string;
  quantity: number | null;
  unit: string | null;
  sources: string[];
};

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function measureOf(unit: string | null) {
  return unit !== null && Object.hasOwn(CANONICAL_MEASURES, unit)
    ? CANONICAL_MEASURES[unit]
    : undefined;
}

// The stored unit for a bucket: mass → g, volume → ml, everything else as-is.
function baseUnit(unit: string | null): string | null {
  const measure = measureOf(unit);
  if (!measure) return unit;
  return measure.dimension === 'mass' ? 'g' : 'ml';
}

function baseQuantity(quantity: number, unit: string | null): number {
  const measure = measureOf(unit);
  return measure ? quantity * measure.toBase : quantity;
}

function unitBucket(unit: string | null): string {
  if (unit === null) return 'none';
  const measure = measureOf(unit);
  return measure ? measure.dimension : `u:${unit}`;
}

export function itemKey(item: { normalizedName: string; unit: string | null }): string {
  return `${item.normalizedName} ${unitBucket(item.unit)}`;
}

// Unspecified amounts ("to taste") contribute their source but no number;
// the sum is null only when every contribution is null.
export function sumQuantities(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export function aggregateRows(rows: PlanIngredientRow[]): AggregatedItem[] {
  const byKey = new Map<string, AggregatedItem>();
  for (const row of rows) {
    const normalizedName = normalizeName(row.name);
    if (normalizedName === '') continue;
    const factor = row.recipeServings > 0 ? row.entryServings / row.recipeServings : 1;
    const scaled =
      row.quantity === null ? null : row.scaling === 'fixed' ? row.quantity : row.quantity * factor;
    const quantity = scaled === null ? null : baseQuantity(scaled, row.unit);
    const key = itemKey({ normalizedName, unit: row.unit });
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name: row.name.trim(),
        normalizedName,
        quantity,
        unit: baseUnit(row.unit),
        sources: [row.recipeTitle],
      });
      continue;
    }
    existing.quantity = sumQuantities(existing.quantity, quantity);
    if (!existing.sources.includes(row.recipeTitle)) existing.sources.push(row.recipeTitle);
  }
  return Array.from(byKey.values());
}
