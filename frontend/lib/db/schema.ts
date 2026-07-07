import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  servings: integer('servings').notNull().default(4),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
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

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type RecipeRow = typeof recipes.$inferSelect;
export type IngredientRow = typeof recipeIngredients.$inferSelect;
export type InstructionRow = typeof recipeInstructions.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
