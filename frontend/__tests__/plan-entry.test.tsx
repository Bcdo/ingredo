import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect } from 'expo-router';
import React from 'react';

import PlanEntryScreen from '../app/plan/entry/[id]';
import { removePlanEntry, setPlanEntryServings } from '../lib/db/mealPlan';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.innerJoin = () => node;
  node.where = () => node;
  return { db: node };
});

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'e1' }),
  router: { back: (...a: unknown[]) => mockBack(...a), push: (...a: unknown[]) => mockPush(...a) },
  Redirect: jest.fn(() => null),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../lib/db/mealPlan', () => ({
  setPlanEntryServings: jest.fn(),
  removePlanEntry: jest.fn(),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const RedirectMock = Redirect as unknown as jest.Mock;

const entryRow = { id: 'e1', recipeId: 'r1', servings: 4, title: 'Tomato Soup' };

describe('PlanEntryScreen', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockPush.mockClear();
    RedirectMock.mockClear();
    (setPlanEntryServings as jest.Mock).mockClear();
    (removePlanEntry as jest.Mock).mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('does not redirect before the query resolves', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: undefined }));
    render(<PlanEntryScreen />);
    expect(RedirectMock).not.toHaveBeenCalled();
  });

  it('redirects when the entry is gone', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));
    render(<PlanEntryScreen />);
    expect(RedirectMock).toHaveBeenCalled();
  });

  it('steps servings through the repository', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [entryRow], updatedAt: new Date() }));
    render(<PlanEntryScreen />);

    fireEvent.press(screen.getByLabelText('increment'));
    expect(setPlanEntryServings).toHaveBeenCalledWith(expect.anything(), null, 'e1', 5);
  });

  it('opens the recipe, moves, and removes', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [entryRow], updatedAt: new Date() }));
    render(<PlanEntryScreen />);

    fireEvent.press(screen.getByText('Open recipe'));
    expect(mockPush).toHaveBeenCalledWith('/recipe/r1');

    fireEvent.press(screen.getByText('Move to another day'));
    expect(mockPush).toHaveBeenCalledWith('/plan/pick-day?entry=e1');

    fireEvent.press(screen.getByText('Remove from plan'));
    expect(removePlanEntry).toHaveBeenCalledWith(expect.anything(), null, 'e1');
    expect(mockBack).toHaveBeenCalled();
  });
});
