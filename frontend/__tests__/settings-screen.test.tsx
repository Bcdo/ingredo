import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

import SettingsScreen from '../app/settings';
import { applyColorMode } from '../lib/colorMode';
import { getColorMode, getLanguageMode, setColorMode, setLanguageMode } from '../lib/db/settings';
import { applyLanguageMode } from '../lib/locale';

jest.mock('../lib/db/client', () => ({ db: {} }));

jest.mock('../lib/api/config', () => ({
  getApiUrlOverride: jest.fn(() => null),
  setApiUrlOverride: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../lib/colorMode', () => ({
  applyColorMode: jest.fn(),
}));

jest.mock('../lib/locale', () => ({
  applyLanguageMode: jest.fn(),
}));

jest.mock('../lib/db/settings', () => ({
  getColorMode: jest.fn(() => 'system'),
  setColorMode: jest.fn(),
  getLanguageMode: jest.fn(() => 'system'),
  setLanguageMode: jest.fn(),
}));

const getColorModeMock = getColorMode as jest.Mock;
const setColorModeMock = setColorMode as jest.Mock;
const applyColorModeMock = applyColorMode as jest.Mock;
const getLanguageModeMock = getLanguageMode as jest.Mock;
const setLanguageModeMock = setLanguageMode as jest.Mock;
const applyLanguageModeMock = applyLanguageMode as jest.Mock;
const backMock = router.back as jest.Mock;

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getColorModeMock.mockReturnValue('system');
    getLanguageModeMock.mockReturnValue('system');
  });

  it('renders the three modes with the stored one selected', () => {
    getColorModeMock.mockReturnValue('dark');
    render(<SettingsScreen />);

    expect(screen.getByText('Appearance')).toBeOnTheScreen();
    expect(screen.getByLabelText('Dark').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(
      within(screen.getByTestId('appearance-section')).getByLabelText('System').props
        .accessibilityState
    ).toEqual(expect.objectContaining({ selected: false }));
  });

  it('stores and applies a newly selected mode', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Light'));

    expect(setColorModeMock).toHaveBeenCalledWith(expect.anything(), 'light');
    expect(applyColorModeMock).toHaveBeenCalledWith('light');
    expect(screen.getByLabelText('Light').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
  });

  it('closes via the header button', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByLabelText('Close settings'));

    expect(backMock).toHaveBeenCalled();
  });

  it('renders the language options with the stored one selected', () => {
    getLanguageModeMock.mockReturnValue('nb');
    render(<SettingsScreen />);

    expect(screen.getByText('Language')).toBeOnTheScreen();
    expect(screen.getByLabelText('Norsk').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(screen.getByLabelText('English').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(
      within(screen.getByTestId('language-section')).getByLabelText('System').props
        .accessibilityState
    ).toEqual(expect.objectContaining({ selected: false }));
  });

  it('stores and applies a newly selected language', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Norsk'));

    expect(setLanguageModeMock).toHaveBeenCalledWith(expect.anything(), 'nb');
    expect(applyLanguageModeMock).toHaveBeenCalledWith('nb');
  });

  it('navigates to the habits screen', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Habits'));

    expect(router.push).toHaveBeenCalledWith('/habits');
  });
});
