import { eq } from 'drizzle-orm';

import { apiFetch } from '../lib/api/client';
import { getSession } from '../lib/api/session';
import { createRecipe, updateRecipe } from '../lib/db/recipes';
import { recipes } from '../lib/db/schema';
import { resetEngineForTests, syncNow } from '../lib/sync/engine';
import { getSyncCursor, getSyncHouseholdId, storePullResult } from '../lib/sync/cursor';
import { getSyncStatus, resetSyncStatusForTests } from '../lib/sync/status';
import { makeTestDb } from './helpers/testDb';

jest.mock('../lib/api/client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
}));

// This file mocks getSession as signedIn to exercise the engine directly.
// createRecipe/updateRecipe below are the real repo functions (only db/client
// is mocked), and they now call scheduleSync() as a side effect — without
// this mock that starts a real 2s debounce timer that outlives the test and
// fires after Jest tears the module registry down. The trigger module itself
// is covered by __tests__/sync-trigger.test.ts.
jest.mock('../lib/sync/trigger', () => ({
  scheduleSync: jest.fn(),
}));

const mockDbHolder: { db: unknown } = { db: null };
jest.mock('../lib/db/client', () => ({
  get db() {
    return mockDbHolder.db;
  },
}));

const apiFetchMock = apiFetch as jest.Mock;
const getSessionMock = getSession as jest.Mock;

const signedIn = {
  status: 'signedIn',
  user: { id: 'user-1', email: 'kari@example.test', displayName: 'Kari' },
  householdId: 'household-1',
  householdName: 'Hjemme',
};

const emptyPull = { recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 7 };

const sampleRecipe = () => ({
  title: 'Taco',
  description: null,
  servings: 4,
  notes: null,
  ingredients: [{ name: 'Mel', quantity: 400, unit: 'g' }],
  instructions: [{ text: 'Bland.' }],
});

function freshDb() {
  const db = makeTestDb();
  mockDbHolder.db = db;
  return db;
}

beforeEach(() => {
  resetEngineForTests();
  resetSyncStatusForTests();
  apiFetchMock.mockReset();
  getSessionMock.mockReturnValue(signedIn);
});

describe('syncNow gating', () => {
  it.each(['signedOut', 'restoring'])('skips with zero fetches when %s', async (status) => {
    freshDb();
    getSessionMock.mockReturnValue({ ...signedIn, status, householdId: null, user: null });

    await expect(syncNow()).resolves.toBe('skipped');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('syncNow cycle', () => {
  it('pushes dirty rows then pulls, storing the pull cursor only', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 999 })
      .mockResolvedValueOnce(emptyPull);

    await expect(syncNow()).resolves.toBe('synced');

    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/sync/push');
    expect(apiFetchMock.mock.calls[1][0]).toBe('/api/v1/sync/changes?since=0');
    expect(getSyncCursor(db)).toBe(7); // pull cursor, never the push's 999
    expect(getSyncHouseholdId(db)).toBe('household-1');
    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(0);
    expect(getSyncStatus().state).toBe('idle');
    expect(getSyncStatus().lastSyncedAt).toBeGreaterThan(0);
  });

  it('skips the push entirely when nothing is dirty', async () => {
    const db = freshDb();
    createRecipe(db, sampleRecipe());
    db.update(recipes).set({ dirty: 0 }).run();
    storePullResult(db, 7, 'household-1');
    apiFetchMock.mockResolvedValueOnce({ ...emptyPull, cursor: 8 });

    await expect(syncNow()).resolves.toBe('synced');

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/sync/changes?since=7');
  });

  it('a mid-flight edit stays dirty (compare-and-clear)', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    apiFetchMock
      .mockImplementationOnce(async () => {
        // The user edits while the push request is on the wire.
        updateRecipe(db, recipeId, { ...sampleRecipe(), title: 'Redigert' });
        return { results: { [recipeId]: 'applied' }, cursor: 999 };
      })
      .mockResolvedValueOnce(emptyPull);

    await syncNow();

    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(1);
  });

  // Conflicts are now resolved automatically by re-minting (see ./sync-remint.test.ts
  // and the "automatic follow-up" test below) rather than staying dirty forever, so
  // this asserts the row is re-minted immediately and the conflict count already
  // reflects that resolution — it queues a follow-up cycle it does not wait for here.
  it('conflict outcomes are re-minted rather than left dirty and counted', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'conflict' }, cursor: 999 })
      .mockResolvedValueOnce(emptyPull)
      // Automatic follow-up cycle queued by the re-mint; give it a well-formed
      // response so it doesn't leak an unhandled failure into later tests.
      .mockResolvedValueOnce({ results: {}, cursor: 1000 })
      .mockResolvedValueOnce({ ...emptyPull, cursor: 1 });

    await syncNow();

    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()).toBeUndefined();
    expect(db.select().from(recipes).all()[0].dirty).toBe(1);
    expect(getSyncStatus().pendingConflicts).toBe(0);

    // Drain the follow-up cycle's microtasks so it doesn't spill into the next test.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('conflicted rows are re-minted and delivered by an automatic follow-up', async () => {
    const db = freshDb();
    const oldId = createRecipe(db, sampleRecipe());
    apiFetchMock
      // Cycle 1: everything conflicts (post-leave adoption against the old household).
      .mockResolvedValueOnce({ results: { [oldId]: 'conflict' }, cursor: 999 })
      .mockResolvedValueOnce({ ...emptyPull, cursor: 1 })
      // Follow-up: the re-minted row inserts cleanly.
      .mockImplementationOnce(async (path: string, init?: { body?: { recipes?: { id: string }[] } }) => {
        const pushed = init!.body!.recipes![0];
        expect(pushed.id).not.toBe(oldId);
        return { results: { [pushed.id]: 'applied' }, cursor: 1000 };
      })
      .mockResolvedValueOnce({ ...emptyPull, cursor: 2 });

    await syncNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiFetchMock).toHaveBeenCalledTimes(4);
    expect(db.select().from(recipes).where(eq(recipes.id, oldId)).get()).toBeUndefined();
    expect(db.select().from(recipes).all()[0].dirty).toBe(0);
    expect(getSyncStatus().pendingConflicts).toBe(0);
    expect(getSyncCursor(db)).toBe(2);
  });

  it('a failed push fails the cycle without clearing or moving the cursor', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    storePullResult(db, 7, 'household-1');
    apiFetchMock.mockRejectedValueOnce(new Error('down'));

    await expect(syncNow()).resolves.toBe('failed');

    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(1);
    expect(getSyncCursor(db)).toBe(7);
    expect(getSyncStatus().state).toBe('error');
  });

  it('household switch resets cursor and re-marks everything before pushing', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ dirty: 0 }).run();
    storePullResult(db, 500, 'old-household');
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 999 })
      .mockResolvedValueOnce(emptyPull);

    await syncNow();

    // The push happened (row was re-marked dirty by the switch)...
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/sync/push');
    // ...and the pull ran from zero.
    expect(apiFetchMock.mock.calls[1][0]).toBe('/api/v1/sync/changes?since=0');
    expect(getSyncHouseholdId(db)).toBe('household-1');
  });

  it('coalesces concurrent callers into the running cycle plus exactly one successful follow-up', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    let releasePush: (value: unknown) => void = () => {};
    apiFetchMock
      // Cycle 1 push: held open while the other callers pile up.
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releasePush = resolve;
          })
      )
      // Cycle 1 pull.
      .mockResolvedValueOnce({ ...emptyPull, cursor: 1 })
      // Follow-up cycle push: a real, well-formed response that clears the row.
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 998 })
      // Follow-up cycle pull.
      .mockResolvedValueOnce({ ...emptyPull, cursor: 2 });

    const first = syncNow();
    const second = syncNow();
    const third = syncNow();
    expect(second).toBe(first);
    expect(third).toBe(first);

    // Cycle 1's push response deliberately clears nothing (empty results),
    // so the follow-up has a dirty row to push — proving it genuinely runs.
    releasePush({ results: {}, cursor: 997 });
    await first;
    // Let the queued follow-up cycle run to completion.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Exactly 4 calls: (push, pull) for cycle 1 + (push, pull) for ONE
    // follow-up. A leaked re-queue would make a 5th call; a never-run
    // follow-up would stop at 2.
    expect(apiFetchMock).toHaveBeenCalledTimes(4);
    expect(apiFetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/sync/push',
      '/api/v1/sync/changes?since=0',
      '/api/v1/sync/push',
      '/api/v1/sync/changes?since=1',
    ]);
    // The follow-up completed successfully: row cleared, cursor from ITS pull.
    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(0);
    expect(getSyncCursor(db)).toBe(2);
    expect(getSyncStatus().state).toBe('idle');
  });

  it('a failed pull after a successful push never advances the cursor or household id', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    storePullResult(db, 7, 'household-1');
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 999 })
      .mockRejectedValueOnce(new Error('pull down'));

    await expect(syncNow()).resolves.toBe('failed');

    // The pushed row's dirty flag cleared (outcomes already processed) —
    // acceptable; what must NOT move is the pull bookkeeping.
    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(0);
    expect(getSyncCursor(db)).toBe(7);
    expect(getSyncHouseholdId(db)).toBe('household-1');
    expect(getSyncStatus().state).toBe('error');
  });

  it('applies pulled rows through the merge', async () => {
    const db = freshDb();
    storePullResult(db, 0, 'household-1');
    apiFetchMock.mockResolvedValueOnce({
      recipes: [
        {
          id: 'server-1',
          title: 'Fra serveren',
          description: null,
          servings: 4,
          notes: null,
          createdAt: 1000,
          updatedAt: 2000,
          deletedAt: null,
          ingredients: [],
          instructions: [],
        },
      ],
      mealPlanEntries: [],
      shoppingItems: [],
      cursor: 3,
    });

    await syncNow();

    expect(db.select().from(recipes).where(eq(recipes.id, 'server-1')).get()!.dirty).toBe(0);
    expect(getSyncCursor(db)).toBe(3);
  });
});
