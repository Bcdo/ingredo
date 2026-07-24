import { getSession } from '../lib/api/session';
import { syncNow } from '../lib/sync/engine';
import { scheduleSync } from '../lib/sync/trigger';

jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
}));

jest.mock('../lib/sync/engine', () => ({
  syncNow: jest.fn(async () => 'synced'),
}));

const getSessionMock = getSession as jest.Mock;
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
