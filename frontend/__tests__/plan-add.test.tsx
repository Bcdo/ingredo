import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect } from 'expo-router';
import React from 'react';

import AddPlanEntryScreen from '../app/plan/add';
import { addPlanEntry } from '../lib/db/mealPlan';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../lib/db/mealPlan', () => ({
  addPlanEntry: jest.fn(() => 'new-entry'),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

const mockParams: Record<string, string | undefined> = { date: '2026-07-07' };
const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
  Redirect: jest.fn(() => null),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const RedirectMock = Redirect as unknown as jest.Mock;

const soup = { id: 'r1', title: 'Tomato Soup', servings: 4 };
const stew = { id: 'r2', title: 'Beef Stew', servings: 2 };

function mockQueries(recipeRows: unknown[], ingredientRows: unknown[] = []) {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 2;
    call += 1;
    if (index === 0) return { data: recipeRows, updatedAt: new Date() };
    return { data: ingredientRows, updatedAt: new Date() };
  });
}

describe('AddPlanEntryScreen', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockPush.mockClear();
    RedirectMock.mockClear();
    (addPlanEntry as jest.Mock).mockClear();
    mockUseLiveQuery.mockReset();
    mockParams.date = '2026-07-07';
  });

  it('redirects when the date param is missing or malformed', () => {
    mockParams.date = 'not-a-date';
    mockQueries([soup]);

    render(<AddPlanEntryScreen />);

    expect(RedirectMock).toHaveBeenCalled();
  });

  it('filters recipes by search query', () => {
    mockQueries([soup, stew]);

    render(<AddPlanEntryScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Search recipes or ingredients'), 'stew');

    expect(screen.getByText('Beef Stew')).toBeTruthy();
    expect(screen.queryByText('Tomato Soup')).toBeNull();
  });

  it('selects a recipe, presets servings, and adds the entry', () => {
    mockQueries([soup, stew]);

    render(<AddPlanEntryScreen />);
    fireEvent.press(screen.getByText('Beef Stew'));
    fireEvent.press(screen.getByLabelText('increment')); // 2 → 3
    fireEvent.press(screen.getByText('Add to plan'));

    expect(addPlanEntry).toHaveBeenCalledWith(expect.anything(), {
      date: '2026-07-07',
      recipeId: 'r2',
      servings: 3,
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('renders empty state when no recipes exist', () => {
    mockQueries([]);

    render(<AddPlanEntryScreen />);

    expect(screen.getByText('No recipes yet')).toBeTruthy();
    fireEvent.press(screen.getByText('Create your first recipe'));

    expect(mockPush).toHaveBeenCalledWith('/recipe/new');
  });

  it('filters recipes by ingredient name', () => {
    const ingredients = [
      { recipeId: 'r1', name: 'halloumi' },
      { recipeId: 'r2', name: 'beef' },
    ];
    mockQueries([soup, stew], ingredients);

    render(<AddPlanEntryScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Search recipes or ingredients'), 'halloumi');

    expect(screen.getByText('Tomato Soup')).toBeTruthy();
    expect(screen.queryByText('Beef Stew')).toBeNull();
  });
});
