import { render, screen } from '@testing-library/react-native';
import { Redirect } from 'expo-router';
import React from 'react';

import RecipeDetailScreen from '../app/recipe/[id]/index';
import type { RecipeRow } from '../lib/db/schema';

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

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  Redirect: jest.fn(() => null),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

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

function mockQueries(recipeResult: { data: unknown[]; updatedAt: Date | undefined }) {
  mockUseLiveQuery
    .mockReturnValueOnce(recipeResult) // recipe select
    .mockReturnValueOnce({ data: [], updatedAt: recipeResult.updatedAt }) // ingredients
    .mockReturnValueOnce({ data: [], updatedAt: recipeResult.updatedAt }); // instructions
}

describe('RecipeDetailScreen', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockReset();
    RedirectMock.mockClear();
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
});
