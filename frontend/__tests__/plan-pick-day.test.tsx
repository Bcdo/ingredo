import { fireEvent, render, screen } from '@testing-library/react-native';
import { Redirect } from 'expo-router';
import React from 'react';

import PickDayScreen from '../app/plan/pick-day';
import { addDays, todayLocal } from '../lib/dates';
import { addPlanEntry, movePlanEntry } from '../lib/db/mealPlan';
import { getRecipe } from '../lib/db/recipes';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.get = jest.fn(() => ({ id: 'e1' }));
  return { db: node, __node: node };
});

const mockBack = jest.fn();
let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: { back: (...a: unknown[]) => mockBack(...a) },
  Redirect: jest.fn(() => null),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../lib/db/mealPlan', () => ({
  addPlanEntry: jest.fn(() => 'new-entry'),
  movePlanEntry: jest.fn(),
}));

jest.mock('../lib/db/recipes', () => ({
  getRecipe: jest.fn(),
}));

const RedirectMock = Redirect as unknown as jest.Mock;

describe('PickDayScreen', () => {
  beforeEach(() => {
    mockBack.mockClear();
    RedirectMock.mockClear();
    (addPlanEntry as jest.Mock).mockClear();
    (movePlanEntry as jest.Mock).mockClear();
    (getRecipe as jest.Mock).mockReset();
    mockParams = {};
  });

  it('redirects when neither param is present', () => {
    render(<PickDayScreen />);
    expect(RedirectMock).toHaveBeenCalled();
  });

  it('redirects in recipe mode when the recipe is missing', () => {
    (getRecipe as jest.Mock).mockReturnValue(null);
    mockParams = { recipe: 'r-missing' };
    render(<PickDayScreen />);
    expect(RedirectMock).toHaveBeenCalled();
  });

  it('adds an entry with the recipe default servings in recipe mode', () => {
    (getRecipe as jest.Mock).mockReturnValue({
      recipe: { id: 'r1', servings: 4 },
      ingredients: [],
      instructions: [],
    });
    mockParams = { recipe: 'r1' };

    render(<PickDayScreen />);
    fireEvent.press(screen.getByText('Tomorrow'));

    expect(addPlanEntry).toHaveBeenCalledWith(expect.anything(), null, {
      date: addDays(todayLocal(), 1),
      recipeId: 'r1',
      servings: 4,
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('moves the entry in entry mode', () => {
    mockParams = { entry: 'e1' };

    render(<PickDayScreen />);
    fireEvent.press(screen.getByText('Today'));

    expect(movePlanEntry).toHaveBeenCalledWith(expect.anything(), null, 'e1', todayLocal());
    expect(mockBack).toHaveBeenCalled();
  });
});
