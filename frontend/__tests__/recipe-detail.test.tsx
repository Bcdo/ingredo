import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';

import RecipeDetailScreen from '../app/recipe/[id]/index';
import { listHouseholds } from '../lib/api/auth';
import { NetworkError } from '../lib/api/client';
import { addItems } from '../lib/db/shoppingList';
import { copyRecipeToHousehold } from '../lib/db/recipes';
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

jest.mock('../lib/db/shoppingList', () => ({
  addItems: jest.fn(() => 1),
}));

jest.mock('../lib/db/recipes', () => ({
  softDeleteRecipe: jest.fn(),
  copyRecipeToHousehold: jest.fn(() => 'copy-1'),
}));

jest.mock('../lib/api/auth', () => ({
  listHouseholds: jest.fn(),
}));

jest.mock('../lib/household', () => ({
  useActiveHouseholdId: () => 'h1',
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const RedirectMock = Redirect as unknown as jest.Mock;
const addItemsMock = addItems as jest.Mock;
const listHouseholdsMock = listHouseholds as jest.Mock;
const copyRecipeToHouseholdMock = copyRecipeToHousehold as jest.Mock;

const recipeRow: RecipeRow = {
  id: 'r1',
  title: 'Tomato Soup',
  description: null,
  householdId: 'h1',
  servings: 4,
  notes: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  dirty: 1,
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

describe('RecipeDetailScreen — add to shopping list', () => {
  beforeEach(() => {
    addItemsMock.mockClear();
  });

  it('adds all ingredients scaled to the selected servings in merge mode', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByLabelText('increment')); // servings 4 → 5
    fireEvent.press(screen.getByText('Add 2 ingredients to shopping list'));

    expect(addItemsMock).toHaveBeenCalledTimes(1);
    const [, , items, mode] = addItemsMock.mock.calls[0];
    expect(mode).toBe('merge');
    expect(items).toHaveLength(2);
    expect(
      items.find((i: { normalizedName: string }) => i.normalizedName === 'flour')
    ).toMatchObject({
      quantity: 250, // 200 g × 5/4
      unit: 'g',
      sources: ['Tomato Soup'],
    });
    expect(
      items.find((i: { normalizedName: string }) => i.normalizedName === 'chili flakes')
    ).toMatchObject({
      quantity: 5, // fixed: 1 ts → 5 ml, unscaled
      unit: 'ml',
    });
    expect(screen.getByText('Added to your shopping list')).toBeOnTheScreen();
  });

  it('excludes tapped ingredient rows and updates the button count', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByText('Flour'));
    fireEvent.press(screen.getByText('Add 1 ingredients to shopping list'));

    const [, , items] = addItemsMock.mock.calls[0];
    expect(items).toHaveLength(1);
    expect(items[0].normalizedName).toBe('chili flakes');
  });

  it('re-including a row restores it', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByText('Flour'));
    fireEvent.press(screen.getByText('Flour'));
    expect(screen.getByText('Add 2 ingredients to shopping list')).toBeOnTheScreen();
  });

  it('shows the save-error notice when the write throws', () => {
    addItemsMock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByText('Add 2 ingredients to shopping list'));
    expect(screen.getByText("Couldn't save — try again.")).toBeOnTheScreen();
  });
});

describe('RecipeDetailScreen — copy to household', () => {
  const active = {
    id: 'h1',
    name: 'Home',
    joinCode: 'ABC-DEF',
    memberCount: 2,
    role: 'owner',
    isActive: true,
  };
  const other = {
    id: 'h2',
    name: 'Hytta',
    joinCode: 'XYZ-123',
    memberCount: 1,
    role: 'owner',
    isActive: false,
  };
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    listHouseholdsMock.mockReset();
    copyRecipeToHouseholdMock.mockReset().mockReturnValue('copy-1');
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('copy with no other household shows the quiet notice', async () => {
    listHouseholdsMock.mockResolvedValueOnce([active]);
    mockQueries({ data: [recipeRow], updatedAt: new Date() });
    render(<RecipeDetailScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Copy to another household'));
    });

    expect(screen.getByText("You're only in one household.")).toBeOnTheScreen();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('copy picker offers only other households and copies into the chosen one', async () => {
    listHouseholdsMock.mockResolvedValueOnce([active, other]);
    mockQueries({ data: [recipeRow], updatedAt: new Date() });
    render(<RecipeDetailScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Copy to another household'));
    });

    expect(alertSpy).toHaveBeenCalledWith('Copy to which household?', undefined, expect.any(Array));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(['Hytta', 'Cancel']);

    await act(async () => {
      buttons[0].onPress?.();
    });

    expect(copyRecipeToHouseholdMock).toHaveBeenCalledWith(expect.anything(), 'h1', 'h2', 'r1');
    expect(screen.getByText('Copied to Hytta')).toBeOnTheScreen();
  });

  it('a failed household fetch shows the network message', async () => {
    listHouseholdsMock.mockRejectedValueOnce(new NetworkError('offline'));
    mockQueries({ data: [recipeRow], updatedAt: new Date() });
    render(<RecipeDetailScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Copy to another household'));
    });

    expect(screen.getByText('Cannot reach the server.')).toBeOnTheScreen();
  });
});
