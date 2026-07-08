import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect } from 'expo-router';
import React from 'react';

import RecipeDetailScreen from '../app/recipe/[id]/index';
import { getUnitSystem, setUnitSystem } from '../lib/db/settings';
import type { RecipeRow } from '../lib/db/schema';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => ({ id: 'r1' }),
  Redirect: jest.fn(() => null),
}));

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

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

jest.mock('../lib/db/settings', () => ({
  getUnitSystem: jest.fn(() => 'metric'),
  setUnitSystem: jest.fn(),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const RedirectMock = Redirect as unknown as jest.Mock;

const recipeRow: RecipeRow = {
  id: 'r1',
  title: 'Tomato Soup',
  description: null,
  servings: 4,
  notes: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const flourRow = {
  id: 'i1',
  recipeId: 'r1',
  name: 'Flour',
  quantity: 200,
  unit: 'g',
  scaling: 'linear',
  sortOrder: 0,
};
const chiliRow = {
  id: 'i2',
  recipeId: 'r1',
  name: 'Chili flakes',
  quantity: 1,
  unit: 'ts',
  scaling: 'fixed',
  sortOrder: 1,
};

function mockQueries(
  recipeResult: { data: unknown[]; updatedAt: Date | undefined },
  ingredients: unknown[] = []
) {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 3;
    call += 1;
    if (index === 0) return recipeResult;
    if (index === 1) return { data: ingredients, updatedAt: recipeResult.updatedAt };
    return { data: [], updatedAt: recipeResult.updatedAt };
  });
}

describe('RecipeDetailScreen', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockReset();
    RedirectMock.mockClear();
    mockPush.mockClear();
    (getUnitSystem as jest.Mock).mockClear().mockReturnValue('metric');
    (setUnitSystem as jest.Mock).mockClear();
  });

  it('does not redirect while the live query has not resolved yet', () => {
    mockQueries({ data: [], updatedAt: undefined });

    render(<RecipeDetailScreen />);

    expect(RedirectMock).not.toHaveBeenCalled();
  });

  it('redirects to the recipes tab once the query resolves with no matching recipe', () => {
    mockQueries({ data: [], updatedAt: new Date() });

    render(<RecipeDetailScreen />);

    expect(RedirectMock).toHaveBeenCalled();
    expect(RedirectMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ href: '/(tabs)/recipes' })
    );
  });

  it('renders the recipe title once the query resolves with a matching recipe', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() });

    render(<RecipeDetailScreen />);

    expect(screen.getByText(recipeRow.title)).toBeTruthy();
    expect(RedirectMock).not.toHaveBeenCalled();
  });

  it('rescales linear ingredients when servings are stepped up', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow]);
    render(<RecipeDetailScreen />);

    expect(screen.getByText('200 g')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('increment')); // 4 → 5 servings
    expect(screen.getByText('250 g')).toBeTruthy();
  });

  it('keeps fixed ingredients constant and shows the adjust-to-taste hint when scaled', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    expect(screen.queryByText(/adjust to taste/)).toBeNull();
    fireEvent.press(screen.getByLabelText('increment'));
    expect(screen.getByText('1 tsp')).toBeTruthy(); // unscaled, en label for ts
    expect(screen.getByText(/adjust to taste/)).toBeTruthy();
  });

  it('converts quantities and persists the preference when toggled to US', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByLabelText('US'));
    expect(setUnitSystem).toHaveBeenCalledWith(expect.anything(), 'us');
    expect(screen.getByText('7 oz')).toBeTruthy(); // 200 g = 7.05 oz → 7
  });

  it('reads the persisted unit system on mount', () => {
    (getUnitSystem as jest.Mock).mockReturnValueOnce('us');
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow]);
    render(<RecipeDetailScreen />);

    expect(screen.getByText('7 oz')).toBeTruthy();
  });

  it('routes Plan it to the day picker', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() });
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByText('Plan it'));
    expect(mockPush).toHaveBeenCalledWith('/plan/pick-day?recipe=r1');
  });
});
