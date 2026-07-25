import { AppState } from 'react-native';

import { getSession, subscribeSession } from '../lib/api/session';
import { syncNow } from '../lib/sync/engine';
import { initRealtime, resetRealtimeForTests } from '../lib/sync/realtime';

const mockConnection = {
  on: jest.fn(),
  start: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
};

jest.mock('@microsoft/signalr', () => ({
  HubConnectionBuilder: jest.fn(() => ({
    withUrl: jest.fn().mockReturnThis(),
    withAutomaticReconnect: jest.fn().mockReturnThis(),
    configureLogging: jest.fn().mockReturnThis(),
    build: jest.fn(() => mockConnection),
  })),
  HttpTransportType: { WebSockets: 1 },
  LogLevel: { Warning: 2, None: 6 },
}));

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/api/config', () => ({ getApiBaseUrl: () => 'http://api.test' }));
jest.mock('../lib/api/client', () => ({ refreshSession: jest.fn(async () => true) }));
jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
  getAccessToken: jest.fn(() => 'access-1'),
  subscribeSession: jest.fn(() => () => {}),
}));
jest.mock('../lib/sync/engine', () => ({ syncNow: jest.fn(async () => 'synced') }));

const getSessionMock = getSession as jest.Mock;
const subscribeSessionMock = subscribeSession as jest.Mock;
const syncNowMock = syncNow as jest.Mock;

const signedIn = {
  status: 'signedIn',
  user: { id: 'u', email: 'e', displayName: 'd' },
  householdId: 'household-1',
  householdName: 'Hjemme',
};
const signedOut = { status: 'signedOut', user: null, householdId: null, householdName: null };

type AppStateListener = (state: string) => void;
let appStateListener: AppStateListener = () => {};
const removeMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  resetRealtimeForTests();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: AppStateListener
  ) => {
    appStateListener = listener;
    return { remove: removeMock };
  }) as never);
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('initRealtime', () => {
  it('connects when signed in and active', async () => {
    getSessionMock.mockReturnValue(signedIn);

    initRealtime();
    await flush();

    expect(mockConnection.start).toHaveBeenCalledTimes(1);
    expect(mockConnection.on).toHaveBeenCalledWith('changed', expect.any(Function));
  });

  it('does not connect signed out', async () => {
    getSessionMock.mockReturnValue(signedOut);

    initRealtime();
    await flush();

    expect(mockConnection.start).not.toHaveBeenCalled();
  });

  it('the changed handler triggers a sync', async () => {
    getSessionMock.mockReturnValue(signedIn);
    initRealtime();
    await flush();

    const handler = mockConnection.on.mock.calls.find((call) => call[0] === 'changed')![1];
    handler();
    await flush();

    expect(syncNowMock).toHaveBeenCalled();
  });

  it('backgrounding stops the connection', async () => {
    getSessionMock.mockReturnValue(signedIn);
    initRealtime();
    await flush();

    appStateListener('background');
    await flush();

    expect(mockConnection.stop).toHaveBeenCalled();
  });

  it('sign-out stops the connection via the session subscription', async () => {
    getSessionMock.mockReturnValue(signedIn);
    initRealtime();
    await flush();
    const sessionListener = subscribeSessionMock.mock.calls[0][0] as () => void;

    getSessionMock.mockReturnValue(signedOut);
    sessionListener();
    await flush();

    expect(mockConnection.stop).toHaveBeenCalled();
  });

  it('a household change restarts the connection', async () => {
    getSessionMock.mockReturnValue(signedIn);
    initRealtime();
    await flush();
    const sessionListener = subscribeSessionMock.mock.calls[0][0] as () => void;

    getSessionMock.mockReturnValue({ ...signedIn, householdId: 'household-2' });
    sessionListener();
    await flush();
    await flush();

    expect(mockConnection.stop).toHaveBeenCalledTimes(1);
    expect(mockConnection.start).toHaveBeenCalledTimes(2);
  });

  it('teardown unsubscribes and stops', async () => {
    getSessionMock.mockReturnValue(signedIn);
    const teardown = initRealtime();
    await flush();

    teardown();
    await flush();

    expect(removeMock).toHaveBeenCalled();
    expect(mockConnection.stop).toHaveBeenCalled();
  });
});
