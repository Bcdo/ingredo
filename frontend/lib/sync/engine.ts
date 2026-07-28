import { and, eq } from 'drizzle-orm';

import { apiFetch, HouseholdRotatedError } from '../api/client';
import { getSession } from '../api/session';
import type { SyncPullResponseDto, SyncPushResponseDto } from '../api/types';
import { db } from '../db/client';
import { mealPlanEntries, recipes, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';
import { applyPull } from './apply';
import { collectDirty, type DirtyBatch } from './collect';
import { adoptNullBucket, getSyncCursor, storePullResult } from './cursor';
import { type ConflictIds, remintConflicted } from './remint';
import { markError, markIdle, markSkipped, markSyncing } from './status';

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
  const householdId = session.householdId;

  // The cycle is pinned to the household captured above. Requests carry
  // whatever token is CURRENT, so a rotation mid-cycle (switch, join,
  // leave, sign-out) would push this partition's rows into the new
  // claim's household or store a cursor under the wrong key — re-verify
  // at every await boundary and abort instead. The queued follow-up
  // syncs whatever household is active by then. The pre-push check also
  // guards the synchronous collect window against future refactors that
  // introduce earlier awaits.
  const stillCurrent = () => getSession().householdId === householdId;
  const abort = (): SyncResult => {
    queued = true;
    markSkipped();
    return 'skipped';
  };

  markSyncing();
  try {
    adoptNullBucket(db, householdId);

    const batch = collectDirty(db, householdId);
    let pendingConflicts = 0;
    if (!batch.isEmpty) {
      if (!stillCurrent()) return abort();
      const response = await apiFetch<SyncPushResponseDto>('/api/v1/sync/push', {
        method: 'POST',
        body: batch.request,
        expectedHouseholdId: householdId,
      });
      const { conflicts, conflictIds } = clearPushed(db, batch, response.results);
      const reminted = remintConflicted(db, conflictIds);
      if (reminted > 0) {
        // Re-minted rows are fresh inserts, dirty under the pinned
        // household above. They are only delivered once a cycle runs for
        // THAT household again — the immediate follow-up queued here syncs
        // whatever household is active by then, which may be a different
        // one (see abort()); it does not guarantee these rows go out next.
        queued = true;
      }
      pendingConflicts = conflicts - reminted;
    }

    if (!stillCurrent()) return abort();
    const since = getSyncCursor(db, householdId);
    const pull = await apiFetch<SyncPullResponseDto>(`/api/v1/sync/changes?since=${since}`, {
      expectedHouseholdId: householdId,
    });
    if (!stillCurrent()) return abort();
    applyPull(db, pull, householdId);
    storePullResult(db, householdId, pull.cursor);

    markIdle(Date.now(), pendingConflicts);
    return 'synced';
  } catch (error) {
    if (error instanceof HouseholdRotatedError) return abort();
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
