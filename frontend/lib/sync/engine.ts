import { and, eq } from 'drizzle-orm';

import { apiFetch } from '../api/client';
import { getSession } from '../api/session';
import type { SyncPullResponseDto, SyncPushResponseDto } from '../api/types';
import { db } from '../db/client';
import { mealPlanEntries, recipes, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';
import { applyPull } from './apply';
import { collectDirty, type DirtyBatch } from './collect';
import { ensureHousehold, getSyncCursor, storePullResult } from './cursor';
import { markError, markIdle, markSyncing } from './status';

export type SyncResult = 'synced' | 'failed' | 'skipped';

let running: Promise<SyncResult> | null = null;
let queued = false;

// One cycle at a time; triggers landing mid-cycle coalesce into exactly one
// follow-up run (their data is picked up by that run's collect).
export function syncNow(): Promise<SyncResult> {
  if (running) {
    queued = true;
    return running;
  }
  running = runCycle().finally(() => {
    running = null;
    if (queued) {
      queued = false;
      void syncNow();
    }
  });
  return running;
}

async function runCycle(): Promise<SyncResult> {
  const session = getSession();
  if (session.status !== 'signedIn' || !session.householdId) return 'skipped';

  markSyncing();
  try {
    ensureHousehold(db, session.householdId);

    const batch = collectDirty(db);
    let conflicts = 0;
    if (!batch.isEmpty) {
      const response = await apiFetch<SyncPushResponseDto>('/api/v1/sync/push', {
        method: 'POST',
        body: batch.request,
      });
      conflicts = clearPushed(db, batch, response.results);
    }

    const since = getSyncCursor(db);
    const pull = await apiFetch<SyncPullResponseDto>(`/api/v1/sync/changes?since=${since}`);
    applyPull(db, pull);
    storePullResult(db, pull.cursor, session.householdId);

    markIdle(Date.now(), conflicts);
    return 'synced';
  } catch {
    markError();
    return 'failed';
  }
}

// Compare-and-clear: dirty drops to 0 only if updatedAt still equals the
// value we pushed — an edit landing mid-flight keeps its dirty flag and
// wins the next cycle. Conflicts stay dirty and are surfaced in status.
function clearPushed(database: DB, batch: DirtyBatch, results: Record<string, string>): number {
  let conflicts = 0;
  const tables = [
    { table: recipes, stamps: batch.stamps.recipes },
    { table: mealPlanEntries, stamps: batch.stamps.mealPlanEntries },
    { table: shoppingItems, stamps: batch.stamps.shoppingItems },
  ] as const;
  for (const { table, stamps } of tables) {
    for (const [id, readUpdatedAt] of stamps) {
      const outcome = results[id];
      if (outcome === 'applied' || outcome === 'superseded') {
        database
          .update(table)
          .set({ dirty: 0 })
          .where(and(eq(table.id, id), eq(table.updatedAt, readUpdatedAt)))
          .run();
      } else if (outcome === 'conflict') {
        conflicts += 1;
      }
    }
  }
  return conflicts;
}

export function resetEngineForTests(): void {
  running = null;
  queued = false;
}
