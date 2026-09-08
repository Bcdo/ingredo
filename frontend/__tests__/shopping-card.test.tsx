import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import { ShoppingCard } from '../components/today/ShoppingCard';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

jest.mock('../lib/household', () => ({
  useActiveHouseholdId: () => 'household-1',
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;

// Rows as the card's query returns them: sources is the stored JSON string of
// recipe titles the item was added from.
const item = (id: string, name: string, sources: string[] = []) => ({
  id,
  name,
  sources: JSON.stringify(sources),
});

describe('ShoppingCard', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('shows only items sourced from the planned dinners and navigates to shop', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [
        item('s1', 'Milk', ['Pancakes']),
        item('s2', 'Bread'),
        item('s3', 'Tomatoes', ['Taco']),
        item('s4', 'Cheese', ['Taco', 'Pancakes']),
        item('s5', 'Butter', ['Soup']),
      ],
      updatedAt: new Date(),
    }));

    render(<ShoppingCard dinnerTitles={['Taco', 'Pancakes']} />);

    expect(screen.getByText('Missing for dinner')).toBeTruthy();
    expect(screen.getByText('3 items to buy')).toBeTruthy();
    expect(screen.getByText('Milk, Tomatoes, Cheese')).toBeTruthy();
    expect(screen.queryByText(/Bread/)).toBeNull();
    expect(screen.queryByText(/Butter/)).toBeNull();

    fireEvent.press(screen.getByText('3 items to buy'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/shop');
  });

  it('uses the singular form for one item and an ellipsis beyond three', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [item('s1', 'Milk', ['Taco'])],
      updatedAt: new Date(),
    }));
    const { rerender } = render(<ShoppingCard dinnerTitles={['Taco']} />);
    expect(screen.getByText('1 item to buy')).toBeTruthy();
    expect(screen.getByText('Milk')).toBeTruthy();

    mockUseLiveQuery.mockImplementation(() => ({
      data: [
        item('s1', 'Milk', ['Taco']),
        item('s2', 'Bread', ['Taco']),
        item('s3', 'Tomatoes', ['Taco']),
        item('s4', 'Cheese', ['Taco']),
      ],
      updatedAt: new Date(),
    }));
    rerender(<ShoppingCard dinnerTitles={['Taco']} />);
    expect(screen.getByText('4 items to buy')).toBeTruthy();
    expect(screen.getByText('Milk, Bread, Tomatoes…')).toBeTruthy();
  });

  it('renders nothing when no active item traces back to a planned dinner', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [item('s1', 'Milk', ['Soup']), item('s2', 'Bread')],
      updatedAt: new Date(),
    }));

    const { toJSON } = render(<ShoppingCard dinnerTitles={['Taco']} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when no dinner is planned, even with items on the list', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [item('s1', 'Milk', ['Taco'])],
      updatedAt: new Date(),
    }));

    const { toJSON } = render(<ShoppingCard dinnerTitles={[]} />);
    expect(toJSON()).toBeNull();
  });
});
