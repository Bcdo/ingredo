import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { IdeasRail } from '../components/plan/IdeasRail';
import type { RecipeIdea } from '../lib/suggestions/recipeIdeas';

const items = [
  { id: 'taco', title: 'Fredagstaco', servings: 4, ingredientNames: [] },
  { id: 'suppe', title: 'Tomatsuppe', servings: 2, ingredientNames: [] },
];

const ideas: RecipeIdea[] = [
  { recipeId: 'taco', kind: 'favorite' },
  { recipeId: 'suppe', kind: 'while' },
];

describe('IdeasRail', () => {
  it('renders both kinds with their reason captions', () => {
    render(<IdeasRail ideas={ideas} items={items} onSelect={jest.fn()} />);

    expect(screen.getByText('Ideas')).toBeOnTheScreen();
    expect(screen.getByText('Fredagstaco')).toBeOnTheScreen();
    expect(screen.getByText('A favorite')).toBeOnTheScreen();
    expect(screen.getByText('Tomatsuppe')).toBeOnTheScreen();
    expect(screen.getByText("It's been a while")).toBeOnTheScreen();
  });

  it('tapping a chip selects the picker item', () => {
    const onSelect = jest.fn();
    render(<IdeasRail ideas={ideas} items={items} onSelect={onSelect} />);

    fireEvent.press(screen.getByText('Fredagstaco'));

    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('renders nothing with no ideas', () => {
    const { toJSON } = render(<IdeasRail ideas={[]} items={items} onSelect={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('skips ideas whose recipe is missing from the items', () => {
    const { toJSON } = render(
      <IdeasRail ideas={[{ recipeId: 'ghost', kind: 'favorite' }]} items={items} onSelect={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });
});
