import React from 'react';

import { RecipeForm } from '../../components/RecipeForm';
import { db } from '../../lib/db/client';
import { createRecipe } from '../../lib/db/recipes';
import { emptyFormState, recipeInputFromForm } from '../../lib/form';
import { t } from '../../lib/i18n';

export default function NewRecipeScreen() {
  return (
    <RecipeForm
      heading={t('form.newTitle')}
      initialState={emptyFormState()}
      onSave={(state) => {
        createRecipe(db, recipeInputFromForm(state));
      }}
    />
  );
}
