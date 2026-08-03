import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import RegisterScreen from '../app/account/register';
import SignInScreen from '../app/account/sign-in';
import { register, signIn } from '../lib/api/auth';
import { ApiError } from '../lib/api/client';
import { useSession } from '../lib/api/session';

jest.mock('../lib/api/auth', () => ({
  signIn: jest.fn(),
  register: jest.fn(),
}));

jest.mock('../lib/api/session', () => ({
  useSession: jest.fn(),
}));

// lib/api/client.ts (imported for the real ApiError/NetworkError classes)
// pulls in lib/db/client.ts, which imports the native expo-sqlite module —
// unmockable/unparseable under jest-expo without this stub. Mirrors the
// pattern already used by __tests__/api-client.test.ts.
jest.mock('../lib/db/client', () => ({ db: {} }));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const signInMock = signIn as jest.Mock;
const registerMock = register as jest.Mock;
const useSessionMock = useSession as jest.Mock;

const signedOut = { status: 'signedOut', user: null, householdId: null, householdName: null };

beforeEach(() => {
  jest.clearAllMocks();
  useSessionMock.mockReturnValue(signedOut);
});

describe('SignInScreen', () => {
  it('submits credentials', async () => {
    signInMock.mockResolvedValueOnce(undefined);
    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'passord123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    });

    expect(signInMock).toHaveBeenCalledWith('kari@example.test', 'passord123');
  });

  it('shows wrong-credentials error on 401', async () => {
    signInMock.mockRejectedValueOnce(new ApiError(401, null));
    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'feil');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    });

    expect(screen.getByText('Wrong email or password.')).toBeOnTheScreen();
  });

  it('backs out once signed in', () => {
    useSessionMock.mockReturnValue({ ...signedOut, status: 'signedIn' });
    render(<SignInScreen />);
    expect(mockBack).toHaveBeenCalled();
  });

  it('links to registration', () => {
    render(<SignInScreen />);
    fireEvent.press(screen.getByText('New here? Create an account'));
    expect(mockPush).toHaveBeenCalledWith('/account/register');
  });

  it('the eye reveals the password', () => {
    render(<SignInScreen />);
    expect(screen.getByTestId('sign-in-password').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByTestId('sign-in-password').props.secureTextEntry).toBe(false);
  });
});

describe('RegisterScreen', () => {
  it('submits the three fields', async () => {
    registerMock.mockResolvedValueOnce(undefined);
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-invite'), 'ABC-DEF');
    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'passord123');
    fireEvent.changeText(screen.getByTestId('register-confirm'), 'passord123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    });

    expect(registerMock).toHaveBeenCalledWith(
      'kari@example.test',
      'passord123',
      'Kari',
      'Home',
      'ABC-DEF'
    );
  });

  it('shows email-taken error on 409', async () => {
    registerMock.mockRejectedValueOnce(new ApiError(409, null));
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-invite'), 'ABC-DEF');
    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'passord123');
    fireEvent.changeText(screen.getByTestId('register-confirm'), 'passord123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    });

    expect(screen.getByText('That email is already registered.')).toBeOnTheScreen();
  });

  it('shows validation hint on 400', async () => {
    registerMock.mockRejectedValueOnce(new ApiError(400, null));
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-invite'), 'ABC-DEF');
    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'kort');
    fireEvent.changeText(screen.getByTestId('register-confirm'), 'kort');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    });

    expect(
      screen.getByText('Check the fields — the password needs at least 8 characters.')
    ).toBeOnTheScreen();
  });

  it('blocks mismatched passwords without calling the API', async () => {
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-invite'), 'ABC-DEF');
    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'passord123');
    fireEvent.changeText(screen.getByTestId('register-confirm'), 'passord124');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    });

    expect(registerMock).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords don't match.")).toBeOnTheScreen();
  });

  it('maps a rejected invite code to its own error', async () => {
    registerMock.mockRejectedValueOnce(new ApiError(403, null));
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-invite'), 'ZZZ-ZZZ');
    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'passord123');
    fireEvent.changeText(screen.getByTestId('register-confirm'), 'passord123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    });

    expect(screen.getByText("That invite code isn't valid.")).toBeOnTheScreen();
  });

  it('the eye reveals the password', () => {
    render(<RegisterScreen />);
    expect(screen.getByTestId('register-password').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getAllByLabelText('Show password')[0]);
    expect(screen.getByTestId('register-password').props.secureTextEntry).toBe(false);
    expect(screen.getByTestId('register-confirm').props.secureTextEntry).toBe(true);
  });
});
