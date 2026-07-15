import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import ShopScreen from '../app/(tabs)/shop';
import { addManualItem, purchaseItem, restoreItem } from '../lib/db/shoppingList';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(callback, [callback]);
  },
}));

jest.mock('../lib/db/settings', () => ({
  getUnitSystem: jest.fn(() => 'metric'),
}));

jest.mock('../lib/db/shoppingList', () => ({
  addManualItem: jest.fn(() => true),
  purchaseItem: jest.fn(),
  restoreItem: jest.fn(),
  parseSources: (json: string) => {
    try {
      const value = JSON.parse(json);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  },
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const addManualItemMock = addManualItem as jest.Mock;
const purchaseItemMock = purchaseItem as jest.Mock;
const restoreItemMock = restoreItem as jest.Mock;

let activeRows: unknown[] = [];
let purchasedRows: unknown[] = [];

function mockQueries() {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 2;
    call += 1;
    if (index === 0) return { data: activeRows, updatedAt: new Date() };
    return { data: purchasedRows, updatedAt: new Date() };
  });
}

const flour = {
  id: 's1',
  name: 'Mel',
  normalizedName: 'mel',
  quantity: 1500,
  unit: 'g',
  sources: '["Pannekaker","Vafler"]',
  status: 'active',
  purchasedAt: null,
  createdAt: 1,
  updatedAt: 1,
};
const butter = {
  id: 's2',
  name: 'Smør',
  normalizedName: 'smør',
  quantity: null,
  unit: null,
  sources: '[]',
  status: 'purchased',
  purchasedAt: 2,
  createdAt: 1,
  updatedAt: 2,
};

describe('ShopScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    activeRows = [];
    purchasedRows = [];
    mockQueries();
  });

  it('shows the empty state when there are no items at all', () => {
    render(<ShopScreen />);
    expect(screen.getByText('Nothing to buy yet')).toBeOnTheScreen();
  });

  it('renders active items with merged quantity and recipe sources', () => {
    activeRows = [flour];
    render(<ShopScreen />);

    expect(screen.getByText('Mel')).toBeOnTheScreen();
    expect(screen.getByText('1500 g')).toBeOnTheScreen();
    expect(screen.getByText('Pannekaker · Vafler')).toBeOnTheScreen();
  });

  it('purchases on card tap and restores on shelf tap', () => {
    activeRows = [flour];
    purchasedRows = [butter];
    render(<ShopScreen />);

    fireEvent.press(screen.getByText('Mel'));
    expect(purchaseItemMock).toHaveBeenCalledWith(expect.anything(), 's1');

    expect(screen.getByText('Recently purchased')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Smør'));
    expect(restoreItemMock).toHaveBeenCalledWith(expect.anything(), 's2');
  });

  it('quick-add submits the draft and clears the input', () => {
    render(<ShopScreen />);
    const input = screen.getByPlaceholderText('Add an item…');

    fireEvent.changeText(input, 'Kaffe');
    fireEvent(input, 'submitEditing');

    expect(addManualItemMock).toHaveBeenCalledWith(expect.anything(), 'Kaffe');
    expect(input.props.value).toBe('');
  });

  it('keeps a rejected draft (blank input) in place', () => {
    addManualItemMock.mockReturnValueOnce(false);
    render(<ShopScreen />);
    const input = screen.getByPlaceholderText('Add an item…');

    fireEvent.changeText(input, '   ');
    fireEvent(input, 'submitEditing');

    expect(input.props.value).toBe('   ');
  });
});
