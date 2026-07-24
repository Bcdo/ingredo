import { and, eq } from 'drizzle-orm';

import { newId } from './id';
import { notDeleted } from './predicates';
import { shoppingItems } from './schema';
import type { DB } from './types';
import { itemKey, normalizeName, sumQuantities, type AggregatedItem } from '../shopping';

export type AddMode = 'skip-existing' | 'merge';

export function parseSources(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function mergeSources(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  for (const source of incoming) {
    if (!merged.includes(source)) merged.push(source);
  }
  return merged;
}

// Defensive: collapse same-key duplicates within one batch so the write loop
// below never has to reconcile an item with a row it just inserted.
function premerge(items: AggregatedItem[]): AggregatedItem[] {
  const byKey = new Map<string, AggregatedItem>();
  for (const item of items) {
    const key = itemKey(item);
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, { ...item, sources: [...item.sources] });
      continue;
    }
    prior.quantity = sumQuantities(prior.quantity, item.quantity);
    prior.sources = mergeSources(prior.sources, item.sources);
  }
  return Array.from(byKey.values());
}

export function addItems(db: DB, items: AggregatedItem[], mode: AddMode): number {
  const batch = premerge(items);
  if (batch.length === 0) return 0;
  const now = Date.now();
  let written = 0;
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    const activeRows = txDb
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.status, 'active'), notDeleted(shoppingItems)))
      .all();
    const byKey = new Map(activeRows.map((row) => [itemKey(row), row]));
    for (const item of batch) {
      const existing = byKey.get(itemKey(item));
      if (!existing) {
        txDb
          .insert(shoppingItems)
          .values({
            id: newId(),
            name: item.name,
            normalizedName: item.normalizedName,
            quantity: item.quantity,
            unit: item.unit,
            sources: JSON.stringify(item.sources),
            status: 'active',
            purchasedAt: null,
            createdAt: now,
            updatedAt: now,
            dirty: 1,
          })
          .run();
        written += 1;
        continue;
      }
      if (mode === 'skip-existing') continue;
      txDb
        .update(shoppingItems)
        .set({
          quantity: sumQuantities(existing.quantity, item.quantity),
          sources: JSON.stringify(mergeSources(parseSources(existing.sources), item.sources)),
          updatedAt: now,
          dirty: 1,
        })
        .where(eq(shoppingItems.id, existing.id))
        .run();
      written += 1;
    }
  });
  return written;
}

export function addManualItem(db: DB, rawName: string): boolean {
  const name = rawName.trim();
  if (name === '') return false;
  addItems(
    db,
    [{ name, normalizedName: normalizeName(name), quantity: null, unit: null, sources: [] }],
    'merge'
  );
  return true;
}

export function purchaseItem(db: DB, id: string): void {
  const now = Date.now();
  db.update(shoppingItems)
    .set({ status: 'purchased', purchasedAt: now, updatedAt: now, dirty: 1 })
    .where(and(eq(shoppingItems.id, id), notDeleted(shoppingItems)))
    .run();
}

export function restoreItem(db: DB, id: string): void {
  db.update(shoppingItems)
    .set({ status: 'active', purchasedAt: null, updatedAt: Date.now(), dirty: 1 })
    .where(and(eq(shoppingItems.id, id), notDeleted(shoppingItems)))
    .run();
}

// Quick re-add from the shelf: copy a purchased row into a fresh active
// item. The purchased row is history and stays untouched; recipe sources
// are dropped because last month's attribution would mislead in the aisle.
export function readdItem(db: DB, id: string): void {
  const row = db
    .select()
    .from(shoppingItems)
    .where(and(eq(shoppingItems.id, id), notDeleted(shoppingItems)))
    .get();
  if (!row) return;
  addItems(
    db,
    [
      {
        name: row.name,
        normalizedName: row.normalizedName,
        quantity: row.quantity,
        unit: row.unit,
        sources: [],
      },
    ],
    'merge'
  );
}
