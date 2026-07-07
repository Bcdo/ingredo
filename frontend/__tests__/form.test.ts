import { emptyFormState, formStateFromRecipe, recipeInputFromForm } from '../lib/form';
import type { RecipeWithDetails } from '../lib/db/recipes';

describe('recipeInputFromForm', () => {
  it('trims strings and maps empty optionals to null', () => {
    const state = emptyFormState();
    state.title = '  Pancakes  ';
    const input = recipeInputFromForm(state);
    expect(input.title).toBe('Pancakes');
    expect(input.description).toBeNull();
    expect(input.notes).toBeNull();
    expect(input.ingredients).toEqual([]);
    expect(input.instructions).toEqual([]);
  });

  it('parses quantities and keeps unparseable ones as name-only', () => {
    const state = emptyFormState();
    state.title = 'Soup';
    state.ingredients = [
      { key: 'a', quantity: '1,5', unit: 'dl', name: 'Cream' },
      { key: 'b', quantity: 'a splash', unit: null, name: 'Olive oil' },
    ];
    const input = recipeInputFromForm(state);
    expect(input.ingredients).toEqual([
      { name: 'Cream', quantity: 1.5, unit: 'dl' },
      { name: 'Olive oil', quantity: null, unit: null },
    ]);
  });

  it('drops nameless ingredient rows and empty instruction steps', () => {
    const state = emptyFormState();
    state.title = 'Soup';
    state.ingredients = [{ key: 'a', quantity: '2', unit: 'stk', name: '   ' }];
    state.instructions = [
      { key: 's1', text: 'Chop' },
      { key: 's2', text: '   ' },
    ];
    const input = recipeInputFromForm(state);
    expect(input.ingredients).toEqual([]);
    expect(input.instructions).toEqual([{ text: 'Chop' }]);
  });
});

describe('formStateFromRecipe', () => {
  it('round-trips a recipe into editable drafts', () => {
    const details: RecipeWithDetails = {
      recipe: {
        id: 'r1',
        title: 'Soup',
        description: 'Warm',
        servings: 2,
        notes: null,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      },
      ingredients: [
        {
          id: 'i1',
          recipeId: 'r1',
          name: 'Tomatoes',
          quantity: 1.5,
          unit: 'kg',
          scaling: 'linear',
          sortOrder: 0,
        },
      ],
      instructions: [{ id: 's1', recipeId: 'r1', text: 'Simmer', sortOrder: 0 }],
    };
    const state = formStateFromRecipe(details);
    expect(state.title).toBe('Soup');
    expect(state.description).toBe('Warm');
    expect(state.notes).toBe('');
    expect(state.servings).toBe(2);
    expect(state.ingredients[0]).toMatchObject({ quantity: '1.5', unit: 'kg', name: 'Tomatoes' });
    expect(state.instructions[0]).toMatchObject({ text: 'Simmer' });
    // keys must be unique for React lists
    expect(state.ingredients[0].key).toBeTruthy();
  });
});
