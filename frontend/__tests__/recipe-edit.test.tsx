import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Redirect, router } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';

import EditRecipeScreen from '../app/recipe/[id]/edit';
import { getRecipe, updateRecipe } from '../lib/db/recipes';
import { t } from '../lib/i18n';

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

let mockRouteId = 'missing';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockRouteId }),
  router: { back: jest.fn() },
  Redirect: jest.fn(() => null),
}));

const RedirectMock = Redirect as unknown as jest.Mock;
const getRecipeMock = getRecipe as jest.Mock;
const updateRecipeMock = updateRecipe as jest.Mock;

const details = (updatedAt: number, title = 'Soup') => ({
  recipe: {
    id: 'r1',
    title,
    description: null,
    servings: 4,
    notes: 'Serve hot',
    householdId: null,
    createdAt: 1,
    updatedAt,
    deletedAt: null,
    dirty: 0,
  },
  ingredients: [],
  instructions: [{ id: 'i1', recipeId: 'r1', text: 'Boil', sortOrder: 0 }],
});

describe('EditRecipeScreen', () => {
  beforeEach(() => {
    mockRouteId = 'missing';
    RedirectMock.mockClear();
    getRecipeMock.mockReset();
    updateRecipeMock.mockReset();
    (router.back as jest.Mock).mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redirects to the recipes tab when the recipe no longer exists', () => {
    getRecipeMock.mockReturnValue(null);

    render(<EditRecipeScreen />);

    expect(RedirectMock).toHaveBeenCalled();
    expect(RedirectMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ href: '/(tabs)/recipes' })
    );
  });

  it('saves and navigates back when the recipe is unchanged since it was opened', () => {
    mockRouteId = 'r1';
    getRecipeMock.mockReturnValue(details(100));

    render(<EditRecipeScreen />);
    fireEvent.press(screen.getByRole('button', { name: t('form.save') }));

    expect(updateRecipeMock).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a recipe that changed elsewhere while editing', () => {
    // The screen snapshots the recipe when it opens. If a sync pull replaces
    // the recipe before save, a blind save would stamp the stale snapshot
    // newer than the pulled version and wipe the other device's edit on
    // every phone. The user must choose.
    mockRouteId = 'r1';
    getRecipeMock.mockReturnValueOnce(details(100)).mockReturnValue(details(200, 'Soup v2'));

    render(<EditRecipeScreen />);
    fireEvent.press(screen.getByRole('button', { name: t('form.save') }));

    expect(updateRecipeMock).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      t('form.changedElsewhereTitle'),
      t('form.changedElsewhereMessage'),
      expect.arrayContaining([
        expect.objectContaining({ text: t('form.changedElsewhereOverwrite') }),
        expect.objectContaining({ text: t('form.changedElsewhereReload') }),
      ])
    );

    // Choosing overwrite performs the save the user asked for.
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.text === t('form.changedElsewhereOverwrite'))?.onPress?.();
    expect(updateRecipeMock).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('reloading after a remote change shows the newer version in the form', () => {
    mockRouteId = 'r1';
    getRecipeMock.mockReturnValueOnce(details(100)).mockReturnValue(details(200, 'Soup v2'));

    render(<EditRecipeScreen />);
    expect(screen.getByDisplayValue('Soup')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: t('form.save') }));

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    act(() => {
      buttons.find((b) => b.text === t('form.changedElsewhereReload'))?.onPress?.();
    });

    expect(screen.getByDisplayValue('Soup v2')).toBeTruthy();
    expect(updateRecipeMock).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });
});
