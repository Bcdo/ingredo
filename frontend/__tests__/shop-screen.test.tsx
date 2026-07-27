import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import ShopScreen from '../app/(tabs)/shop';
import {
  addManualItem,
  purchaseItem,
  readdItem,
  restoreItem,
  setItemQuantity,
} from '../lib/db/shoppingList';

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
  readdItem: jest.fn(),
  restoreItem: jest.fn(),
  setItemQuantity: jest.fn(),
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
const readdItemMock = readdItem as jest.Mock;
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

const NOW = Date.now();

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
  purchasedAt: NOW - 1000,
  createdAt: 1,
  updatedAt: 2,
};
const coffee = {
  id: 's3',
  name: 'Kaffe',
  normalizedName: 'kaffe',
  quantity: null,
  unit: null,
  sources: '[]',
  status: 'purchased',
  purchasedAt: NOW - 8 * 24 * 60 * 60 * 1000,
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

  it('purchases on card tap and undoes a this-trip shelf tap via restore', () => {
    activeRows = [flour];
    purchasedRows = [butter];
    render(<ShopScreen />);

    fireEvent.press(screen.getByText('Mel'));
    expect(purchaseItemMock).toHaveBeenCalledWith(expect.anything(), null, 's1');

    expect(screen.getByText('Recently purchased')).toBeOnTheScreen();
    expect(screen.getByText('This trip')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Smør'));
    expect(restoreItemMock).toHaveBeenCalledWith(expect.anything(), null, 's2');
    expect(readdItemMock).not.toHaveBeenCalled();
  });

  it('re-adds an older shelf item as a copy', () => {
    purchasedRows = [coffee];
    render(<ShopScreen />);

    expect(screen.getByText('Earlier')).toBeOnTheScreen();
    expect(screen.queryByText('This trip')).toBeNull();
    fireEvent.press(screen.getByText('Kaffe'));
    expect(readdItemMock).toHaveBeenCalledWith(expect.anything(), null, 's3');
    expect(restoreItemMock).not.toHaveBeenCalled();
  });

  it('hides shelf items that already have an active twin', () => {
    activeRows = [flour];
    purchasedRows = [
      {
        ...butter,
        id: 's4',
        name: 'Mel',
        normalizedName: 'mel',
        quantity: 500,
        unit: 'g',
        sources: '[]',
      },
    ];
    render(<ShopScreen />);

    expect(screen.queryByText('Recently purchased')).toBeNull();
    expect(screen.getAllByText('Mel')).toHaveLength(1); // only the active card
  });

  it('quick-add submits the draft and clears the input', () => {
    render(<ShopScreen />);
    const input = screen.getByPlaceholderText('Add (e.g. 2 l milk)');

    fireEvent.changeText(input, 'Kaffe');
    fireEvent(input, 'submitEditing');

    expect(addManualItemMock).toHaveBeenCalledWith(expect.anything(), null, 'Kaffe');
    expect(input.props.value).toBe('');
  });

  it('keeps a rejected draft (blank input) in place', () => {
    addManualItemMock.mockReturnValueOnce(false);
    render(<ShopScreen />);
    const input = screen.getByPlaceholderText('Add (e.g. 2 l milk)');

    fireEvent.changeText(input, '   ');
    fireEvent(input, 'submitEditing');

    expect(input.props.value).toBe('   ');
  });

  it('long-press opens the quantity editor for an active item', () => {
    activeRows = [flour];
    purchasedRows = [];
    mockQueries();
    render(<ShopScreen />);

    fireEvent(screen.getByText('Mel'), 'longPress');

    expect(screen.getByTestId('quantity-input')).toBeOnTheScreen();
  });

  it('saving the editor writes through setItemQuantity', () => {
    activeRows = [flour];
    purchasedRows = [];
    mockQueries();
    render(<ShopScreen />);
    fireEvent(screen.getByText('Mel'), 'longPress');

    fireEvent.changeText(screen.getByTestId('quantity-input'), '2');
    fireEvent.press(screen.getByText('Save'));

    expect(setItemQuantity).toHaveBeenCalledWith(expect.anything(), null, flour.id, 2, flour.unit);
  });

  it('long-press on a shelf row does not open the editor', () => {
    activeRows = [];
    purchasedRows = [butter];
    mockQueries();
    render(<ShopScreen />);

    fireEvent(screen.getByText('Smør'), 'longPress');

    expect(screen.queryByTestId('quantity-input')).toBeNull();
  });
});
