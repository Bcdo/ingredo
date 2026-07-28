import { useSyncExternalStore } from 'react';

export type SyncState = 'idle' | 'syncing' | 'error';

export type SyncStatus = {
  state: SyncState;
  lastSyncedAt: number | null;
  pendingConflicts: number;
};

let status: SyncStatus = { state: 'idle', lastSyncedAt: null, pendingConflicts: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSyncStatus);
}

export function markSyncing(): void {
  status = { ...status, state: 'syncing' };
  emit();
}

export function markIdle(lastSyncedAt: number, pendingConflicts: number): void {
  status = { state: 'idle', lastSyncedAt, pendingConflicts };
  emit();
}

export function markError(): void {
  status = { ...status, state: 'error' };
  emit();
}

// An aborted cycle (mid-flight household switch or sign-out) returns to
// idle without pretending a sync completed — lastSyncedAt and the
// conflict count stay as they were.
export function markSkipped(): void {
  status = { ...status, state: 'idle' };
  emit();
}

// Seeds the persisted last_synced_at into memory at startup.
export function initLastSyncedAt(value: number | null): void {
  status = { ...status, lastSyncedAt: value };
  emit();
}

export function resetSyncStatusForTests(): void {
  status = { state: 'idle', lastSyncedAt: null, pendingConflicts: 0 };
  listeners.clear();
}
