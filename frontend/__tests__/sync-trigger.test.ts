import { getSession, subscribeSession } from '../lib/api/session';
import { syncNow } from '../lib/sync/engine';
import { initSyncTriggers, scheduleSync } from '../lib/sync/trigger';

jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
  subscribeSession: jest.fn(),
}));

jest.mock('../lib/sync/engine', () => ({
  syncNow: jest.fn(async () => 'synced'),
}));

const getSessionMock = getSession as jest.Mock;
const subscribeSessionMock = subscribeSession as jest.Mock;
const syncNowMock = syncNow as jest.Mock;

const signedIn = {
  status: 'signedIn',
  user: { id: 'u', email: 'e', displayName: 'd' },
  householdId: 'h',
  householdName: 'n',
};
const signedOut = { status: 'signedOut', user: null, householdId: null, householdName: null };

beforeEach(() => {
  jest.useFakeTimers();
  syncNowMock.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('scheduleSync', () => {
  it('debounces bursts into one sync', async () => {
    getSessionMock.mockReturnValue(signedIn);

    scheduleSync();
    scheduleSync();
    scheduleSync();
    expect(syncNowMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2100);
    await Promise.resolve();
    await Promise.resolve();

    expect(syncNowMock).toHaveBeenCalledTimes(1);
  });

  it('is a no-op signed out — the timer never even starts', () => {
    getSessionMock.mockReturnValue(signedOut);

    scheduleSync();
    jest.advanceTimersByTime(5000);

    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it('gates again at fire time (sign-out during the debounce window)', async () => {
    getSessionMock.mockReturnValueOnce(signedIn).mockReturnValue(signedOut);

    scheduleSync();
    jest.advanceTimersByTime(2100);
    await Promise.resolve();
    await Promise.resolve();

    expect(syncNowMock).not.toHaveBeenCalled();
  });
});

describe('household-change trigger', () => {
  function initWithSession(session: unknown): { emit: () => void; teardown: () => void } {
    getSessionMock.mockReturnValue(session);
    let subscriber: () => void = () => {};
    subscribeSessionMock.mockImplementation((listener: () => void) => {
      subscriber = listener;
      return () => {};
    });
    const teardown = initSyncTriggers();
    return { emit: () => subscriber(), teardown };
  }

  it('fires a sync when the session household changes', async () => {
    const { emit, teardown } = initWithSession(signedOut);
    getSessionMock.mockReturnValue(signedIn); // householdId 'h'
    emit();
    await Promise.resolve();
    await Promise.resolve();

    expect(syncNowMock).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('does not fire on a same-household emit (token refresh)', async () => {
    const { emit, teardown } = initWithSession(signedIn);
    emit();
    await Promise.resolve();
    await Promise.resolve();

    expect(syncNowMock).not.toHaveBeenCalled();
    teardown();
  });

  it('sign-out then sign-in to the same household fires again', async () => {
    const { emit, teardown } = initWithSession(signedIn);
    getSessionMock.mockReturnValue(signedOut);
    emit(); // records null, no fire
    await Promise.resolve();
    await Promise.resolve();
    expect(syncNowMock).not.toHaveBeenCalled();

    getSessionMock.mockReturnValue(signedIn);
    emit();
    await Promise.resolve();
    await Promise.resolve();

    expect(syncNowMock).toHaveBeenCalledTimes(1);
    teardown();
  });
});
