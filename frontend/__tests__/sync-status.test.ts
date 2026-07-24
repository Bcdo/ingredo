import {
  getSyncStatus,
  initLastSyncedAt,
  markError,
  markIdle,
  markSyncing,
  resetSyncStatusForTests,
} from '../lib/sync/status';

describe('sync status store', () => {
  beforeEach(() => resetSyncStatusForTests());

  it('starts idle with nothing synced', () => {
    expect(getSyncStatus()).toEqual({ state: 'idle', lastSyncedAt: null, pendingConflicts: 0 });
  });

  it('walks syncing → idle with timestamp and conflicts', () => {
    markSyncing();
    expect(getSyncStatus().state).toBe('syncing');
    markIdle(1753350000000, 2);
    expect(getSyncStatus()).toEqual({
      state: 'idle',
      lastSyncedAt: 1753350000000,
      pendingConflicts: 2,
    });
  });

  it('error keeps the previous lastSyncedAt', () => {
    markIdle(1753350000000, 0);
    markSyncing();
    markError();
    expect(getSyncStatus()).toEqual({
      state: 'error',
      lastSyncedAt: 1753350000000,
      pendingConflicts: 0,
    });
  });

  it('initLastSyncedAt seeds the persisted value on startup', () => {
    initLastSyncedAt(1753340000000);
    expect(getSyncStatus().lastSyncedAt).toBe(1753340000000);
  });
});
