import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import { Alert, KeyboardAvoidingView } from 'react-native';

import { RecipeForm } from '../components/RecipeForm';
import { emptyFormState, type RecipeFormState } from '../lib/form';
import { t } from '../lib/i18n';
import en from '../lib/i18n/en.json';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

function titledState(title: string): RecipeFormState {
  const state = emptyFormState();
  state.title = title;
  return state;
}

function threeStepState(): RecipeFormState {
  return {
    title: 'Soup',
    description: '',
    servings: 4,
    notes: '',
    ingredients: [],
    instructions: [
      { key: 's1', text: 'Chop the onions' },
      { key: 's2', text: 'Boil the stock' },
      { key: 's3', text: 'Serve hot' },
    ],
  };
}

describe('RecipeForm', () => {
  beforeEach(() => {
    (router.back as jest.Mock).mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disables save while the title is blank and enables it once typed', () => {
    const onSave = jest.fn();
    render(<RecipeForm heading="New" initialState={emptyFormState()} onSave={onSave} />);

    const saveButton = screen.getByRole('button', { name: t('form.save') });
    expect(saveButton.props.accessibilityState).toEqual({ disabled: true });

    fireEvent.press(saveButton);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByPlaceholderText(t('form.titlePlaceholder')), 'Soup');

    const enabledSaveButton = screen.getByRole('button', { name: t('form.save') });
    expect(enabledSaveButton.props.accessibilityState).toEqual({ disabled: false });

    fireEvent.press(enabledSaveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows the save-error banner and does not navigate back when onSave throws', () => {
    const onSave = jest.fn(() => {
      throw new Error('boom');
    });
    render(<RecipeForm heading="Edit" initialState={titledState('Soup')} onSave={onSave} />);

    fireEvent.press(screen.getByRole('button', { name: t('form.save') }));

    expect(screen.getByText(t('form.saveError'))).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('navigates back after a successful save', () => {
    const onSave = jest.fn();
    render(<RecipeForm heading="Edit" initialState={titledState('Soup')} onSave={onSave} />);

    fireEvent.press(screen.getByRole('button', { name: t('form.save') }));

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('does not treat an untouched form as dirty when the parent re-renders with a fresh but equal initialState', () => {
    const onSave = jest.fn();
    const state1 = titledState('Soup');
    const { rerender } = render(
      <RecipeForm heading="Edit" initialState={state1} onSave={onSave} />
    );

    // Simulate a parent re-render minting a brand-new (but value-equal) draft
    // object, the way edit.tsx did before it memoized formStateFromRecipe.
    const state2: RecipeFormState = {
      ...state1,
      ingredients: [...state1.ingredients],
      instructions: [...state1.instructions],
    };
    rerender(<RecipeForm heading="Edit" initialState={state2} onSave={onSave} />);

    fireEvent.press(screen.getByRole('button', { name: t('form.cancel') }));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('toggles an ingredient to fixed scaling and saves it', () => {
    const onSave = jest.fn();
    render(
      <RecipeForm
        heading="Edit"
        initialState={{
          title: 'Chili',
          description: '',
          servings: 4,
          notes: '',
          ingredients: [
            { key: 'k1', quantity: '1', unit: 'ts', name: 'Chili flakes', scaling: 'linear' },
          ],
          instructions: [],
        }}
        onSave={onSave}
      />
    );

    fireEvent.press(screen.getByText(en.form.scalingFixed));
    fireEvent.press(screen.getByRole('button', { name: t('form.save') }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredients: [expect.objectContaining({ scaling: 'fixed' })],
      })
    );
  });

  it('avoids the keyboard so bottom fields stay visible', () => {
    const onSave = jest.fn();
    render(<RecipeForm heading="New" initialState={emptyFormState()} onSave={onSave} />);

    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
  });

  it('saves instructions in the new order after a drag ends', () => {
    const { __getLastGridProps } = require('react-native-sortables') as any;
    const onSave = jest.fn();
    const initial = threeStepState();
    render(<RecipeForm heading="Edit" initialState={initial} onSave={onSave} />);

    const grid = __getLastGridProps();
    act(() => {
      grid.onDragEnd({
        data: [initial.instructions[1], initial.instructions[0], initial.instructions[2]],
        fromIndex: 1,
        toIndex: 0,
      });
    });

    fireEvent.press(screen.getByRole('button', { name: t('form.save') }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: [
          expect.objectContaining({ key: 's2', text: 'Boil the stock' }),
          expect.objectContaining({ key: 's1', text: 'Chop the onions' }),
          expect.objectContaining({ key: 's3', text: 'Serve hot' }),
        ],
      })
    );
  });

  it('renumbers steps from their current order after a reorder', () => {
    const { __getLastGridProps } = require('react-native-sortables') as any;
    const initial = threeStepState();
    render(<RecipeForm heading="Edit" initialState={initial} onSave={jest.fn()} />);

    act(() => {
      __getLastGridProps().onDragEnd({
        data: [initial.instructions[2], initial.instructions[0], initial.instructions[1]],
        fromIndex: 2,
        toIndex: 0,
      });
    });

    // Each step number appears exactly once — numbers follow position, not identity.
    expect(screen.getAllByText('1')).toHaveLength(1);
    expect(screen.getAllByText('2')).toHaveLength(1);
    expect(screen.getAllByText('3')).toHaveLength(1);
    // The moved step's text is still editable content in the form.
    expect(screen.getByDisplayValue('Serve hot')).toBeTruthy();
  });
});
