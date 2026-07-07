import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import PlanScreen from '../app/(tabs)/plan';
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

const mockUseLiveQuery = useLiveQuery as jest.Mock;

describe('PlanScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('renders seven day sections with add slots, today first', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));

    render(<PlanScreen />);

    expect(screen.getAllByText(/\+ Add dinner/)).toHaveLength(7);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
  });

  it('renders planned meals under their day and opens the entry sheet on tap', () => {
    const today = todayLocal();
    mockUseLiveQuery.mockImplementation(() => ({
      data: [{ id: 'e1', date: today, servings: 6, title: 'Tomato Soup' }],
      updatedAt: new Date(),
    }));

    render(<PlanScreen />);

    fireEvent.press(screen.getByText('Tomato Soup'));
    expect(mockPush).toHaveBeenCalledWith('/plan/entry/e1');
  });

  it('routes the add slot to the picker with the day date', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));
    const today = todayLocal();

    render(<PlanScreen />);

    fireEvent.press(screen.getAllByText(/\+ Add dinner/)[0]);
    expect(mockPush).toHaveBeenCalledWith(`/plan/add?date=${today}`);
  });
});
