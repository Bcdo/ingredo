export function filterRecipes<T extends { title: string; ingredientNames: string[] }>(
  items: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.ingredientNames.some((name) => name.toLowerCase().includes(q))
  );
}
