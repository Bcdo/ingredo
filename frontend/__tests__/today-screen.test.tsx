import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import TodayScreen from '../app/(tabs)/index';
import { addDays, todayLocal } from '../lib/dates';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.innerJoin = () => node;
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

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const today = todayLocal();
const tomorrow = addDays(today, 1);

describe('TodayScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('shows the tonight hero, extra entries, and the tomorrow peek', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [
        { id: 'e1', date: today, recipeId: 'r1', servings: 4, title: 'Tomato Soup' },
        { id: 'e2', date: today, recipeId: 'r2', servings: 2, title: 'Salad' },
        { id: 'e3', date: tomorrow, recipeId: 'r3', servings: 4, title: 'Beef Stew' },
      ],
      updatedAt: new Date(),
    }));

    render(<TodayScreen />);

    expect(screen.getByText('Tonight')).toBeTruthy();
    expect(screen.getByText('Tomato Soup')).toBeTruthy();
    expect(screen.getByText('Salad')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
    expect(screen.getByText('Beef Stew')).toBeTruthy();

    fireEvent.press(screen.getByText('Tomato Soup'));
    expect(mockPush).toHaveBeenCalledWith('/recipe/r1');

    mockPush.mockClear();

    fireEvent.press(screen.getByText('Salad'));
    expect(mockPush).toHaveBeenCalledWith('/recipe/r2');

    mockPush.mockClear();

    fireEvent.press(screen.getByText('Beef Stew'));
    expect(mockPush).toHaveBeenCalledWith('/recipe/r3');
  });

  it('shows the empty state with a plan-week action when nothing is planned tonight', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));

    render(<TodayScreen />);

    expect(screen.getByText('Nothing planned tonight.')).toBeTruthy();
    fireEvent.press(screen.getByText('Plan your week'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/plan');
    expect(screen.queryByText('Tomorrow')).toBeNull();
  });

  it('shows empty state for tonight but still displays tomorrow peek with entries', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [{ id: 'e3', date: tomorrow, recipeId: 'r3', servings: 4, title: 'Beef Stew' }],
      updatedAt: new Date(),
    }));

    render(<TodayScreen />);

    expect(screen.getByText('Nothing planned tonight.')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
    expect(screen.getByText('Beef Stew')).toBeTruthy();

    fireEvent.press(screen.getByText('Beef Stew'));
    expect(mockPush).toHaveBeenCalledWith('/recipe/r3');
  });
});
