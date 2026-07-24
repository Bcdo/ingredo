// Dev-only sample content for manual testing. Everything flows through
// createRecipe so seeded rows are indistinguishable from user input.
import { and, eq } from 'drizzle-orm';

import { createRecipe, type RecipeInput } from '../db/recipes';
import { notDeleted } from '../db/predicates';
import { recipes } from '../db/schema';
import type { DB } from '../db/types';

export const SAMPLE_RECIPES: RecipeInput[] = [
  {
    title: 'Tacos',
    description: 'Fredagsklassikeren med kjøttdeig og tilbehør.',
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Kjøttdeig', quantity: 400, unit: 'g' },
      { name: 'Tacokrydder', quantity: 2, unit: 'ss' },
      { name: 'Tortillalefser', quantity: 8, unit: 'stk' },
      { name: 'Tomater', quantity: 2, unit: 'stk' },
      { name: 'Mais', quantity: 150, unit: 'g' },
      { name: 'Revet ost', quantity: 100, unit: 'g' },
      { name: 'Rømme', quantity: 2, unit: 'dl' },
    ],
    instructions: [
      { text: 'Brun kjøttdeigen i en stekepanne.' },
      { text: 'Rør inn tacokrydder og litt vann, la småkoke i 5 minutter.' },
      { text: 'Server med lefser og tilbehør.' },
    ],
  },
  {
    title: 'Pasta carbonara',
    description: 'Rask hverdagspasta med bacon og egg.',
    servings: 4,
    notes: 'Bruk pastavannet til å justere konsistensen.',
    ingredients: [
      { name: 'Spaghetti', quantity: 400, unit: 'g' },
      { name: 'Bacon', quantity: 150, unit: 'g' },
      { name: 'Egg', quantity: 3, unit: 'stk' },
      { name: 'Parmesan', quantity: 50, unit: 'g' },
      { name: 'Salt til pastavannet', quantity: 1, unit: 'ss', scaling: 'fixed' },
      { name: 'Nykvernet pepper', quantity: null, unit: null },
    ],
    instructions: [
      { text: 'Kok spaghetti i godt saltet vann.' },
      { text: 'Stek bacon sprøtt, og visp sammen egg og parmesan.' },
      { text: 'Vend alt sammen av varmen så eggene ikke koagulerer.' },
    ],
  },
  {
    title: 'Kjøttkaker med potetmos',
    description: 'Tradisjonsmiddag med brun saus.',
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Kjøttdeig', quantity: 500, unit: 'g' },
      { name: 'Egg', quantity: 1, unit: 'stk' },
      { name: 'Melk', quantity: 1, unit: 'dl' },
      { name: 'Poteter', quantity: 800, unit: 'g' },
      { name: 'Smør', quantity: 50, unit: 'g' },
      { name: 'Muskat', quantity: 1, unit: 'ts', scaling: 'fixed' },
    ],
    instructions: [
      { text: 'Bland kjøttdeig, egg og melk, form kaker og stek dem.' },
      { text: 'Kok potetene møre og mos dem med smør.' },
      { text: 'Lag brun saus i pannen og la kjøttkakene trekke i den.' },
    ],
  },
  {
    title: 'Ovnsbakt laks med brokkoli',
    description: 'Enkel fiskemiddag på under en halvtime.',
    servings: 2,
    notes: null,
    ingredients: [
      { name: 'Laksefilet', quantity: 300, unit: 'g' },
      { name: 'Brokkoli', quantity: 250, unit: 'g' },
      { name: 'Sitron', quantity: 1, unit: 'stk' },
      { name: 'Olivenolje', quantity: 1, unit: 'ss' },
    ],
    instructions: [
      { text: 'Sett ovnen på 200 grader.' },
      { text: 'Legg laks og brokkoli på et brett, ringle over olje og sitron.' },
      { text: 'Bak i 15–18 minutter.' },
    ],
  },
  {
    title: 'Kikertcurry',
    description: 'Kremet vegetarcurry med kokosmelk.',
    servings: 6,
    notes: 'Smaker enda bedre dagen etter.',
    ingredients: [
      { name: 'Kikerter', quantity: 500, unit: 'g' },
      { name: 'Kokosmelk', quantity: 4, unit: 'dl' },
      { name: 'Løk', quantity: 2, unit: 'stk' },
      { name: 'Rød karripasta', quantity: 2, unit: 'ss' },
      { name: 'Ris', quantity: 4, unit: 'dl' },
      { name: 'Spinat', quantity: 100, unit: 'g' },
    ],
    instructions: [
      { text: 'Fres løk og karripasta i en gryte.' },
      { text: 'Tilsett kikerter og kokosmelk, la småkoke i 10 minutter.' },
      { text: 'Rør inn spinaten og server med ris.' },
    ],
  },
  {
    title: 'Tomatsuppe med makaroni',
    description: 'Barnas favoritt med egg og makaroni.',
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Hermetiske tomater', quantity: 800, unit: 'g' },
      { name: 'Grønnsaksbuljong', quantity: 1, unit: 'l' },
      { name: 'Makaroni', quantity: 200, unit: 'g' },
      { name: 'Egg', quantity: 4, unit: 'stk' },
      { name: 'Basilikum', quantity: null, unit: null },
    ],
    instructions: [
      { text: 'Kok opp tomater og buljong, la småkoke i 15 minutter.' },
      { text: 'Kok makaroni og hardkokte egg ved siden av.' },
      { text: 'Kjør suppen glatt og server med makaroni og eggebåter.' },
    ],
  },
  {
    title: 'Fredagsgryte',
    description: 'Alt-i-ett-gryte med røkt paprikasmak.',
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Chorizo', quantity: 200, unit: 'g' },
      { name: 'Kyllinglår', quantity: 400, unit: 'g' },
      { name: 'Paprika', quantity: 2, unit: 'stk' },
      { name: 'Hermetiske tomater', quantity: 400, unit: 'g' },
      { name: 'Ris', quantity: 3, unit: 'dl' },
    ],
    instructions: [
      { text: 'Brun chorizo og kylling i en gryte.' },
      { text: 'Tilsett paprika og tomater, la alt putre i 20 minutter.' },
      { text: 'Server over ris.' },
    ],
  },
  {
    title: 'Pannekaker',
    description: 'Tynne pannekaker til middag eller dessert.',
    servings: 6,
    notes: 'La røren svelle i 20 minutter.',
    ingredients: [
      { name: 'Hvetemel', quantity: 300, unit: 'g' },
      { name: 'Melk', quantity: 6, unit: 'dl' },
      { name: 'Egg', quantity: 4, unit: 'stk' },
      { name: 'Salt', quantity: 1, unit: 'ts', scaling: 'fixed' },
      { name: 'Smør til steking', quantity: 25, unit: 'g' },
    ],
    instructions: [
      { text: 'Visp sammen mel, melk, egg og salt til en jevn røre.' },
      { text: 'La røren svelle.' },
      { text: 'Stek tynne pannekaker i smør.' },
    ],
  },
];

export function seedSampleData(db: DB): number {
  let inserted = 0;
  for (const sample of SAMPLE_RECIPES) {
    const existing = db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.title, sample.title), notDeleted(recipes)))
      .all();
    if (existing.length === 0) {
      createRecipe(db, sample);
      inserted += 1;
    }
  }
  return inserted;
}
