import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { AccountSection } from '../components/settings/AccountSection';
import { getHousehold, joinHousehold, signOut } from '../lib/api/auth';
import { useSession } from '../lib/api/session';
import { syncNow } from '../lib/sync/engine';
import { useSyncStatus } from '../lib/sync/status';

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/api/auth', () => ({
  getHousehold: jest.fn(),
  joinHousehold: jest.fn(),
  leaveHousehold: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('../lib/api/session', () => ({
  useSession: jest.fn(),
}));
jest.mock('../lib/api/config', () => ({
  getApiUrlOverride: jest.fn(() => null),
  setApiUrlOverride: jest.fn(),
}));
jest.mock('../lib/sync/engine', () => ({
  syncNow: jest.fn(async () => 'synced'),
}));
jest.mock('../lib/sync/status', () => ({
  useSyncStatus: jest.fn(() => ({ state: 'idle', lastSyncedAt: null, pendingConflicts: 0 })),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const useSessionMock = useSession as jest.Mock;
const getHouseholdMock = getHousehold as jest.Mock;
const joinHouseholdMock = joinHousehold as jest.Mock;
const signOutMock = signOut as jest.Mock;

const signedOut = { status: 'signedOut', user: null, householdId: null, householdName: null };
const signedIn = {
  status: 'signedIn',
  user: { id: 'user-1', email: 'kari@example.test', displayName: 'Kari' },
  householdId: 'household-1',
  householdName: 'Karis husstand',
};
const household = {
  id: 'household-1',
  name: 'Karis husstand',
  joinCode: 'ABC-DEF',
  members: [
    { userId: 'user-1', displayName: 'Kari', role: 'owner', joinedAt: '2026-07-01T00:00:00Z' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AccountSection signed out', () => {
  it('shows the sign-in CTA and fetches nothing', () => {
    useSessionMock.mockReturnValue(signedOut);
    render(<AccountSection />);

    fireEvent.press(screen.getByText('Sign in'));
    expect(mockPush).toHaveBeenCalledWith('/account/sign-in');
    expect(getHouseholdMock).not.toHaveBeenCalled();
  });
});

describe('AccountSection signed in', () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue(signedIn);
    getHouseholdMock.mockResolvedValue(household);
  });

  it('shows email, household name, join code and members', async () => {
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.getByText('kari@example.test')).toBeOnTheScreen();
    expect(screen.getByText('Karis husstand')).toBeOnTheScreen();
    expect(screen.getByText('ABC-DEF')).toBeOnTheScreen();
    expect(screen.getByText('Kari')).toBeOnTheScreen();
  });

  it('joins another household with the typed code', async () => {
    joinHouseholdMock.mockResolvedValueOnce(undefined);
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.changeText(screen.getByTestId('join-code-input'), 'xyz 234');
    await act(async () => {
      fireEvent.press(screen.getByText('Join'));
    });

    expect(joinHouseholdMock).toHaveBeenCalledWith('xyz 234');
  });

  it('asks for confirmation before leaving', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByText('Leave household'));

    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('signs out', async () => {
    signOutMock.mockResolvedValueOnce(undefined);
    render(<AccountSection />);
    await act(async () => {});

    await act(async () => {
      fireEvent.press(screen.getByText('Sign out'));
    });

    expect(signOutMock).toHaveBeenCalled();
  });

  it('shows the sync status line and triggers a manual sync', async () => {
    (useSyncStatus as jest.Mock).mockReturnValue({
      state: 'idle',
      lastSyncedAt: null,
      pendingConflicts: 0,
    });
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.getByText('Not synced yet')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByText('Sync now'));
    });
    expect(syncNow).toHaveBeenCalled();
  });

  it('shows the error state', async () => {
    (useSyncStatus as jest.Mock).mockReturnValue({
      state: 'error',
      lastSyncedAt: 1753350000000,
      pendingConflicts: 0,
    });
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.getByText('Sync failed — will retry')).toBeOnTheScreen();
  });
});
