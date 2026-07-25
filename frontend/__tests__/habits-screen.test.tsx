import { render, screen } from '@testing-library/react-native';
import React from 'react';

import HabitsScreen from '../app/habits';
import { computeHabits, getHabitsData } from '../lib/suggestions/habits';

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/suggestions/habits', () => ({
  getHabitsData: jest.fn(() => ({ recipes: [], planEntries: [], purchases: [] })),
  computeHabits: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const computeHabitsMock = computeHabits as jest.Mock;
const getHabitsDataMock = getHabitsData as jest.Mock;

describe('HabitsScreen', () => {
  it('shows totals and both top lists', () => {
    computeHabitsMock.mockReturnValue({
      totals: { recipeCount: 12, plannedCount: 87, purchasedCount: 240 },
      topRecipes: [{ title: 'Fredagstaco', count: 14 }],
      topItems: [{ name: 'Melk', count: 31 }],
    });

    render(<HabitsScreen />);

    expect(getHabitsDataMock).toHaveBeenCalled();
    expect(screen.getByText('12')).toBeOnTheScreen();
    expect(screen.getByText('87')).toBeOnTheScreen();
    expect(screen.getByText('240')).toBeOnTheScreen();
    expect(screen.getByText('Most cooked')).toBeOnTheScreen();
    expect(screen.getByText('Fredagstaco')).toBeOnTheScreen();
    expect(screen.getByText('× 14')).toBeOnTheScreen();
    expect(screen.getByText('Most bought')).toBeOnTheScreen();
    expect(screen.getByText('Melk')).toBeOnTheScreen();
    expect(screen.getByText('× 31')).toBeOnTheScreen();
  });

  it('hides empty top lists but always shows totals', () => {
    computeHabitsMock.mockReturnValue({
      totals: { recipeCount: 0, plannedCount: 0, purchasedCount: 0 },
      topRecipes: [],
      topItems: [],
    });

    render(<HabitsScreen />);

    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(screen.queryByText('Most cooked')).toBeNull();
    expect(screen.queryByText('Most bought')).toBeNull();
  });
});
