import { eq } from 'drizzle-orm';
import { getColorMode, getUnitSystem, setColorMode, setUnitSystem } from '../lib/db/settings';
import { settings } from '../lib/db/schema';

import { makeTestDb } from './helpers/testDb';

describe('settings repository', () => {
  it('defaults to metric when unset', () => {
    const db = makeTestDb();
    expect(getUnitSystem(db)).toBe('metric');
  });

  it('persists and reads back the unit system', () => {
    const db = makeTestDb();
    setUnitSystem(db, 'us');
    expect(getUnitSystem(db)).toBe('us');
  });

  it('overwrites an existing value', () => {
    const db = makeTestDb();
    setUnitSystem(db, 'us');
    setUnitSystem(db, 'metric');
    expect(getUnitSystem(db)).toBe('metric');
  });

  it('falls back to metric on an unrecognized stored value', () => {
    const db = makeTestDb();
    setUnitSystem(db, 'us');
    db.update(settings).set({ value: 'imperial-ish' }).where(eq(settings.key, 'unit_system')).run();
    expect(getUnitSystem(db)).toBe('metric');
  });
});

describe('color mode', () => {
  it('defaults to system when unset', () => {
    const db = makeTestDb();
    expect(getColorMode(db)).toBe('system');
  });

  it('persists and reads back light and dark', () => {
    const db = makeTestDb();
    setColorMode(db, 'light');
    expect(getColorMode(db)).toBe('light');
    setColorMode(db, 'dark');
    expect(getColorMode(db)).toBe('dark');
  });

  it('falls back to system on an unrecognized stored value', () => {
    const db = makeTestDb();
    setColorMode(db, 'dark');
    db.update(settings).set({ value: 'midnight' }).where(eq(settings.key, 'color_mode')).run();
    expect(getColorMode(db)).toBe('system');
  });
});
