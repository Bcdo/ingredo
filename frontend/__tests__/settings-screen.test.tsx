import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

import SettingsScreen from '../app/settings';
import { applyColorMode } from '../lib/colorMode';
import { getColorMode, setColorMode } from '../lib/db/settings';

jest.mock('../lib/db/client', () => ({ db: {} }));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
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

jest.mock('../lib/db/settings', () => ({
  getColorMode: jest.fn(() => 'system'),
  setColorMode: jest.fn(),
}));

const getColorModeMock = getColorMode as jest.Mock;
const setColorModeMock = setColorMode as jest.Mock;
const applyColorModeMock = applyColorMode as jest.Mock;
const backMock = router.back as jest.Mock;

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getColorModeMock.mockReturnValue('system');
  });

  it('renders the three modes with the stored one selected', () => {
    getColorModeMock.mockReturnValue('dark');
    render(<SettingsScreen />);

    expect(screen.getByText('Appearance')).toBeOnTheScreen();
    expect(screen.getByLabelText('Dark').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(screen.getByLabelText('System').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
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
});
