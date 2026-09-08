import { currentLocale } from './i18n';
import { FIELD_LIMITS } from './fieldLimits';
import type { ScalingMode } from './units';
import type { RecipeInput, RecipeWithDetails } from './db/recipes';
import { toCanonical } from './measure';
import { parseQuantity, formatQuantity } from './quantity';
import { parseIngredientLine } from './import/ingredientLine';
import type { ImportedRecipe } from './import/recipeJsonLd';

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

// The URL-import path bypasses the form's Input `maxLength` props — those
// only clip further typing, not values dropped in programmatically — so an
// over-cap imported field would otherwise sail through untouched until the
// next push, 400ing the whole sync batch. Clamp here at the same caps the
// server actually enforces (frontend/lib/fieldLimits.ts).
export function formStateFromImport(imported: ImportedRecipe): RecipeFormState {
  return {
    title: imported.title.slice(0, FIELD_LIMITS.recipeTitle),
    description: imported.description,
    servings: imported.servings,
    notes: '',
    ingredients: imported.ingredientLines.map((line) => {
      const parsed = parseIngredientLine(line);
      return {
        key: draftKey(),
        quantity: formatQuantity(parsed.quantity, currentLocale()),
        unit: parsed.unit,
        name: parsed.name.slice(0, FIELD_LIMITS.ingredientName),
        scaling: 'linear' as const,
      };
    }),
    instructions: imported.steps.map((text) => ({ key: draftKey(), text })),
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
      .map((ing) => {
        // US chips are an entry convenience; storage is metric-canonical.
        const stored = toCanonical(parseQuantity(ing.quantity), ing.unit);
        return {
          name: ing.name.trim(),
          quantity: stored.quantity,
          unit: stored.unit,
          scaling: ing.scaling,
        };
      }),
    instructions: state.instructions
      .filter((step) => step.text.trim() !== '')
      .map((step) => ({ text: step.text.trim() })),
  };
}
