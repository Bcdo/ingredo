// Mirrors the FluentValidation `MaximumLength` rules the backend actually
// enforces (backend/Ingredo.Api/Recipes/RecipeValidators.cs,
// backend/Ingredo.Api/Shopping/ShoppingValidators.cs — sync push reuses
// these same validators, see SyncService.ValidateBatchAsync). A single
// over-cap field 400s the whole sync batch forever, so anywhere one of
// these fields is edited or imported must clamp to the same number.
//
// Not every synced text field has a server-side cap: recipe description,
// recipe notes, recipe ingredient unit, and instruction text have no
// MaximumLength rule today, so there is nothing to mirror here for them.
export const FIELD_LIMITS = {
  recipeTitle: 500,
  ingredientName: 500,
  shoppingItemName: 500,
} as const;
