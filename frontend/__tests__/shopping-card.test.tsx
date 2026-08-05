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

const item = (id: string, name: string) => ({ id, name });

describe('ShoppingCard', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('shows count, three-item preview with ellipsis, and navigates to shop', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [
        item('s1', 'Milk'),
        item('s2', 'Bread'),
        item('s3', 'Tomatoes'),
        item('s4', 'Cheese'),
        item('s5', 'Butter'),
      ],
      updatedAt: new Date(),
    }));

    render(<ShoppingCard />);

    expect(screen.getByText('Shopping list')).toBeTruthy();
    expect(screen.getByText('5 items to buy')).toBeTruthy();
    expect(screen.getByText('Milk, Bread, Tomatoes…')).toBeTruthy();

    fireEvent.press(screen.getByText('Shopping list'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/shop');
  });

  it('uses the singular form and no ellipsis for a short list', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [item('s1', 'Milk')],
      updatedAt: new Date(),
    }));

    render(<ShoppingCard />);

    expect(screen.getByText('1 item to buy')).toBeTruthy();
    expect(screen.getByText('Milk')).toBeTruthy();
  });

  it('renders nothing when the list has no active items', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));

    const { toJSON } = render(<ShoppingCard />);
    expect(toJSON()).toBeNull();
  });
});
