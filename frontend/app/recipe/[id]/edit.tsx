import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';

import { RecipeForm } from '../../../components/RecipeForm';
import { db } from '../../../lib/db/client';
import { getRecipe, updateRecipe } from '../../../lib/db/recipes';
import { formStateFromRecipe, recipeInputFromForm } from '../../../lib/form';
import { t } from '../../../lib/i18n';

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const details = useMemo(() => getRecipe(db, id), [id]);

  if (!details) {
    return <Redirect href="/(tabs)/recipes" />;
  }

  const initialState = formStateFromRecipe(details);

  return (
    <RecipeForm
      heading={t('form.editTitle')}
      initialState={initialState}
      onSave={(state) => {
        updateRecipe(db, details.recipe.id, recipeInputFromForm(state));
      }}
    />
  );
}
