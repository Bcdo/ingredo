import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import RecipesScreen from '../app/(tabs)/recipes';
import { seedSampleData } from '../lib/dev/sampleData';

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

jest.mock('../lib/dev/sampleData', () => ({
  seedSampleData: jest.fn(() => 8),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const seedMock = seedSampleData as jest.Mock;

let recipeRows: unknown[] = [];
let ingredientRows: unknown[] = [];

function mockQueries() {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 2;
    call += 1;
    if (index === 0) return { data: recipeRows, updatedAt: new Date() };
    return { data: ingredientRows, updatedAt: new Date() };
  });
}

describe('RecipesScreen empty state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recipeRows = [];
    ingredientRows = [];
    mockQueries();
  });

  it('keeps the create-first-recipe action', () => {
    render(<RecipesScreen />);
    expect(screen.getByText('Create your first recipe')).toBeOnTheScreen();
  });

  it('seeds sample data from the dev button and shows the result', () => {
    const view = render(<RecipesScreen />);

    fireEvent.press(screen.getByText('Load sample data'));
    expect(seedMock).toHaveBeenCalledTimes(1);

    recipeRows = [{ id: 'r1', title: 'Tacos', servings: 4 }];
    view.rerender(<RecipesScreen />);
    expect(screen.getByText('Tacos')).toBeOnTheScreen();
    expect(screen.queryByText('Load sample data')).toBeNull();
  });
});
