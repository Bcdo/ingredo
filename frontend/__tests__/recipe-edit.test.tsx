import { render } from '@testing-library/react-native';
import { Redirect } from 'expo-router';
import React from 'react';

import EditRecipeScreen from '../app/recipe/[id]/edit';
import { getRecipe } from '../lib/db/recipes';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

jest.mock('../lib/db/recipes', () => ({
  getRecipe: jest.fn(),
  updateRecipe: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'missing' }),
  router: { back: jest.fn() },
  Redirect: jest.fn(() => null),
}));

const RedirectMock = Redirect as unknown as jest.Mock;
const getRecipeMock = getRecipe as jest.Mock;

describe('EditRecipeScreen', () => {
  beforeEach(() => {
    RedirectMock.mockClear();
    getRecipeMock.mockReset();
  });

  it('redirects to the recipes tab when the recipe no longer exists', () => {
    getRecipeMock.mockReturnValue(null);

    render(<EditRecipeScreen />);

    expect(RedirectMock).toHaveBeenCalled();
    expect(RedirectMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ href: '/(tabs)/recipes' })
    );
  });
});
