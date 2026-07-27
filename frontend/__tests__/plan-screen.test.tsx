import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import PlanScreen from '../app/(tabs)/plan';
import { addItems } from '../lib/db/shoppingList';
import { todayLocal } from '../lib/dates';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.innerJoin = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../lib/db/shoppingList', () => ({
  addItems: jest.fn(() => 0),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const addItemsMock = addItems as jest.Mock;

let planRows: unknown[] = [];
let ingredientRows: unknown[] = [];
let activeKeyRows: unknown[] = [];

function mockQueries() {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 3;
    call += 1;
    if (index === 0) return { data: planRows, updatedAt: new Date() };
    if (index === 1) return { data: ingredientRows, updatedAt: new Date() };
    return { data: activeKeyRows, updatedAt: new Date() };
  });
}

const ingredientRow = {
  entryServings: 6,
  recipeServings: 4,
  recipeTitle: 'Tomato Soup',
  name: 'Tomatoes',
  quantity: 400,
  unit: 'g',
  scaling: 'linear',
};

describe('PlanScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    planRows = [];
    ingredientRows = [];
    activeKeyRows = [];
    mockQueries();
  });

  it('renders seven day sections with add slots, today first', () => {
    render(<PlanScreen />);

    expect(screen.getAllByText(/\+ Add dinner/)).toHaveLength(7);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
  });

  it('renders planned meals under their day and opens the entry sheet on tap', () => {
    const today = todayLocal();
    planRows = [{ id: 'e1', date: today, servings: 6, title: 'Tomato Soup' }];

    render(<PlanScreen />);

    fireEvent.press(screen.getByText('Tomato Soup'));
    expect(mockPush).toHaveBeenCalledWith('/plan/entry/e1');
  });

  it('routes the add slot to the picker with the day date', () => {
    const today = todayLocal();

    render(<PlanScreen />);

    fireEvent.press(screen.getAllByText(/\+ Add dinner/)[0]);
    expect(mockPush).toHaveBeenCalledWith(`/plan/add?date=${today}`);
  });

  it('hides the CTA when the week contributes no new ingredients', () => {
    render(<PlanScreen />);
    expect(screen.queryByText(/Add week to shopping list/)).toBeNull();
  });

  it('shows the CTA with the aggregated count and writes with skip-existing on tap', () => {
    ingredientRows = [
      ingredientRow,
      { ...ingredientRow, name: 'tomatoes', quantity: 100 },
      { ...ingredientRow, name: 'Basil', quantity: null, unit: null },
    ];

    render(<PlanScreen />);

    fireEvent.press(screen.getByText('Add week to shopping list · 2 ingredients'));
    expect(addItemsMock).toHaveBeenCalledTimes(1);
    const [, , items, mode] = addItemsMock.mock.calls[0];
    expect(mode).toBe('skip-existing');
    expect(items).toHaveLength(2);
    expect(
      items.find((i: { normalizedName: string }) => i.normalizedName === 'tomatoes').quantity
    ).toBe(750); // (400+100) × 6/4
  });

  it('excludes ingredients whose key is already an active shopping item', () => {
    ingredientRows = [ingredientRow];
    activeKeyRows = [{ normalizedName: 'tomatoes', unit: 'g' }];

    render(<PlanScreen />);

    expect(screen.queryByText(/Add week to shopping list/)).toBeNull();
  });
});
