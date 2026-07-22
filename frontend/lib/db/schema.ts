import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  servings: integer('servings').notNull().default(4),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  dirty: integer('dirty').notNull().default(1),
});

export const recipeIngredients = sqliteTable('recipe_ingredients', {
  id: text('id').primaryKey(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  quantity: real('quantity'),
  unit: text('unit'),
  scaling: text('scaling', { enum: ['linear', 'fixed'] })
    .notNull()
    .default('linear'),
  sortOrder: integer('sort_order').notNull(),
});

export const recipeInstructions = sqliteTable('recipe_instructions', {
  id: text('id').primaryKey(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const mealPlanEntries = sqliteTable(
  'meal_plan_entries',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    servings: integer('servings').notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
  },
  (table) => [index('meal_plan_entries_date_idx').on(table.date)]
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    sources: text('sources').notNull().default('[]'),
    status: text('status', { enum: ['active', 'purchased'] })
      .notNull()
      .default('active'),
    purchasedAt: integer('purchased_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
  },
  (table) => [index('shopping_items_status_idx').on(table.status, table.normalizedName)]
);

export type RecipeRow = typeof recipes.$inferSelect;
export type IngredientRow = typeof recipeIngredients.$inferSelect;
export type InstructionRow = typeof recipeInstructions.$inferSelect;
export type MealPlanEntryRow = typeof mealPlanEntries.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
export type ShoppingItemRow = typeof shoppingItems.$inferSelect;
