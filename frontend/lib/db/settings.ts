import { eq } from 'drizzle-orm';

import { settings } from './schema';
import type { DB } from './types';

export type UnitSystem = 'metric' | 'us';

const UNIT_SYSTEM_KEY = 'unit_system';

export function getUnitSystem(db: DB): UnitSystem {
  const row = db.select().from(settings).where(eq(settings.key, UNIT_SYSTEM_KEY)).get();
  return row?.value === 'us' ? 'us' : 'metric';
}

export function setUnitSystem(db: DB, system: UnitSystem): void {
  db.insert(settings)
    .values({ key: UNIT_SYSTEM_KEY, value: system })
    .onConflictDoUpdate({ target: settings.key, set: { value: system } })
    .run();
}

export type ColorMode = 'light' | 'dark' | 'system';

const COLOR_MODE_KEY = 'color_mode';

// Device-local preference — must be excluded if settings ever sync.
export function getColorMode(db: DB): ColorMode {
  const row = db.select().from(settings).where(eq(settings.key, COLOR_MODE_KEY)).get();
  const value = row?.value;
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function setColorMode(db: DB, mode: ColorMode): void {
  db.insert(settings)
    .values({ key: COLOR_MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: settings.key, set: { value: mode } })
    .run();
}
