// Pure grouping for the Recently Purchased shelf: purchased rows in, a
// time-bucketed staples library out. One card per item key (newest purchase
// wins), keys with an active row are hidden, fixed windows, clock injected
// by the caller. Boundary ages fall to the older side.
import { itemKey } from './shopping';

export const THIS_TRIP_MS = 6 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ShelfRow = {
  id: string;
  name: string;
  normalizedName: string;
  quantity: number | null;
  unit: string | null;
  purchasedAt: number | null;
};

export type ShelfGroups<T extends ShelfRow> = { trip: T[]; week: T[]; older: T[] };

export function groupShelfItems<T extends ShelfRow>(
  purchasedRows: T[],
  activeKeys: Set<string>,
  now: number
): ShelfGroups<T> {
  const newestByKey = new Map<string, T>();
  for (const row of purchasedRows) {
    if (row.purchasedAt === null) continue;
    const key = itemKey(row);
    const current = newestByKey.get(key);
    if (!current || row.purchasedAt > (current.purchasedAt ?? 0)) {
      newestByKey.set(key, row);
    }
  }

  const groups: ShelfGroups<T> = { trip: [], week: [], older: [] };
  for (const [key, row] of newestByKey) {
    if (activeKeys.has(key)) continue;
    const age = now - (row.purchasedAt ?? 0);
    if (age < THIS_TRIP_MS) groups.trip.push(row);
    else if (age < WEEK_MS) groups.week.push(row);
    else groups.older.push(row);
  }

  for (const bucket of [groups.trip, groups.week, groups.older]) {
    bucket.sort((a, b) => (b.purchasedAt ?? 0) - (a.purchasedAt ?? 0));
  }
  return groups;
}
