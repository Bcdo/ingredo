import { eq } from 'drizzle-orm';

import { apiFetch } from '../lib/api/client';
import { getSession } from '../lib/api/session';
import { createRecipe } from '../lib/db/recipes';
import { recipes } from '../lib/db/schema';
import { getSyncCursor } from '../lib/sync/cursor';
import { resetEngineForTests, syncNow } from '../lib/sync/engine';
import { resetSyncStatusForTests } from '../lib/sync/status';
import { makeTestDb } from './helpers/testDb';

jest.mock('../lib/api/client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
}));

// Same rig as sync-engine.test.ts: createRecipe calls scheduleSync() as a
// side effect, which would otherwise start a real 2s debounce timer that
// outlives the test. The trigger module itself is covered by
// __tests__/sync-trigger.test.ts.
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

function asHousehold(householdId: string) {
  return {
    status: 'signedIn',
    user: { id: 'user-1', email: 'kari@example.test', displayName: 'Kari' },
    householdId,
    householdName: householdId,
  };
}

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
});

describe('per-household sync invariants', () => {
  it('switching households moves and duplicates nothing', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, 'h1', sampleRecipe());
    // cycle as h1: push applied, pull empty cursor 5
    getSessionMock.mockReturnValue(asHousehold('h1'));
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 999 })
      .mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 5 });
    await expect(syncNow()).resolves.toBe('synced');

    // switch to h2, cycle again: NOTHING to push (h1's row is clean and
    // out of scope), pull only
    getSessionMock.mockReturnValue(asHousehold('h2'));
    apiFetchMock.mockResolvedValueOnce({
      recipes: [],
      mealPlanEntries: [],
      shoppingItems: [],
      cursor: 2,
    });
    await expect(syncNow()).resolves.toBe('synced');

    expect(apiFetchMock).toHaveBeenCalledTimes(3); // one push total, two pulls
    const row = db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!;
    expect(row.householdId).toBe('h1');
    expect(row.dirty).toBe(0);
    expect(db.select().from(recipes).all()).toHaveLength(1); // no duplicate, no re-mint
  });

  it('cursors are independent per household', async () => {
    const db = freshDb();
    getSessionMock.mockReturnValue(asHousehold('h1'));
    apiFetchMock.mockResolvedValueOnce({
      recipes: [],
      mealPlanEntries: [],
      shoppingItems: [],
      cursor: 5,
    });
    await syncNow();
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/sync/changes?since=0');

    getSessionMock.mockReturnValue(asHousehold('h2'));
    apiFetchMock.mockResolvedValueOnce({
      recipes: [],
      mealPlanEntries: [],
      shoppingItems: [],
      cursor: 9,
    });
    await syncNow();
    expect(apiFetchMock.mock.calls[1][0]).toBe('/api/v1/sync/changes?since=0'); // h2 starts fresh

    getSessionMock.mockReturnValue(asHousehold('h1'));
    apiFetchMock.mockResolvedValueOnce({
      recipes: [],
      mealPlanEntries: [],
      shoppingItems: [],
      cursor: 6,
    });
    await syncNow();
    expect(apiFetchMock.mock.calls[2][0]).toBe('/api/v1/sync/changes?since=5'); // h1 resumes

    expect(getSyncCursor(db, 'h1')).toBe(6);
    expect(getSyncCursor(db, 'h2')).toBe(9);
  });

  it('adopts the NULL bucket exactly once, into the first synced household', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, null, sampleRecipe());
    getSessionMock.mockReturnValue(asHousehold('h1'));
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 1 })
      .mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 1 });
    await expect(syncNow()).resolves.toBe('synced');
    expect(db.select().from(recipes).get()!.householdId).toBe('h1');

    // second cycle as h2: the row belongs to h1 now — nothing adopted,
    // nothing pushed
    getSessionMock.mockReturnValue(asHousehold('h2'));
    apiFetchMock.mockResolvedValueOnce({
      recipes: [],
      mealPlanEntries: [],
      shoppingItems: [],
      cursor: 1,
    });
    await expect(syncNow()).resolves.toBe('synced');
    expect(db.select().from(recipes).get()!.householdId).toBe('h1');
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
  });

  it('a household switch during the push aborts before the pull and queues a follow-up', async () => {
    const db = freshDb();
    createRecipe(db, 'h1', sampleRecipe());
    getSessionMock.mockReturnValue(asHousehold('h1'));
    let resolvedFollowUp = false;
    apiFetchMock
      .mockImplementationOnce(async () => {
        // token rotates mid-push: the session now claims h2
        getSessionMock.mockReturnValue(asHousehold('h2'));
        return { results: {}, cursor: 1 };
      })
      // the queued follow-up cycle runs as h2: pull only
      .mockImplementationOnce(async () => {
        resolvedFollowUp = true;
        return { recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 4 };
      });

    await expect(syncNow()).resolves.toBe('skipped');
    // Drain the queued follow-up cycle's microtasks (same idiom as
    // sync-engine.test.ts's 'conflicted rows are re-minted and delivered
    // by an automatic follow-up' test).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolvedFollowUp).toBe(true);
    expect(apiFetchMock.mock.calls[1][0]).toBe('/api/v1/sync/changes?since=0');
    expect(getSyncCursor(db, 'h1')).toBe(0); // nothing stored under h1
    expect(getSyncCursor(db, 'h2')).toBe(4); // follow-up synced h2
  });

  it('a household switch during the pull discards the response — no cross-partition apply or cursor', async () => {
    const db = freshDb();
    getSessionMock.mockReturnValue(asHousehold('h1'));
    const foreignRow = {
      id: 'r-foreign',
      title: 'Suppe',
      description: null,
      servings: 2,
      notes: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      ingredients: [],
      instructions: [],
    };
    apiFetchMock
      .mockImplementationOnce(async () => {
        getSessionMock.mockReturnValue(asHousehold('h2'));
        return { recipes: [foreignRow], mealPlanEntries: [], shoppingItems: [], cursor: 8 };
      })
      .mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 2 });

    await expect(syncNow()).resolves.toBe('skipped');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(db.select().from(recipes).all()).toHaveLength(0); // response discarded
    expect(getSyncCursor(db, 'h1')).toBe(0);
    expect(getSyncCursor(db, 'h2')).toBe(2); // follow-up synced h2 cleanly
  });
});
