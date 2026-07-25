// The staples heuristic: pure, language-neutral (groups by normalizedName,
// never parses text). A staple is an item bought at least three times at a
// habitual cadence; it is suggested when that cadence says it is due.
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PURCHASES = 3;
const MIN_TYPICAL_INTERVAL_MS = DAY_MS; // three buys in one trip is noise
const MAX_TYPICAL_INTERVAL_MS = 60 * DAY_MS; // slower than this predicts nothing
const DUE_RATIO = 0.8;
const MAX_SUGGESTIONS = 5;

export type PurchaseRow = {
  normalizedName: string;
  name: string;
  purchasedAt: number;
};

export type StapleSuggestion = {
  normalizedName: string;
  name: string;
  lastPurchasedAt: number;
  overdueness: number;
};

function median(sortedAscending: number[]): number {
  const mid = Math.floor(sortedAscending.length / 2);
  return sortedAscending.length % 2 === 1
    ? sortedAscending[mid]
    : (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

export function computeStaples(rows: PurchaseRow[], now: number): StapleSuggestion[] {
  const groups = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const group = groups.get(row.normalizedName);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.normalizedName, [row]);
    }
  }

  const suggestions: StapleSuggestion[] = [];
  for (const group of groups.values()) {
    if (group.length < MIN_PURCHASES) continue;
    const times = group.map((row) => row.purchasedAt).sort((a, b) => a - b);
    const gaps = times
      .slice(1)
      .map((time, index) => time - times[index])
      .sort((a, b) => a - b);
    const typicalInterval = median(gaps);
    if (typicalInterval < MIN_TYPICAL_INTERVAL_MS) continue;
    if (typicalInterval > MAX_TYPICAL_INTERVAL_MS) continue;
    const lastPurchasedAt = times[times.length - 1];
    const elapsed = now - lastPurchasedAt;
    if (elapsed < DUE_RATIO * typicalInterval) continue;
    const freshest = group.reduce((a, b) => (a.purchasedAt >= b.purchasedAt ? a : b));
    suggestions.push({
      normalizedName: freshest.normalizedName,
      name: freshest.name,
      lastPurchasedAt,
      overdueness: elapsed / typicalInterval,
    });
  }

  return suggestions
    .sort((a, b) => b.overdueness - a.overdueness)
    .slice(0, MAX_SUGGESTIONS);
}
