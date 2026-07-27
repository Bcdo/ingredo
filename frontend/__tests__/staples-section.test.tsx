import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { StaplesSection } from '../components/shop/StaplesSection';
import { addItems } from '../lib/db/shoppingList';
import { dismissStaple, getStapleDismissals } from '../lib/suggestions/dismissals';

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/db/shoppingList', () => ({
  addItems: jest.fn(),
}));
jest.mock('../lib/suggestions/dismissals', () => ({
  getStapleDismissals: jest.fn(() => ({})),
  dismissStaple: jest.fn(),
}));

const addItemsMock = addItems as jest.Mock;
const getDismissalsMock = getStapleDismissals as jest.Mock;
const dismissStapleMock = dismissStaple as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_753_000_000_000;

// A weekly milk habit, due (last bought 6 days ago).
const duePurchases = [20, 13, 6].map((days) => ({
  normalizedName: 'melk',
  name: 'Melk',
  purchasedAt: NOW - days * DAY,
}));

beforeEach(() => {
  jest.clearAllMocks();
  getDismissalsMock.mockReturnValue({});
});

describe('StaplesSection', () => {
  it('renders nothing without due staples', () => {
    const { toJSON } = render(<StaplesSection active={[]} purchased={[]} now={NOW} />);
    expect(toJSON()).toBeNull();
    expect(getDismissalsMock).not.toHaveBeenCalled();
  });

  it('shows a due staple and adds it through addItems', () => {
    render(<StaplesSection active={[]} purchased={duePurchases} now={NOW} />);

    expect(screen.getByText('Do you need…?')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Add Melk'));

    expect(addItemsMock).toHaveBeenCalledWith(
      expect.anything(),
      null,
      [{ name: 'Melk', normalizedName: 'melk', quantity: null, unit: null, sources: [] }],
      'merge'
    );
  });

  it('excludes staples already on the active list', () => {
    const { toJSON } = render(
      <StaplesSection active={[{ normalizedName: 'melk' }]} purchased={duePurchases} now={NOW} />
    );
    expect(toJSON()).toBeNull();
  });

  it('hides dismissed staples until repurchased', () => {
    // Dismissed AFTER the last purchase → suppressed.
    getDismissalsMock.mockReturnValue({ melk: NOW - 5 * DAY });
    const { toJSON } = render(<StaplesSection active={[]} purchased={duePurchases} now={NOW} />);
    expect(toJSON()).toBeNull();
  });

  it('shows again once purchased after the dismissal', () => {
    // Dismissed BEFORE the last purchase (6 days ago) → habit re-opened.
    getDismissalsMock.mockReturnValue({ melk: NOW - 10 * DAY });
    render(<StaplesSection active={[]} purchased={duePurchases} now={NOW} />);
    expect(screen.getByText('Melk')).toBeOnTheScreen();
  });

  it('dismisses with the latest-purchase map and hides the chip', () => {
    render(<StaplesSection active={[]} purchased={duePurchases} now={NOW} />);

    getDismissalsMock.mockReturnValue({ melk: NOW });
    fireEvent.press(screen.getByLabelText('Dismiss Melk'));

    expect(dismissStapleMock).toHaveBeenCalledWith(
      expect.anything(),
      'melk',
      expect.objectContaining({ melk: NOW - 6 * DAY })
    );
    expect(screen.queryByText('Melk')).toBeNull();
  });
});
