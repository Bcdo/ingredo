import { computeStaples, type PurchaseRow } from '../lib/suggestions/staples';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_753_000_000_000;

// Purchases of one item at the given day-offsets before NOW.
function purchases(name: string, daysAgo: number[], normalizedName = name.toLowerCase()): PurchaseRow[] {
  return daysAgo.map((days) => ({ normalizedName, name, purchasedAt: NOW - days * DAY }));
}

describe('computeStaples', () => {
  it('suggests a weekly staple that is due', () => {
    // Bought every 7 days, last one 6 days ago: 6 >= 0.8 * 7 = 5.6 → due.
    const rows = purchases('Melk', [20, 13, 6]);

    const result = computeStaples(rows, NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ normalizedName: 'melk', name: 'Melk' });
    expect(result[0].lastPurchasedAt).toBe(NOW - 6 * DAY);
  });

  it('does not suggest before 80% of the typical interval has passed', () => {
    // Weekly cadence, last purchase 5 days ago: 5 < 5.6 → not due.
    const rows = purchases('Melk', [19, 12, 5]);

    expect(computeStaples(rows, NOW)).toHaveLength(0);
  });

  it('requires at least three purchases', () => {
    const rows = purchases('Melk', [14, 7]);

    expect(computeStaples(rows, NOW)).toHaveLength(0);
  });

  it('uses the median gap so one vacation does not skew the cadence', () => {
    // Gaps: 7, 7, 28, 7 days → median 7. Last purchase 6 days ago → due.
    const rows = purchases('Melk', [55, 48, 41, 13, 6]);

    const result = computeStaples(rows, NOW);

    expect(result).toHaveLength(1);
    expect(result[0].normalizedName).toBe('melk');
  });

  it('ignores same-trip noise (median gap under a day)', () => {
    // Three purchases within hours of each other: one shopping event, not a cadence.
    const rows: PurchaseRow[] = [
      { normalizedName: 'melk', name: 'Melk', purchasedAt: NOW - 30 * DAY },
      { normalizedName: 'melk', name: 'Melk', purchasedAt: NOW - 30 * DAY + 1000 },
      { normalizedName: 'melk', name: 'Melk', purchasedAt: NOW - 30 * DAY + 2000 },
    ];

    expect(computeStaples(rows, NOW)).toHaveLength(0);
  });

  it('ignores habits slower than 60 days', () => {
    const rows = purchases('Julekrydder', [400, 200, 130]);

    expect(computeStaples(rows, NOW)).toHaveLength(0);
  });

  it('ranks by overdueness and caps at five', () => {
    const rows = [
      ...purchases('A', [21, 14, 7]), // weekly, 7/7 = 1.0 overdue
      ...purchases('B', [34, 24, 14]), // ten-daily, 14/10 = 1.4
      ...purchases('C', [26, 20, 14, 8]), // six-daily, 8/6 ≈ 1.33
      ...purchases('D', [15, 10, 5]), // five-daily, 5/5 = 1.0
      ...purchases('E', [12, 8, 4]), // four-daily, 4/4 = 1.0
      ...purchases('F', [9, 6, 3]), // three-daily, 3/3 = 1.0
    ];

    const result = computeStaples(rows, NOW);

    expect(result).toHaveLength(5);
    expect(result[0].normalizedName).toBe('b');
    expect(result[1].normalizedName).toBe('c');
    expect(result.map((s) => s.normalizedName)).toEqual(
      expect.arrayContaining(['b', 'c'])
    );
  });

  it('uses the freshest name casing for display', () => {
    const rows: PurchaseRow[] = [
      { normalizedName: 'melk', name: 'melk', purchasedAt: NOW - 20 * DAY },
      { normalizedName: 'melk', name: 'melk', purchasedAt: NOW - 13 * DAY },
      { normalizedName: 'melk', name: 'Melk', purchasedAt: NOW - 6 * DAY },
    ];

    expect(computeStaples(rows, NOW)[0].name).toBe('Melk');
  });
});
