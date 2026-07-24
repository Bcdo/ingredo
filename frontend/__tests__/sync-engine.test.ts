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

  it('conflict outcomes stay dirty and are counted', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'conflict' }, cursor: 999 })
      .mockResolvedValueOnce(emptyPull);

    await syncNow();

    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(1);
    expect(getSyncStatus().pendingConflicts).toBe(1);
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

  it('coalesces concurrent callers into the running cycle plus one follow-up', async () => {
    const db = freshDb();
    createRecipe(db, sampleRecipe());
    let releasePush: (value: unknown) => void = () => {};
    apiFetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releasePush = resolve;
          })
      )
      .mockResolvedValue(emptyPull);

    const first = syncNow();
    const second = syncNow();
    const third = syncNow();
    expect(second).toBe(first);
    expect(third).toBe(first);

    releasePush({ results: {}, cursor: 1 });
    await first;
    // Allow the queued follow-up cycle to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // First cycle: push + pull. Follow-up: pull only (nothing dirty after...
    // the push cleared nothing here, rows stay dirty -> push + pull again).
    expect(apiFetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
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
