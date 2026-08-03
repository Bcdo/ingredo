import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { AccountSection } from '../components/settings/AccountSection';
import {
  createHousehold,
  getHousehold,
  joinHousehold,
  leaveHousehold,
  listHouseholds,
  renameHousehold,
  signOut,
  switchHousehold,
} from '../lib/api/auth';
import { ApiError } from '../lib/api/client';
import { useSession } from '../lib/api/session';
import { syncNow } from '../lib/sync/engine';
import { useSyncStatus } from '../lib/sync/status';

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/api/auth', () => ({
  getHousehold: jest.fn(),
  joinHousehold: jest.fn(),
  leaveHousehold: jest.fn(),
  listHouseholds: jest.fn(),
  createHousehold: jest.fn(),
  switchHousehold: jest.fn(),
  renameHousehold: jest.fn(),
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
const leaveHouseholdMock = leaveHousehold as jest.Mock;
const listHouseholdsMock = listHouseholds as jest.Mock;
const createHouseholdMock = createHousehold as jest.Mock;
const switchHouseholdMock = switchHousehold as jest.Mock;
const renameHouseholdMock = renameHousehold as jest.Mock;
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
const summaries = [
  {
    id: 'household-1',
    name: 'Karis husstand',
    joinCode: 'ABC-DEF',
    memberCount: 2,
    role: 'owner',
    isActive: true,
  },
  {
    id: 'household-2',
    name: 'Hytta',
    joinCode: 'GHI-JKL',
    memberCount: 1,
    role: 'member',
    isActive: false,
  },
];

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
    listHouseholdsMock.mockResolvedValue(summaries);
  });

  it('shows email, and the expanded active row with code and members', async () => {
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.getByText('kari@example.test')).toBeOnTheScreen();
    expect(screen.getAllByText('Karis husstand').length).toBeGreaterThan(0);
    expect(screen.getByText('Code: ABC-DEF')).toBeOnTheScreen();
    expect(screen.getByText('Kari')).toBeOnTheScreen();
    expect(screen.getAllByText('Active')).toHaveLength(1);
  });

  it('does not repeat the active household as a separate block', async () => {
    render(<AccountSection />);
    await act(async () => {});

    // One list: the active name renders exactly once.
    expect(screen.getAllByText('Karis husstand')).toHaveLength(1);
  });

  it('switches on pressing a non-active household', async () => {
    switchHouseholdMock.mockResolvedValueOnce(undefined);
    render(<AccountSection />);
    await act(async () => {});

    await act(async () => {
      fireEvent.press(screen.getByTestId('household-row-household-2'));
    });

    expect(switchHouseholdMock).toHaveBeenCalledWith('household-2');
  });

  it('renames the active household inline', async () => {
    renameHouseholdMock.mockResolvedValueOnce({ ...household, name: 'Hjem' });
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByLabelText('Rename'));
    const input = screen.getByTestId('rename-input');
    expect(input.props.value).toBe('Karis husstand');
    fireEvent.changeText(input, '  Hjem  ');
    await act(async () => {
      fireEvent.press(screen.getByText('Save'));
    });

    expect(renameHouseholdMock).toHaveBeenCalledWith('Hjem');
    expect(screen.getByText('Hjem')).toBeOnTheScreen();
    expect(screen.queryByTestId('rename-input')).toBeNull();
  });

  it('an empty rename shows the validation message without calling the API', async () => {
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByLabelText('Rename'));
    fireEvent.changeText(screen.getByTestId('rename-input'), '   ');
    await act(async () => {
      fireEvent.press(screen.getByText('Save'));
    });

    expect(renameHouseholdMock).not.toHaveBeenCalled();
    expect(screen.getByText('Give the household a name.')).toBeOnTheScreen();
  });

  it('create is collapsed until revealed, then creates and collapses again', async () => {
    createHouseholdMock.mockResolvedValueOnce(undefined);
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.queryByTestId('create-household-input')).toBeNull();
    fireEvent.press(screen.getByText('+ New household'));
    fireEvent.changeText(screen.getByTestId('create-household-input'), '  Hytta  ');
    await act(async () => {
      fireEvent.press(screen.getByText('Create'));
    });

    expect(createHouseholdMock).toHaveBeenCalledWith('Hytta');
    expect(screen.queryByTestId('create-household-input')).toBeNull();
  });

  it('a blank create shows the validation message without calling the API', async () => {
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByText('+ New household'));
    await act(async () => {
      fireEvent.press(screen.getByText('Create'));
    });

    expect(createHouseholdMock).not.toHaveBeenCalled();
    expect(screen.getByText('Give the household a name.')).toBeOnTheScreen();
  });

  it('join is collapsed until revealed, then joins with the typed code', async () => {
    joinHouseholdMock.mockResolvedValueOnce(undefined);
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.queryByTestId('join-code-input')).toBeNull();
    fireEvent.press(screen.getByText('Join with code'));
    fireEvent.changeText(screen.getByTestId('join-code-input'), 'xyz 234');
    await act(async () => {
      fireEvent.press(screen.getByText('Join'));
    });

    expect(joinHouseholdMock).toHaveBeenCalledWith('xyz 234');
    expect(screen.queryByTestId('join-code-input')).toBeNull();
  });

  it('asks for confirmation before leaving', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByText('Leave household'));

    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('a leave conflict shows the leave-specific message', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    leaveHouseholdMock.mockRejectedValueOnce(new ApiError(409, null));
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByText('Leave household'));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];

    await act(async () => {
      buttons[1].onPress?.();
    });

    expect(screen.getByText("You can't leave your only household.")).toBeOnTheScreen();
    alertSpy.mockRestore();
  });

  it('signs out from the header link', async () => {
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

  it('the rename input auto-focuses', async () => {
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByLabelText('Rename'));
    expect(screen.getByTestId('rename-input').props.autoFocus).toBe(true);
  });

  it('a household switch closes an in-progress rename', async () => {
    render(<AccountSection />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText('Rename'));
    expect(screen.getByTestId('rename-input')).toBeOnTheScreen();

    useSessionMock.mockReturnValue({ ...signedIn, householdId: 'household-2' });
    getHouseholdMock.mockResolvedValue({
      id: 'household-2',
      name: 'Hytta',
      joinCode: 'GHI-JKL',
      members: [],
    });
    listHouseholdsMock.mockResolvedValue([
      { ...summaries[0], isActive: false },
      { ...summaries[1], isActive: true },
    ]);
    screen.rerender(<AccountSection />);
    await act(async () => {});

    expect(screen.queryByTestId('rename-input')).toBeNull();
    expect(renameHouseholdMock).not.toHaveBeenCalled();
  });

  it('create and join stay revealed when the API fails', async () => {
    createHouseholdMock.mockRejectedValueOnce(new ApiError(400, null));
    joinHouseholdMock.mockRejectedValueOnce(new ApiError(404, null));
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByText('+ New household'));
    fireEvent.changeText(screen.getByTestId('create-household-input'), 'Hytta');
    await act(async () => {
      fireEvent.press(screen.getByText('Create'));
    });
    expect(screen.getByTestId('create-household-input')).toBeOnTheScreen();
    expect(screen.getByText('Give the household a name.')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Join with code'));
    fireEvent.changeText(screen.getByTestId('join-code-input'), 'ABC-DEF');
    await act(async () => {
      fireEvent.press(screen.getByText('Join'));
    });
    expect(screen.getByTestId('join-code-input')).toBeOnTheScreen();
    expect(screen.getByText('No household with that code.')).toBeOnTheScreen();
  });

  it('a household switch closes in-progress create and join', async () => {
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByText('+ New household'));
    fireEvent.changeText(screen.getByTestId('create-household-input'), 'Hytta');
    fireEvent.press(screen.getByText('Join with code'));
    fireEvent.changeText(screen.getByTestId('join-code-input'), 'ABC');
    expect(screen.getByTestId('create-household-input')).toBeOnTheScreen();
    expect(screen.getByTestId('join-code-input')).toBeOnTheScreen();

    useSessionMock.mockReturnValue({ ...signedIn, householdId: 'household-2' });
    getHouseholdMock.mockResolvedValue({
      id: 'household-2',
      name: 'Hytta',
      joinCode: 'GHI-JKL',
      members: [],
    });
    listHouseholdsMock.mockResolvedValue([
      { ...summaries[0], isActive: false },
      { ...summaries[1], isActive: true },
    ]);
    screen.rerender(<AccountSection />);
    await act(async () => {});

    expect(screen.queryByTestId('create-household-input')).toBeNull();
    expect(screen.queryByTestId('join-code-input')).toBeNull();
  });
});
