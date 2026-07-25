import { eq } from 'drizzle-orm';

import { settings } from '../db/schema';
import type { DB } from '../db/types';

// Device-local preference — must be excluded if settings ever sync. A
// dismissal means "stop suggesting this"; it expires the next time the
// item is actually purchased (the section filters on that, and writes
// prune expired entries so the map stays small).
const DISMISSALS_KEY = 'staple_dismissals';

export function getStapleDismissals(db: DB): Record<string, number> {
  const row = db.select().from(settings).where(eq(settings.key, DISMISSALS_KEY)).get();
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function dismissStaple(
  db: DB,
  normalizedName: string,
  latestPurchases: Record<string, number>
): void {
  const current = getStapleDismissals(db);
  const pruned: Record<string, number> = {};
  for (const [key, dismissedAt] of Object.entries(current)) {
    const lastPurchase = latestPurchases[key];
    if (lastPurchase === undefined || lastPurchase <= dismissedAt) {
      pruned[key] = dismissedAt;
    }
  }
  pruned[normalizedName] = Date.now();
  const value = JSON.stringify(pruned);
  db.insert(settings)
    .values({ key: DISMISSALS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}
