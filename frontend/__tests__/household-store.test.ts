import { makeTestDb } from './helpers/testDb';
import {
  getActiveHouseholdId,
  initActiveHousehold,
  resetActiveHouseholdForTests,
  setActiveHouseholdId,
} from '../lib/household';
import { applyAuthResponse, resetSessionForTests, setSessionSignedOut } from '../lib/api/session';

function authFor(householdId: string) {
  return {
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u1',
      email: 'a@b.c',
      displayName: 'A',
      householdId,
      householdName: 'Home',
    },
  };
}

describe('active household store', () => {
  beforeEach(() => {
    resetActiveHouseholdForTests();
    resetSessionForTests();
  });

  it('starts null on a fresh device and loads the persisted partition', () => {
    const db = makeTestDb();
    initActiveHousehold(db);
    expect(getActiveHouseholdId()).toBeNull();

    setActiveHouseholdId('h1');

    // A second init (fresh app start) reads the persisted value back.
    resetActiveHouseholdForTests();
    initActiveHousehold(db);
    expect(getActiveHouseholdId()).toBe('h1');
  });

  it('follows the session household on sign-in and rotation', async () => {
    const db = makeTestDb();
    initActiveHousehold(db);

    await applyAuthResponse(authFor('h1'));
    expect(getActiveHouseholdId()).toBe('h1');

    await applyAuthResponse(authFor('h2'));
    expect(getActiveHouseholdId()).toBe('h2');
  });

  it('keeps the last-active household across sign-out', async () => {
    const db = makeTestDb();
    initActiveHousehold(db);

    await applyAuthResponse(authFor('h1'));
    setSessionSignedOut();
    expect(getActiveHouseholdId()).toBe('h1');
  });

  it('stops following after teardown', async () => {
    const db = makeTestDb();
    const teardown = initActiveHousehold(db);
    teardown();

    await applyAuthResponse(authFor('h1'));
    expect(getActiveHouseholdId()).toBeNull();
  });
});
