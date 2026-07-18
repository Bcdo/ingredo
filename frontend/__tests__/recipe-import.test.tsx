import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { RecipeForm } from '../components/RecipeForm';
import { emptyFormState } from '../lib/form';
import { t } from '../lib/i18n';
import { fetchRecipeFromUrl } from '../lib/import/fetchRecipe';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('../lib/import/fetchRecipe', () => ({
  fetchRecipeFromUrl: jest.fn(),
}));

const fetchRecipeMock = fetchRecipeFromUrl as jest.Mock;

const IMPORTED = {
  title: 'Pannekaker',
  description: 'Klassiske',
  servings: 6,
  ingredientLines: ['400 g hvetemel'],
  steps: ['Visp sammen.'],
};

describe('RecipeForm import strip', () => {
  beforeEach(() => {
    fetchRecipeMock.mockReset();
  });

  it('is hidden unless allowImport is set', () => {
    render(<RecipeForm heading="New" initialState={emptyFormState()} onSave={jest.fn()} />);
    expect(screen.queryByPlaceholderText(t('import.placeholder'))).toBeNull();
  });

  it('disables the import button while the URL is empty', () => {
    render(
      <RecipeForm allowImport heading="New" initialState={emptyFormState()} onSave={jest.fn()} />
    );
    const button = screen.getByRole('button', { name: t('import.button') });
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(button);
    expect(fetchRecipeMock).not.toHaveBeenCalled();
  });

  it('fills the form from a successful import', async () => {
    fetchRecipeMock.mockResolvedValue(IMPORTED);
    render(
      <RecipeForm allowImport heading="New" initialState={emptyFormState()} onSave={jest.fn()} />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText(t('import.placeholder')),
      'matsiden.no/pannekaker'
    );
    fireEvent.press(screen.getByRole('button', { name: t('import.button') }));

    expect(await screen.findByDisplayValue('Pannekaker')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('hvetemel')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Visp sammen.')).toBeOnTheScreen();
    expect(fetchRecipeMock).toHaveBeenCalledWith('matsiden.no/pannekaker');
  });

  it('shows the failure notice when nothing could be imported', async () => {
    fetchRecipeMock.mockResolvedValue(null);
    render(
      <RecipeForm allowImport heading="New" initialState={emptyFormState()} onSave={jest.fn()} />
    );

    fireEvent.changeText(screen.getByPlaceholderText(t('import.placeholder')), 'example.com');
    fireEvent.press(screen.getByRole('button', { name: t('import.button') }));

    expect(await screen.findByText(t('import.failed'))).toBeOnTheScreen();
  });
});
