import { groupShelfItems, THIS_TRIP_MS, WEEK_MS, type ShelfRow } from '../lib/shelf';
import { itemKey } from '../lib/shopping';

const NOW = 1_800_000_000_000;

let nextId = 0;
const row = (overrides: Partial<ShelfRow> = {}): ShelfRow => ({
  id: `p${++nextId}`,
  name: 'Melk',
  normalizedName: 'melk',
  quantity: 1000,
  unit: 'ml',
  purchasedAt: NOW - 1000,
  ...overrides,
});

describe('groupShelfItems', () => {
  it('buckets by fixed windows with boundaries falling to the older side', () => {
    const groups = groupShelfItems(
      [
        row({ name: 'A', normalizedName: 'a', purchasedAt: NOW - THIS_TRIP_MS + 1 }),
        row({ name: 'B', normalizedName: 'b', purchasedAt: NOW - THIS_TRIP_MS }),
        row({ name: 'C', normalizedName: 'c', purchasedAt: NOW - WEEK_MS + 1 }),
        row({ name: 'D', normalizedName: 'd', purchasedAt: NOW - WEEK_MS }),
      ],
      new Set(),
      NOW
    );
    expect(groups.trip.map((r) => r.name)).toEqual(['A']);
    expect(groups.week.map((r) => r.name)).toEqual(['B', 'C']);
    expect(groups.older.map((r) => r.name)).toEqual(['D']);
  });

  it('dedupes by item key keeping the newest purchase', () => {
    const groups = groupShelfItems(
      [
        row({ id: 'old', purchasedAt: NOW - WEEK_MS - 1000 }),
        row({ id: 'new', purchasedAt: NOW - 1000 }),
        row({ id: 'mid', purchasedAt: NOW - THIS_TRIP_MS - 1000 }),
      ],
      new Set(),
      NOW
    );
    expect(groups.trip.map((r) => r.id)).toEqual(['new']);
    expect(groups.week).toEqual([]);
    expect(groups.older).toEqual([]);
  });

  it('same name in different unit buckets stays as distinct shelf items', () => {
    const groups = groupShelfItems(
      [
        row({ id: 'grams', name: 'Tomater', normalizedName: 'tomater', unit: 'g' }),
        row({ id: 'count', name: 'Tomater', normalizedName: 'tomater', unit: 'stk' }),
      ],
      new Set(),
      NOW
    );
    expect(groups.trip.map((r) => r.id).sort()).toEqual(['count', 'grams']);
  });

  it('hides items whose key is in the active set', () => {
    const hidden = row({ purchasedAt: NOW - 1000 });
    const groups = groupShelfItems([hidden], new Set([itemKey(hidden)]), NOW);
    expect(groups.trip).toEqual([]);
    expect(groups.week).toEqual([]);
    expect(groups.older).toEqual([]);
  });

  it('sorts each group by purchase time, newest first', () => {
    const groups = groupShelfItems(
      [
        row({ name: 'E', normalizedName: 'e', purchasedAt: NOW - 3000 }),
        row({ name: 'F', normalizedName: 'f', purchasedAt: NOW - 1000 }),
        row({ name: 'G', normalizedName: 'g', purchasedAt: NOW - 2000 }),
      ],
      new Set(),
      NOW
    );
    expect(groups.trip.map((r) => r.name)).toEqual(['F', 'G', 'E']);
  });

  it('skips rows with a null purchasedAt and handles empty input', () => {
    expect(groupShelfItems([], new Set(), NOW)).toEqual({ trip: [], week: [], older: [] });
    const groups = groupShelfItems([row({ purchasedAt: null })], new Set(), NOW);
    expect(groups).toEqual({ trip: [], week: [], older: [] });
  });
});
