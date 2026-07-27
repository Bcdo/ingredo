import { eq } from 'drizzle-orm';
import { useSyncExternalStore } from 'react';

import { getSession, subscribeSession } from './api/session';
import { settings } from './db/schema';
import type { DB } from './db/types';

// The device's active household partition — module-state + subscriber-hook
// idiom (see lib/api/session.ts). Persisted as device-local bookkeeping in
// the settings table (like sync_cursor — excluded if settings ever sync).
// Sign-out does NOT clear it: the last-active household stays visible and
// editable, local-first. It is null only on a device that never signed in.
const ACTIVE_HOUSEHOLD_KEY = 'active_household_id';

let activeHouseholdId: string | null = null;
let persistDb: DB | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveHouseholdId(): string | null {
  return activeHouseholdId;
}

export function useActiveHouseholdId(): string | null {
  return useSyncExternalStore(subscribe, getActiveHouseholdId);
}

export function setActiveHouseholdId(id: string | null): void {
  if (id === activeHouseholdId) return;
  activeHouseholdId = id;
  if (persistDb) {
    if (id === null) {
      persistDb.delete(settings).where(eq(settings.key, ACTIVE_HOUSEHOLD_KEY)).run();
    } else {
      persistDb
        .insert(settings)
        .values({ key: ACTIVE_HOUSEHOLD_KEY, value: id })
        .onConflictDoUpdate({ target: settings.key, set: { value: id } })
        .run();
    }
  }
  emit();
}

// Loads the persisted partition and follows the session: any non-null
// session household (sign-in, join/leave/switch token rotations) becomes
// the active partition. Sign-out emits householdId null and is ignored.
export function initActiveHousehold(db: DB): () => void {
  persistDb = db;
  const row = db.select().from(settings).where(eq(settings.key, ACTIVE_HOUSEHOLD_KEY)).get();
  activeHouseholdId = row?.value ?? null;
  emit();
  return subscribeSession(() => {
    const sessionHouseholdId = getSession().householdId;
    if (sessionHouseholdId !== null) setActiveHouseholdId(sessionHouseholdId);
  });
}

export function resetActiveHouseholdForTests(): void {
  activeHouseholdId = null;
  persistDb = null;
  listeners.clear();
}
