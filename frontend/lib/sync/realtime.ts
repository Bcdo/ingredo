import {
  HttpTransportType,
  HubConnectionBuilder,
  LogLevel,
  type HubConnection,
} from '@microsoft/signalr';
import { AppState, type AppStateStatus } from 'react-native';

import { refreshSession } from '../api/client';
import { getApiBaseUrl } from '../api/config';
import { getAccessToken, getSession, subscribeSession } from '../api/session';
import { db } from '../db/client';
import { syncNow } from './engine';

// Realtime is an accelerator, never a dependency: a connection exists
// exactly when the user is signed in AND the app is foregrounded, every
// failure is silent, and the only thing a message does is nudge syncNow()
// — the engine's other triggers remain the correctness path.
let connection: HubConnection | null = null;
let connectedHouseholdId: string | null = null;
let appActive = AppState.currentState === 'active';

function shouldConnect(): boolean {
  return appActive && getSession().status === 'signedIn';
}

async function start(): Promise<void> {
  if (connection) return;
  connectedHouseholdId = getSession().householdId;
  const target = new HubConnectionBuilder()
    .withUrl(`${getApiBaseUrl(db)}/hubs/sync`, {
      transport: HttpTransportType.WebSockets,
      skipNegotiation: true,
      accessTokenFactory: async () => {
        if (!getAccessToken()) await refreshSession();
        return getAccessToken() ?? '';
      },
    })
    .withAutomaticReconnect()
    .configureLogging(__DEV__ ? LogLevel.Warning : LogLevel.None)
    .build();
  target.on('changed', () => {
    void syncNow();
  });
  connection = target;
  try {
    await target.start();
  } catch {
    // Silent: the next reconcile (foreground/session change) retries.
    if (connection === target) {
      connection = null;
      connectedHouseholdId = null;
    }
  }
}

async function stop(): Promise<void> {
  const current = connection;
  connection = null;
  connectedHouseholdId = null;
  if (current) {
    try {
      await current.stop();
    } catch {
      // Silent.
    }
  }
}

function reconcile(): void {
  if (!shouldConnect()) {
    void stop();
    return;
  }
  if (connection && connectedHouseholdId !== getSession().householdId) {
    // Join/leave/account switch rotated the household claim: reconnect so
    // the socket lands in the new household's group.
    void stop().then(() => {
      if (shouldConnect()) void start();
    });
    return;
  }
  if (!connection) void start();
}

export function initRealtime(): () => void {
  const unsubscribeSession = subscribeSession(reconcile);
  const appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    appActive = state === 'active';
    reconcile();
  });
  reconcile();
  return () => {
    unsubscribeSession();
    appStateSubscription.remove();
    void stop();
  };
}

export function resetRealtimeForTests(): void {
  connection = null;
  connectedHouseholdId = null;
  appActive = true;
}
