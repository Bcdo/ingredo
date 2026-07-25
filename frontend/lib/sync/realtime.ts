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

// Access tokens live 15 minutes (see api/session.ts). Refresh proactively
// once a held token is older than this margin so a reconnect after a long
// idle stretch never replays an already-expired token. Gated by elapsed
// time rather than refreshing unconditionally on every call: SignalR's
// automatic reconnect invokes accessTokenFactory before EACH retry, and
// refreshSession() signs the whole session out on a network failure (see
// doRefresh's catch in api/client.ts) — refreshing on every retry would
// turn a plain backend outage into a forced sign-out on the very first
// reconnect attempt, defeating the reconnect-recovery fix below.
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
let lastTokenRefreshAt = 0;

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
        // Refresh when we hold no token, or when the held one is old
        // enough to likely have expired — see the module-level comment
        // on ACCESS_TOKEN_REFRESH_MARGIN_MS for why this is time-gated
        // rather than unconditional. refreshSession is single-flighted.
        if (!getAccessToken() || Date.now() - lastTokenRefreshAt > ACCESS_TOKEN_REFRESH_MARGIN_MS) {
          await refreshSession();
          lastTokenRefreshAt = Date.now();
        }
        return getAccessToken() ?? '';
      },
    })
    .withAutomaticReconnect()
    .configureLogging(__DEV__ ? LogLevel.Warning : LogLevel.None)
    .build();
  target.on('changed', () => {
    void syncNow();
  });
  target.onclose(() => {
    // Reconnect exhaustion (or a server-side close): forget the dead
    // connection so the next reconcile — foreground, session change, or
    // the next changed-driven sync — can start a fresh one.
    if (connection === target) {
      connection = null;
      connectedHouseholdId = null;
    }
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
  lastTokenRefreshAt = 0;
}
