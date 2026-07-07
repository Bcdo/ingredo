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
