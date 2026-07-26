import { asc, eq } from 'drizzle-orm';

import { shoppingItems } from '../lib/db/schema';
import {
  addItems,
  addManualItem,
  parseSources,
  purchaseItem,
  readdItem,
  restoreItem,
  setItemQuantity,
} from '../lib/db/shoppingList';
import type { DB } from '../lib/db/types';
import type { AggregatedItem } from '../lib/shopping';

import { makeTestDb } from './helpers/testDb';

const item = (overrides: Partial<AggregatedItem> = {}): AggregatedItem => ({
  name: 'Mel',
  normalizedName: 'mel',
  quantity: 500,
  unit: 'g',
  sources: ['Pannekaker'],
  ...overrides,
});

function allRows(db: DB) {
  return db.select().from(shoppingItems).orderBy(asc(shoppingItems.createdAt)).all();
}

describe('addItems', () => {
  it('inserts fresh active rows with sources as JSON', () => {
    const db = makeTestDb();
    const written = addItems(
      db,
      [item(), item({ name: 'Egg', normalizedName: 'egg', quantity: 3, unit: 'stk', sources: [] })],
      'merge'
    );

    expect(written).toBe(2);
    const rows = allRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'Mel',
      quantity: 500,
      unit: 'g',
      status: 'active',
      purchasedAt: null,
    });
    expect(parseSources(rows[0].sources)).toEqual(['Pannekaker']);
    expect(parseSources(rows[1].sources)).toEqual([]);
  });

  it('skip-existing mode leaves an existing active key untouched', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'skip-existing');
    const written = addItems(db, [item({ quantity: 900, sources: ['Vafler'] })], 'skip-existing');

    expect(written).toBe(0);
    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(500);
    expect(parseSources(rows[0].sources)).toEqual(['Pannekaker']);
  });

  it('merge mode sums quantities and unions sources on an existing active key', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const written = addItems(
      db,
      [item({ quantity: 250, sources: ['Vafler', 'Pannekaker'] })],
      'merge'
    );

    expect(written).toBe(1);
    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(750);
    expect(parseSources(rows[0].sources)).toEqual(['Pannekaker', 'Vafler']);
  });

  it('different unit buckets never merge', () => {
    const db = makeTestDb();
    addItems(
      db,
      [item({ name: 'Tomater', normalizedName: 'tomater', quantity: 400, unit: 'g' })],
      'merge'
    );
    addItems(
      db,
      [item({ name: 'Tomater', normalizedName: 'tomater', quantity: 2, unit: 'stk' })],
      'merge'
    );

    expect(allRows(db)).toHaveLength(2);
  });

  it('purchased rows are not merge targets — buying again creates a fresh active row', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    purchaseItem(db, allRows(db)[0].id);
    const written = addItems(db, [item({ quantity: 200 })], 'merge');

    expect(written).toBe(1);
    const rows = allRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(['active', 'purchased']);
    expect(rows.find((r) => r.status === 'active')!.quantity).toBe(200);
  });

  it('pre-merges duplicate keys within one incoming batch', () => {
    const db = makeTestDb();
    const written = addItems(
      db,
      [item({ quantity: 100 }), item({ quantity: 200, sources: ['Vafler'] })],
      'merge'
    );

    expect(written).toBe(1);
    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(300);
    expect(parseSources(rows[0].sources)).toEqual(['Pannekaker', 'Vafler']);
  });

  it('returns 0 for an empty batch', () => {
    const db = makeTestDb();
    expect(addItems(db, [], 'merge')).toBe(0);
  });
});

describe('addManualItem', () => {
  it('trims the name and stores a quantity-less item with no sources', () => {
    const db = makeTestDb();
    expect(addManualItem(db, '  Smør ')).toBe(true);

    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Smør',
      normalizedName: 'smør',
      quantity: null,
      unit: null,
    });
    expect(parseSources(rows[0].sources)).toEqual([]);
  });

  it('is a no-op on blank input', () => {
    const db = makeTestDb();
    expect(addManualItem(db, '   ')).toBe(false);
    expect(allRows(db)).toHaveLength(0);
  });

  it('merges into an existing unit-less active item instead of duplicating', () => {
    const db = makeTestDb();
    addManualItem(db, 'Smør');
    addManualItem(db, 'smør');
    expect(allRows(db)).toHaveLength(1);
  });
});

describe('purchase and restore', () => {
  it('round-trips status and preserves quantity', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const id = allRows(db)[0].id;

    purchaseItem(db, id);
    let row = db.select().from(shoppingItems).where(eq(shoppingItems.id, id)).get()!;
    expect(row.status).toBe('purchased');
    expect(row.purchasedAt).not.toBeNull();

    restoreItem(db, id);
    row = db.select().from(shoppingItems).where(eq(shoppingItems.id, id)).get()!;
    expect(row.status).toBe('active');
    expect(row.purchasedAt).toBeNull();
    expect(row.quantity).toBe(500);
  });
});

describe('parseSources', () => {
  it('returns [] for malformed JSON or non-array values', () => {
    expect(parseSources('not json')).toEqual([]);
    expect(parseSources('{"a":1}')).toEqual([]);
    expect(parseSources('["Suppe", 3]')).toEqual(['Suppe']);
  });
});

describe('readdItem', () => {
  it('copies a purchased row into a fresh active item with empty sources', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const original = allRows(db)[0];
    purchaseItem(db, original.id);

    readdItem(db, original.id);

    const rows = allRows(db);
    expect(rows).toHaveLength(2);
    const purchased = rows.find((r) => r.id === original.id)!;
    const copy = rows.find((r) => r.id !== original.id)!;
    expect(purchased.status).toBe('purchased');
    expect(purchased.purchasedAt).not.toBeNull();
    expect(parseSources(purchased.sources)).toEqual(['Pannekaker']);
    expect(copy).toMatchObject({
      name: 'Mel',
      normalizedName: 'mel',
      quantity: 500,
      unit: 'g',
      status: 'active',
      purchasedAt: null,
    });
    expect(parseSources(copy.sources)).toEqual([]);
  });

  it('merges into an existing active twin instead of duplicating', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const first = allRows(db)[0];
    purchaseItem(db, first.id);
    addItems(db, [item({ quantity: 200 })], 'merge');

    readdItem(db, first.id);

    const rows = allRows(db);
    expect(rows).toHaveLength(2);
    const active = rows.find((r) => r.status === 'active')!;
    expect(active.quantity).toBe(700); // 200 existing + 500 copied
  });

  it('is a no-op for an unknown id', () => {
    const db = makeTestDb();
    readdItem(db, 'nope');
    expect(allRows(db)).toHaveLength(0);
  });
});

describe('sync prep', () => {
  it('writes stamp the dirty flag on insert, merge, purchase, and restore', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const row = allRows(db)[0];
    expect(row.dirty).toBe(1);

    db.update(shoppingItems).set({ dirty: 0 }).where(eq(shoppingItems.id, row.id)).run();
    purchaseItem(db, row.id);
    expect(allRows(db)[0].dirty).toBe(1);

    db.update(shoppingItems).set({ dirty: 0 }).where(eq(shoppingItems.id, row.id)).run();
    restoreItem(db, row.id);
    expect(allRows(db)[0].dirty).toBe(1);
  });

  it('tombstoned active rows are invisible to merge', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const buried = allRows(db)[0];
    db.update(shoppingItems)
      .set({ deletedAt: Date.now() })
      .where(eq(shoppingItems.id, buried.id))
      .run();

    addItems(db, [item({ quantity: 200 })], 'merge');

    const rows = allRows(db);
    expect(rows).toHaveLength(2); // fresh row inserted; tombstone NOT merged into
    const live = rows.find((r) => r.deletedAt === null)!;
    expect(live.quantity).toBe(200);
  });

  it('readd is a no-op for a tombstoned source row', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const source = allRows(db)[0];
    purchaseItem(db, source.id);
    db.update(shoppingItems)
      .set({ deletedAt: Date.now() })
      .where(eq(shoppingItems.id, source.id))
      .run();

    readdItem(db, source.id);

    expect(allRows(db)).toHaveLength(1); // no copy was made from the tombstone
  });
});

describe('tombstone write-guards', () => {
  function tombstone(db: DB, id: string) {
    db.update(shoppingItems)
      .set({ deletedAt: Date.now(), updatedAt: Date.now(), dirty: 1 })
      .where(eq(shoppingItems.id, id))
      .run();
  }

  it('purchaseItem no-ops on a tombstoned item', () => {
    const db = makeTestDb();
    addManualItem(db, 'Melk');
    const row = db.select().from(shoppingItems).all()[0];
    tombstone(db, row.id);

    purchaseItem(db, row.id);

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.status).toBe('active');
    expect(after.purchasedAt).toBeNull();
  });

  it('restoreItem no-ops on a tombstoned item', () => {
    const db = makeTestDb();
    addManualItem(db, 'Melk');
    const row = db.select().from(shoppingItems).all()[0];
    purchaseItem(db, row.id);
    tombstone(db, row.id);
    const before = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;

    restoreItem(db, row.id);

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.status).toBe('purchased');
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});

describe('addManualItem parsing', () => {
  function onlyRow(db: ReturnType<typeof makeTestDb>) {
    const rows = db.select().from(shoppingItems).all();
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  it('parses amount and unit: "2 l melk"', () => {
    const db = makeTestDb();
    expect(addManualItem(db, '2 l melk')).toBe(true);
    const row = onlyRow(db);
    expect(row).toMatchObject({ name: 'melk', normalizedName: 'melk', quantity: 2, unit: 'l' });
  });

  it('parses a glued unit: "500g mel"', () => {
    const db = makeTestDb();
    addManualItem(db, '500g mel');
    expect(onlyRow(db)).toMatchObject({ name: 'mel', quantity: 500, unit: 'g' });
  });

  it('parses an amount without a unit: "2 melk"', () => {
    const db = makeTestDb();
    addManualItem(db, '2 melk');
    expect(onlyRow(db)).toMatchObject({ name: 'melk', quantity: 2, unit: null });
  });

  it('parses a unicode fraction: "½ agurk"', () => {
    const db = makeTestDb();
    addManualItem(db, '½ agurk');
    expect(onlyRow(db)).toMatchObject({ name: 'agurk', quantity: 0.5, unit: null });
  });

  it('plain names behave exactly as before', () => {
    const db = makeTestDb();
    addManualItem(db, 'melk');
    expect(onlyRow(db)).toMatchObject({ name: 'melk', quantity: null, unit: null });
  });

  it('still rejects blank input', () => {
    const db = makeTestDb();
    expect(addManualItem(db, '   ')).toBe(false);
    expect(db.select().from(shoppingItems).all()).toHaveLength(0);
  });

  it('merges same-name same-unit adds by summing', () => {
    const db = makeTestDb();
    addManualItem(db, '2 l melk');
    addManualItem(db, '1 l melk');
    expect(onlyRow(db)).toMatchObject({ quantity: 3, unit: 'l' });
  });
});

describe('setItemQuantity', () => {
  it('writes amount and unit, bumps updatedAt, stamps dirty', () => {
    const db = makeTestDb();
    addManualItem(db, 'melk');
    const before = db.select().from(shoppingItems).all()[0];
    const backdated = before.updatedAt - 10_000;
    db.update(shoppingItems).set({ dirty: 0, updatedAt: backdated }).run();

    setItemQuantity(db, before.id, 2, 'l');

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, before.id)).get()!;
    expect(after).toMatchObject({ quantity: 2, unit: 'l', dirty: 1 });
    expect(after.updatedAt).toBeGreaterThan(backdated);
  });

  it('null amount clears the unit too', () => {
    const db = makeTestDb();
    addManualItem(db, '2 l melk');
    const row = db.select().from(shoppingItems).all()[0];

    setItemQuantity(db, row.id, null, 'l');

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.quantity).toBeNull();
    expect(after.unit).toBeNull();
  });

  it('no-ops on tombstoned rows', () => {
    const db = makeTestDb();
    addManualItem(db, 'melk');
    const row = db.select().from(shoppingItems).all()[0];
    db.update(shoppingItems)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(shoppingItems.id, row.id))
      .run();
    const before = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;

    setItemQuantity(db, row.id, 5, 'kg');

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.quantity).toBe(before.quantity);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('no-ops on purchased rows (mid-edit purchase race)', () => {
    const db = makeTestDb();
    addManualItem(db, 'melk');
    const row = db.select().from(shoppingItems).all()[0];
    purchaseItem(db, row.id);
    const before = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;

    setItemQuantity(db, row.id, 9, 'kg');

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.quantity).toBe(before.quantity);
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});
