import {
  emptyFormState,
  formStateFromRecipe,
  recipeInputFromForm,
  formStateFromImport,
} from '../lib/form';
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
      { key: 'a', quantity: '1,5', unit: 'dl', name: 'Cream', scaling: 'linear' },
      { key: 'b', quantity: 'a splash', unit: null, name: 'Olive oil', scaling: 'linear' },
    ];
    const input = recipeInputFromForm(state);
    expect(input.ingredients).toEqual([
      { name: 'Cream', quantity: 1.5, unit: 'dl', scaling: 'linear' },
      { name: 'Olive oil', quantity: null, unit: null, scaling: 'linear' },
    ]);
  });

  it('drops nameless ingredient rows and empty instruction steps', () => {
    const state = emptyFormState();
    state.title = 'Soup';
    state.ingredients = [{ key: 'a', quantity: '2', unit: 'stk', name: '   ', scaling: 'linear' }];
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
        householdId: null,
        notes: null,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
        dirty: 1,
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

  it('round-trips the scaling flag through form state', () => {
    const details: RecipeWithDetails = {
      recipe: {
        id: 'r1',
        title: 'Chili',
        description: null,
        householdId: null,
        servings: 4,
        notes: null,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
        dirty: 1,
      },
      ingredients: [
        {
          id: 'i1',
          recipeId: 'r1',
          name: 'Beans',
          quantity: 400,
          unit: 'g',
          scaling: 'linear',
          sortOrder: 0,
        },
        {
          id: 'i2',
          recipeId: 'r1',
          name: 'Chili flakes',
          quantity: 1,
          unit: 'ts',
          scaling: 'fixed',
          sortOrder: 1,
        },
      ],
      instructions: [],
    };
    const state = formStateFromRecipe(details);
    expect(state.ingredients.map((i) => i.scaling)).toEqual(['linear', 'fixed']);

    const input = recipeInputFromForm(state);
    expect(input.ingredients.map((i) => i.scaling)).toEqual(['linear', 'fixed']);
  });
});

describe('formStateFromImport', () => {
  const imported = {
    title: 'Pannekaker',
    description: 'Klassiske',
    servings: 6,
    ingredientLines: ['400 g hvetemel', 'Salt og pepper'],
    steps: ['Visp.', 'Stek.'],
  };

  it('maps an imported recipe into review-ready form state', () => {
    const state = formStateFromImport(imported);
    expect(state.title).toBe('Pannekaker');
    expect(state.description).toBe('Klassiske');
    expect(state.servings).toBe(6);
    expect(state.notes).toBe('');
    expect(state.ingredients).toHaveLength(2);
    expect(state.ingredients[0]).toMatchObject({
      quantity: '400',
      unit: 'g',
      name: 'hvetemel',
      scaling: 'linear',
    });
    expect(state.ingredients[1]).toMatchObject({
      quantity: '',
      unit: null,
      name: 'Salt og pepper',
    });
    expect(state.instructions.map((step) => step.text)).toEqual(['Visp.', 'Stek.']);
  });

  it('assigns unique draft keys', () => {
    const state = formStateFromImport(imported);
    const keys = [...state.ingredients, ...state.instructions].map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
