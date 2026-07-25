import { eq } from 'drizzle-orm';

import { settings } from '../lib/db/schema';
import { dismissStaple, getStapleDismissals } from '../lib/suggestions/dismissals';
import { makeTestDb } from './helpers/testDb';

describe('staple dismissals', () => {
  it('starts empty and round-trips a dismissal', () => {
    const db = makeTestDb();
    expect(getStapleDismissals(db)).toEqual({});

    dismissStaple(db, 'melk', {});

    const stored = getStapleDismissals(db);
    expect(Object.keys(stored)).toEqual(['melk']);
    expect(stored.melk).toBeGreaterThan(0);
  });

  it('prunes entries whose item was purchased after the dismissal', () => {
    const db = makeTestDb();
    dismissStaple(db, 'melk', {});
    const dismissedAt = getStapleDismissals(db).melk;

    // Milk was bought again after the dismissal; dismissing bread prunes it.
    dismissStaple(db, 'brød', { melk: dismissedAt + 1000 });

    const stored = getStapleDismissals(db);
    expect(stored.melk).toBeUndefined();
    expect(stored['brød']).toBeGreaterThan(0);
  });

  it('keeps entries not purchased since dismissal', () => {
    const db = makeTestDb();
    dismissStaple(db, 'melk', {});
    const dismissedAt = getStapleDismissals(db).melk;

    dismissStaple(db, 'brød', { melk: dismissedAt - 1000 });

    expect(getStapleDismissals(db).melk).toBe(dismissedAt);
  });

  it('treats malformed stored JSON as empty', () => {
    const db = makeTestDb();
    db.insert(settings).values({ key: 'staple_dismissals', value: 'not json' }).run();

    expect(getStapleDismissals(db)).toEqual({});

    // And a write recovers the key.
    dismissStaple(db, 'melk', {});
    expect(Object.keys(getStapleDismissals(db))).toEqual(['melk']);
    const row = db.select().from(settings).where(eq(settings.key, 'staple_dismissals')).get();
    expect(() => JSON.parse(row!.value)).not.toThrow();
  });
});
