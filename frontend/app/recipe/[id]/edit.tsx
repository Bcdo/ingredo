import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { RecipeForm } from '../../../components/RecipeForm';
import { db } from '../../../lib/db/client';
import { getRecipe, updateRecipe } from '../../../lib/db/recipes';
import { formStateFromRecipe, recipeInputFromForm, type RecipeFormState } from '../../../lib/form';
import { useActiveHouseholdId } from '../../../lib/household';
import { t } from '../../../lib/i18n';

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const householdId = useActiveHouseholdId();
  // The form edits a snapshot taken when the screen opens (or is reloaded).
  // `version` bumps to take a fresh one, remounting the form.
  const [version, setVersion] = useState(0);
  const details = useMemo(
    () => getRecipe(db, householdId, id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [householdId, id, version]
  );
  const initialState = useMemo(() => (details ? formStateFromRecipe(details) : null), [details]);

  if (!details || !initialState) {
    return <Redirect href="/(tabs)/recipes" />;
  }

  const save = (state: RecipeFormState) => {
    updateRecipe(db, householdId, details.recipe.id, recipeInputFromForm(state));
  };

  // A sync pull can replace the recipe underneath an open editor. Saving the
  // stale snapshot would stamp it newer than the pulled version, and since a
  // push replaces the whole aggregate, that wipes the other device's edit on
  // every phone. Compare against the row as it is now and let the user choose.
  const handleSave = (state: RecipeFormState): boolean => {
    const current = getRecipe(db, householdId, id);
    const unchanged = current !== null && current.recipe.updatedAt === details.recipe.updatedAt;
    if (unchanged) {
      save(state);
      return true;
    }
    Alert.alert(t('form.changedElsewhereTitle'), t('form.changedElsewhereMessage'), [
      {
        text: t('form.changedElsewhereReload'),
        onPress: () => setVersion((v) => v + 1),
      },
      {
        text: t('form.changedElsewhereOverwrite'),
        style: 'destructive',
        onPress: () => {
          save(state);
          router.back();
        },
      },
    ]);
    return false;
  };

  return (
    <RecipeForm
      key={version}
      heading={t('form.editTitle')}
      initialState={initialState}
      onSave={handleSave}
    />
  );
}
