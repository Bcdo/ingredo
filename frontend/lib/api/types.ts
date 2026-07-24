// Wire DTOs — camelCase as serialized by the ASP.NET backend.
export type UserResponseDto = {
  id: string;
  email: string;
  displayName: string;
  householdId: string;
  householdName: string;
};

export type AuthResponseDto = {
  accessToken: string;
  refreshToken: string;
  user: UserResponseDto;
};

export type MemberDto = {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
};

export type HouseholdDto = {
  id: string;
  name: string;
  joinCode: string;
  members: MemberDto[];
};

// Sync wire DTOs (slice-② contract): epoch-ms numbers, yyyy-MM-dd date
// strings, lowercase enum strings, sources as an opaque string.
export type SyncIngredientRowDto = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  scaling: string;
  sortOrder: number;
};

export type SyncInstructionRowDto = {
  id: string;
  text: string;
  sortOrder: number;
};

export type SyncRecipeRowDto = {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  ingredients: SyncIngredientRowDto[];
  instructions: SyncInstructionRowDto[];
};

export type SyncMealPlanRowDto = {
  id: string;
  date: string;
  recipeId: string;
  servings: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type SyncShoppingRowDto = {
  id: string;
  name: string;
  normalizedName: string;
  quantity: number | null;
  unit: string | null;
  sources: string;
  status: string;
  purchasedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type SyncPullResponseDto = {
  recipes: SyncRecipeRowDto[];
  mealPlanEntries: SyncMealPlanRowDto[];
  shoppingItems: SyncShoppingRowDto[];
  cursor: number;
};

export type SyncPushRequestDto = {
  recipes: SyncRecipeRowDto[] | null;
  mealPlanEntries: SyncMealPlanRowDto[] | null;
  shoppingItems: SyncShoppingRowDto[] | null;
};

export type SyncPushResponseDto = {
  results: Record<string, string>;
  cursor: number;
};

export type DirtyStamps = {
  recipes: Map<string, number>;
  mealPlanEntries: Map<string, number>;
  shoppingItems: Map<string, number>;
};
