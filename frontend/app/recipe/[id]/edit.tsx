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
  const initialState = useMemo(() => (details ? formStateFromRecipe(details) : null), [details]);

  if (!details || !initialState) {
    return <Redirect href="/(tabs)/recipes" />;
  }

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
