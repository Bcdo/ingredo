import { currentLocale } from './i18n';
import type { ScalingMode } from './units';
import type { RecipeInput, RecipeWithDetails } from './db/recipes';
import { parseQuantity, formatQuantity } from './quantity';

export type IngredientDraft = {
  key: string;
  quantity: string;
  unit: string | null;
  name: string;
  scaling: ScalingMode;
};
export type InstructionDraft = { key: string; text: string };

export type RecipeFormState = {
  title: string;
  description: string;
  servings: number;
  notes: string;
  ingredients: IngredientDraft[];
  instructions: InstructionDraft[];
};

let keyCounter = 0;
export function draftKey(): string {
  keyCounter += 1;
  return `draft-${keyCounter}`;
}

export function emptyFormState(): RecipeFormState {
  return { title: '', description: '', servings: 4, notes: '', ingredients: [], instructions: [] };
}

export function formStateFromRecipe(details: RecipeWithDetails): RecipeFormState {
  return {
    title: details.recipe.title,
    description: details.recipe.description ?? '',
    servings: details.recipe.servings,
    notes: details.recipe.notes ?? '',
    ingredients: details.ingredients.map((ing) => ({
      key: draftKey(),
      quantity: formatQuantity(ing.quantity, currentLocale()),
      unit: ing.unit,
      name: ing.name,
      scaling: ing.scaling,
    })),
    instructions: details.instructions.map((step) => ({ key: draftKey(), text: step.text })),
  };
}

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function recipeInputFromForm(state: RecipeFormState): RecipeInput {
  return {
    title: state.title.trim(),
    description: orNull(state.description),
    servings: state.servings,
    notes: orNull(state.notes),
    ingredients: state.ingredients
      .filter((ing) => ing.name.trim() !== '')
      .map((ing) => ({
        name: ing.name.trim(),
        quantity: parseQuantity(ing.quantity),
        unit: ing.unit,
        scaling: ing.scaling,
      })),
    instructions: state.instructions
      .filter((step) => step.text.trim() !== '')
      .map((step) => ({ text: step.text.trim() })),
  };
}
