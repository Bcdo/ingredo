import { Appearance } from 'react-native';

import { applyColorMode } from '../lib/colorMode';

describe('applyColorMode', () => {
  it('forces light and dark, and clears the override for system', () => {
    const spy = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});

    applyColorMode('light');
    expect(spy).toHaveBeenLastCalledWith('light');
    applyColorMode('dark');
    expect(spy).toHaveBeenLastCalledWith('dark');
    applyColorMode('system');
    expect(spy).toHaveBeenLastCalledWith('unspecified');

    spy.mockRestore();
  });
});
