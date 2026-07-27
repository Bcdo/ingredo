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
import { type ConflictIds, remintConflicted } from './remint';
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
    let pendingConflicts = 0;
    if (!batch.isEmpty) {
      const response = await apiFetch<SyncPushResponseDto>('/api/v1/sync/push', {
        method: 'POST',
        body: batch.request,
      });
      const { conflicts, conflictIds } = clearPushed(db, batch, response.results);
      const reminted = remintConflicted(db, conflictIds);
      if (reminted > 0) {
        // Re-minted rows are fresh inserts for the current household —
        // deliver them in an immediate follow-up cycle.
        queued = true;
      }
      pendingConflicts = conflicts - reminted;
    }

    const since = getSyncCursor(db);
    const pull = await apiFetch<SyncPullResponseDto>(`/api/v1/sync/changes?since=${since}`);
    applyPull(db, pull, session.householdId);
    storePullResult(db, pull.cursor, session.householdId);

    markIdle(Date.now(), pendingConflicts);
    return 'synced';
  } catch {
    markError();
    return 'failed';
  }
}

// Compare-and-clear: dirty drops to 0 only if updatedAt still equals the
// value we pushed — an edit landing mid-flight keeps its dirty flag and
// wins the next cycle. Conflicted ids are collected per-table so the caller
// can re-mint their identity (see ./remint) instead of leaving them dirty
// forever.
function clearPushed(
  database: DB,
  batch: DirtyBatch,
  results: Record<string, string>
): { conflicts: number; conflictIds: ConflictIds } {
  let conflicts = 0;
  const conflictIds: ConflictIds = { recipes: [], mealPlanEntries: [], shoppingItems: [] };
  const tables = [
    { table: recipes, stamps: batch.stamps.recipes, key: 'recipes' as const },
    { table: mealPlanEntries, stamps: batch.stamps.mealPlanEntries, key: 'mealPlanEntries' as const },
    { table: shoppingItems, stamps: batch.stamps.shoppingItems, key: 'shoppingItems' as const },
  ] as const;
  for (const { table, stamps, key } of tables) {
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
        conflictIds[key].push(id);
      }
    }
  }
  return { conflicts, conflictIds };
}

export function resetEngineForTests(): void {
  running = null;
  queued = false;
}
