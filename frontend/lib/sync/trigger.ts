import { AppState } from 'react-native';

import { getSession } from '../api/session';

// The engine is imported LAZILY at fire time: repositories call
// scheduleSync(), and a static engine import would drag lib/db/client
// (expo-sqlite) into every node-side repository test. Fire only happens
// signed in, which node tests never are.
async function fireSync(): Promise<void> {
  if (getSession().status !== 'signedIn') return;
  const engine = await import('./engine');
  void engine.syncNow();
}

let timer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

export function scheduleSync(): void {
  if (getSession().status !== 'signedIn') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void fireSync();
  }, DEBOUNCE_MS);
}

// Foreground trigger. Returns the unsubscribe for the layout effect.
export function initSyncTriggers(): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void fireSync();
  });
  return () => subscription.remove();
}
