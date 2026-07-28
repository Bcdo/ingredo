# Household Switcher & Recipe Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Account section becomes the household switcher (list/switch/create beside the existing join/leave), recipes gain a copy-to-household action, and TESTING.md gets the real multi-household manual pass.

**Architecture:** Three API functions over slice ①'s plural endpoints (create/switch apply the returned `AuthResponse`, so partition swap → sync → realtime all ride the existing session chain); a switcher list + create row in `AccountSection` with corrected leave copy/mapping; a partition-guarded re-mint `copyRecipeToHousehold` (no `scheduleSync` — the copy uploads when the target household is next active) behind a native-Alert picker on the recipe detail screen.

**Tech Stack:** Expo SDK 54, RNTL + Jest, i18n-js (nb/en key-parity test), drizzle (better-sqlite3 in tests).

**Spec:** `docs/superpowers/specs/2026-07-28-household-switcher-design.md`

## Global Constraints

- **Bilingual:** every new string lands in BOTH `lib/i18n/en.json` and `lib/i18n/nb.json` with the exact copy from the spec's decision 6 (the parity test enforces the key sets; the spec's wording is verbatim).
- **`household_id` comparisons live ONLY in `lib/db/predicates.ts`** — `copyRecipeToHousehold` calls `inHousehold`; writing `householdId` in `values` is plain tagging.
- **The copy deliberately does NOT call `scheduleSync()`** — it is out-of-partition for the current cycle; slice ③'s scoped collect uploads it when the target household is next active.
- **Backend, sync engine, store, and all other screens are untouched.**
- **Repo signature convention:** partition parameter immediately after `db`.
- Run all frontend commands from `frontend/`. Baseline: 445 tests passing, `npx tsc --noEmit` clean, lint at the 13-file prettier-drift baseline. Each task ends with `npm test` green, tsc clean, and a commit.

---

### Task 1: API layer — list/create/switch

**Files:**
- Modify: `frontend/lib/api/types.ts`, `frontend/lib/api/auth.ts`
- Test: `frontend/__tests__/api-auth.test.ts` (extend)

**Interfaces:**
- Produces (exact): `HouseholdSummaryDto = { id: string; name: string; joinCode: string; memberCount: number; role: string; isActive: boolean }` from `types.ts`; `listHouseholds(): Promise<HouseholdSummaryDto[]>`, `createHousehold(name: string): Promise<void>`, `switchHousehold(householdId: string): Promise<void>` from `auth.ts`. Tasks 2–3 consume these names.

- [ ] **Step 1: Add the DTO to `types.ts`**

After `HouseholdDto`:

```ts
export type HouseholdSummaryDto = {
  id: string;
  name: string;
  joinCode: string;
  memberCount: number;
  role: string;
  isActive: boolean;
};
```

- [ ] **Step 2: Add the three functions to `auth.ts`**

Extend the `types` import with `HouseholdSummaryDto`; append after `leaveHousehold`:

```ts
export async function listHouseholds(): Promise<HouseholdSummaryDto[]> {
  return apiFetch<HouseholdSummaryDto[]>('/api/v1/households');
}

export async function createHousehold(name: string): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/households', {
    method: 'POST',
    body: { name },
  });
  await applyAuthResponse(auth);
}

export async function switchHousehold(householdId: string): Promise<void> {
  const auth = await apiFetch<AuthResponseDto>('/api/v1/households/switch', {
    method: 'POST',
    body: { householdId },
  });
  await applyAuthResponse(auth);
}
```

- [ ] **Step 3: Extend `api-auth.test.ts`**

Follow the file's rig (mocked `apiFetch`, real session module, the `auth` fixture). Add a describe block:

```ts
describe('households API', () => {
  it('listHouseholds fetches the plural endpoint', async () => {
    const summaries = [
      { id: 'h1', name: 'Hjemme', joinCode: 'ABC-DEF', memberCount: 2, role: 'owner', isActive: true },
    ];
    apiFetchMock.mockResolvedValueOnce(summaries);

    await expect(listHouseholds()).resolves.toEqual(summaries);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/households');
  });

  it('createHousehold posts the name and activates the returned household', async () => {
    apiFetchMock.mockResolvedValueOnce({
      ...auth,
      user: { ...auth.user, householdId: 'h-new', householdName: 'Hytta' },
    });

    await createHousehold('Hytta');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/households', {
      method: 'POST',
      body: { name: 'Hytta' },
    });
    expect(getSession().householdId).toBe('h-new');
  });

  it('switchHousehold posts the id and activates the returned household', async () => {
    apiFetchMock.mockResolvedValueOnce({
      ...auth,
      user: { ...auth.user, householdId: 'h2', householdName: 'Hytta' },
    });

    await switchHousehold('h2');

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/households/switch', {
      method: 'POST',
      body: { householdId: 'h2' },
    });
    expect(getSession().householdId).toBe('h2');
  });
});
```

Add `listHouseholds, createHousehold, switchHousehold` to the file's auth import and `getSession` if not already imported (it is).

- [ ] **Step 4: Run and commit**

Run: `npm test -- api-auth` → existing + 3 passing. `npm test` → 448. `npx tsc --noEmit` → clean.

```bash
git add lib/api/types.ts lib/api/auth.ts __tests__/api-auth.test.ts
git commit -m "feat: add households list, create and switch API calls"
```

---

### Task 2: Account-section switcher + leave copy corrections + account strings

**Files:**
- Modify: `frontend/components/settings/AccountSection.tsx`, `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`
- Test: `frontend/__tests__/account-section.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 1's three functions + DTO; existing `ApiError`/`NetworkError` mapping pattern; `t()`.
- Produces: no new exports — UI only.

- [ ] **Step 1: Add the i18n keys (both files)**

`en.json`, inside `account`: add
```json
"householdsTitle": "Your households",
"activeBadge": "Active",
"memberCount": "%{count} members",
"createTitle": "New household",
"createPlaceholder": "Household name",
"createButton": "Create",
```
replace `leaveConfirmBody` with `"You land in your oldest other household — or a fresh personal one if you have none. Nothing is deleted from this device."`, and inside `account.errors` add
```json
"leaveLastHousehold": "You can't leave your only household.",
"createInvalid": "Give the household a name."
```

`nb.json`, same keys:
```json
"householdsTitle": "Dine husholdninger",
"activeBadge": "Aktiv",
"memberCount": "%{count} medlemmer",
"createTitle": "Ny husholdning",
"createPlaceholder": "Navn på husholdningen",
"createButton": "Opprett",
```
`leaveConfirmBody`: `"Du havner i din eldste andre husholdning — eller en ny personlig hvis du ikke har noen. Ingenting slettes fra denne enheten."`; errors: `"leaveLastHousehold": "Du kan ikke forlate din eneste husholdning."`, `"createInvalid": "Gi husholdningen et navn."`

- [ ] **Step 2: Extend `AccountSection.tsx`**

Imports: add `createHousehold, listHouseholds, switchHousehold` to the auth import and `HouseholdSummaryDto` to the types import.

Error mappers — after `joinErrorMessage`, add:

```ts
function leaveErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 409)
    return t('account.errors.leaveLastHousehold');
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}

function createErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 400)
    return t('account.errors.createInvalid');
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}

function genericErrorMessage(caught: unknown): string {
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}
```

State: add `const [households, setHouseholds] = useState<HouseholdSummaryDto[]>([]);` and `const [createName, setCreateName] = useState('');`.

Fetch: in the existing `useEffect`, alongside the `getHousehold()` fetch (same cancellation flag, same deps `[signedIn, session.householdId]`), add:

```ts
    listHouseholds()
      .then((result) => {
        if (!cancelled) setHouseholds(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(genericErrorMessage(caught));
      });
```
and reset `setHouseholds([])` in the signed-out branch beside `setHousehold(null)`.

Handlers — after `join`:

```ts
  const switchTo = (target: HouseholdSummaryDto) => {
    if (target.isActive) return;
    setError(null);
    switchHousehold(target.id).catch((caught) => setError(genericErrorMessage(caught)));
  };

  const create = async () => {
    const name = createName.trim();
    if (name === '') {
      setError(t('account.errors.createInvalid'));
      return;
    }
    setError(null);
    try {
      await createHousehold(name);
      setCreateName('');
    } catch (caught) {
      setError(createErrorMessage(caught));
    }
  };
```

`confirmLeave`: change the `leaveHousehold().catch(...)` mapper from `joinErrorMessage` to `leaveErrorMessage`.

UI — insert BETWEEN the sync-status row and the `{t('account.household')}` label:

```tsx
      <Text className="font-body text-sm text-ink">{t('account.householdsTitle')}</Text>
      <View className="mb-3 mt-1 gap-1">
        {households.map((item) => (
          <Pressable
            key={item.id}
            testID={`household-row-${item.id}`}
            accessibilityRole="button"
            disabled={item.isActive}
            onPress={() => switchTo(item)}
            className="flex-row items-center justify-between py-2">
            <View>
              <Text className="font-body-bold text-base text-ink">{item.name}</Text>
              <Text className="font-body text-xs text-ink opacity-70">
                {t('account.memberCount', { count: item.memberCount })}
              </Text>
            </View>
            {item.isActive ? (
              <Text className="font-body-bold text-xs text-clay">{t('account.activeBadge')}</Text>
            ) : null}
          </Pressable>
        ))}
      </View>

      <Text className="font-body text-sm text-ink">{t('account.createTitle')}</Text>
      <View className="mb-3 mt-1 flex-row items-center gap-2">
        <View className="flex-1">
          <Input
            testID="create-household-input"
            value={createName}
            onChangeText={setCreateName}
            placeholder={t('account.createPlaceholder')}
          />
        </View>
        <Button label={t('account.createButton')} onPress={create} />
      </View>
```

Everything else in the component (active-household detail, join, leave, sign-out, server field) stays.

- [ ] **Step 3: Extend `account-section.test.tsx`**

Extend the `../lib/api/auth` module mock with `listHouseholds: jest.fn()`, `createHousehold: jest.fn()`, `switchHousehold: jest.fn()`; add the typed mock consts. Fixture:

```ts
const summaries = [
  { id: 'household-1', name: 'Karis husstand', joinCode: 'ABC-DEF', memberCount: 2, role: 'owner', isActive: true },
  { id: 'household-2', name: 'Hytta', joinCode: 'GHI-JKL', memberCount: 1, role: 'member', isActive: false },
];
```
In `beforeEach`, default `listHouseholdsMock.mockResolvedValue(summaries)` beside the existing `getHouseholdMock` default. New cases (follow the file's `act`/`fireEvent` idioms):

```ts
  it('lists households with the active one marked and not pressable', async () => {
    // render signed in; await the effect
    // expect 'Karis husstand' and 'Hytta' on screen, 'Active' badge present once
    // fireEvent.press on household-row-household-1 → switchHouseholdMock NOT called
  });

  it('switches on pressing a non-active household', async () => {
    // press household-row-household-2 → switchHouseholdMock called with 'household-2'
  });

  it('creates a household with the trimmed name and clears the input', async () => {
    // type '  Hytta  ' into create-household-input, press 'Create'
    // createHouseholdMock called with 'Hytta'; input value back to ''
  });

  it('a blank create shows the validation message without calling the API', async () => {
    // press 'Create' with empty input → createHouseholdMock not called,
    // screen shows 'Give the household a name.'
  });

  it('a leave conflict shows the leave-specific message', async () => {
    // leaveHouseholdMock rejects with new ApiError-shaped 409 (construct via the
    // real ApiError from '../lib/api/client' — the component's instanceof must match)
    // trigger confirmLeave via the mocked Alert (file convention), await
    // expect "You can't leave your only household." on screen
  });
```
Write these fully, following how the existing tests render, resolve effects (`act`), press Alert buttons, and construct `ApiError` (the component imports the REAL `../lib/api/client` — check how existing tests make `joinHousehold` reject with a 404 and mirror it; if the file constructs errors via the real class, import it the same way).

- [ ] **Step 4: Run and commit**

Run: `npm test -- account-section i18n` → all passing (parity test covers the new keys). `npm test` → ~453 (448 + 5; report exact). `npx tsc --noEmit` → clean. `npm run lint` → no new issues.

```bash
git add components/settings/AccountSection.tsx lib/i18n/ __tests__/account-section.test.tsx
git commit -m "feat: household switcher in the account section"
```

---

### Task 3: Recipe copy — repo function, detail-screen action, detail strings, TESTING.md

**Files:**
- Modify: `frontend/lib/db/recipes.ts`, `frontend/app/recipe/[id]/index.tsx`, `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`, `docs/TESTING.md` (repo root, NOT under frontend/)
- Test: `frontend/__tests__/recipes-repository.test.ts`, `frontend/__tests__/recipe-detail.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 1's `listHouseholds` + `HouseholdSummaryDto`; `inHousehold`/`notDeleted`; `newId`; `useActiveHouseholdId` (already used by the screen).
- Produces: `copyRecipeToHousehold(db, householdId: string | null, targetHouseholdId: string, recipeId: string): string | null` from `lib/db/recipes.ts`.

- [ ] **Step 1: Add the i18n keys (both files)**

`en.json`, inside `detail`: add
```json
"copyToHousehold": "Copy to another household…",
"copyPickerTitle": "Copy to which household?",
"copyNoTargets": "You're only in one household.",
"copiedTo": "Copied to %{name}"
```
`nb.json`, inside `detail`:
```json
"copyToHousehold": "Kopier til en annen husholdning …",
"copyPickerTitle": "Kopier til hvilken husholdning?",
"copyNoTargets": "Du er bare i én husholdning.",
"copiedTo": "Kopiert til %{name}"
```

- [ ] **Step 2: Add `copyRecipeToHousehold` to `lib/db/recipes.ts`**

Extend the drizzle import with `asc` if absent (it is present) and the predicates import with `inHousehold` (present since slice ②). Append:

```ts
// Explicit cross-household copy (umbrella decision 5): a re-minted local
// duplicate — fresh ids for the recipe and every child — tagged for the
// target household, dirty. Returns the fresh id, or null when the source
// is not visible in the caller's partition (stale screen, tombstone).
// Deliberately NO scheduleSync(): the copy is out-of-partition for the
// current cycle and uploads when the target household is next active
// (the sync engine collects only the active household's dirty rows).
export function copyRecipeToHousehold(
  db: DB,
  householdId: string | null,
  targetHouseholdId: string,
  recipeId: string
): string | null {
  let freshId: string | null = null;
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    const source = txDb
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), notDeleted(recipes), inHousehold(recipes, householdId)))
      .get();
    if (!source) return;

    const now = Date.now();
    const id = newId();
    txDb
      .insert(recipes)
      .values({
        ...source,
        id,
        householdId: targetHouseholdId,
        createdAt: now,
        updatedAt: now,
        dirty: 1,
      })
      .run();
    const ingredients = txDb
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId))
      .orderBy(asc(recipeIngredients.sortOrder))
      .all();
    for (const child of ingredients) {
      txDb.insert(recipeIngredients).values({ ...child, id: newId(), recipeId: id }).run();
    }
    const instructions = txDb
      .select()
      .from(recipeInstructions)
      .where(eq(recipeInstructions.recipeId, recipeId))
      .orderBy(asc(recipeInstructions.sortOrder))
      .all();
    for (const child of instructions) {
      txDb.insert(recipeInstructions).values({ ...child, id: newId(), recipeId: id }).run();
    }
    freshId = id;
  });
  return freshId;
}
```

- [ ] **Step 3: Repo tests in `recipes-repository.test.ts`**

Follow the file's fixtures (`createRecipe` with ingredients/instructions). New describe:

```ts
describe('copyRecipeToHousehold', () => {
  it('re-mints the recipe and children into the target partition, dirty, source untouched', () => {
    const db = makeTestDb();
    const sourceId = createRecipe(db, 'h1', input); // file's standard input w/ children
    db.update(recipes).set({ dirty: 0 }).run();

    const copyId = copyRecipeToHousehold(db, 'h1', 'h2', sourceId);

    expect(copyId).not.toBeNull();
    expect(copyId).not.toBe(sourceId);
    const copy = getRecipe(db, 'h2', copyId!)!;
    expect(copy.recipe.householdId).toBe('h2');
    expect(copy.recipe.dirty).toBe(1);
    expect(copy.recipe.title).toBe(input.title);
    expect(copy.ingredients).toHaveLength(input.ingredients.length);
    expect(copy.ingredients.every((ing) => ing.recipeId === copyId)).toBe(true);
    const source = getRecipe(db, 'h1', sourceId)!;
    expect(source.recipe.dirty).toBe(0); // untouched
    expect(source.ingredients.map((ing) => ing.id)).not.toEqual(copy.ingredients.map((ing) => ing.id)); // fresh child ids
  });

  it('returns null for a source outside the caller partition', () => {
    const db = makeTestDb();
    const sourceId = createRecipe(db, 'h1', input);
    expect(copyRecipeToHousehold(db, 'h2', 'h3', sourceId)).toBeNull();
    expect(copyRecipeToHousehold(db, null, 'h3', sourceId)).toBeNull();
  });

  it('returns null for a tombstoned source', () => {
    const db = makeTestDb();
    const sourceId = createRecipe(db, 'h1', input);
    softDeleteRecipe(db, 'h1', sourceId);
    expect(copyRecipeToHousehold(db, 'h1', 'h2', sourceId)).toBeNull();
  });
});
```
Adapt fixture/`input` names to the file's; assertions mandated. If `getRecipe` typing needs the non-null id, guard accordingly.

- [ ] **Step 4: The detail-screen action**

In `app/recipe/[id]/index.tsx`:

Imports: `listHouseholds` from `../../../lib/api/auth`; `NetworkError` from `../../../lib/api/client`; add `copyRecipeToHousehold` to the `lib/db/recipes` import.

State (beside `listNotice`):

```ts
  const [copyFeedback, setCopyFeedback] = useState<
    { kind: 'copied'; name: string } | { kind: 'noTargets' } | { kind: 'error'; message: string } | null
  >(null);
```

Handler (after `confirmDelete`):

```ts
  const copyToHousehold = async () => {
    setCopyFeedback(null);
    try {
      const households = await listHouseholds();
      const targets = households.filter((target) => target.id !== householdId);
      if (targets.length === 0) {
        setCopyFeedback({ kind: 'noTargets' });
        return;
      }
      Alert.alert(t('detail.copyPickerTitle'), undefined, [
        ...targets.map((target) => ({
          text: target.name,
          onPress: () => {
            const copied = copyRecipeToHousehold(db, householdId, target.id, recipe.id);
            setCopyFeedback(
              copied
                ? { kind: 'copied' as const, name: target.name }
                : { kind: 'error' as const, message: t('account.errors.generic') }
            );
          },
        })),
        { text: t('detail.deleteCancel'), style: 'cancel' as const },
      ]);
    } catch (caught) {
      setCopyFeedback({
        kind: 'error',
        message:
          caught instanceof NetworkError
            ? t('account.errors.network')
            : t('account.errors.generic'),
      });
    }
  };
```

UI — after the notes block (before the ScrollView closes):

```tsx
        {copyFeedback?.kind === 'copied' ? (
          <View className="mt-8 rounded-card bg-sage px-4 py-3">
            <Text className="font-body text-sm text-cream">
              {t('detail.copiedTo', { name: copyFeedback.name })}
            </Text>
          </View>
        ) : null}
        {copyFeedback?.kind === 'noTargets' ? (
          <View className="mt-8 rounded-card bg-butter px-4 py-3">
            <Text className="font-body text-sm text-ink">{t('detail.copyNoTargets')}</Text>
          </View>
        ) : null}
        {copyFeedback?.kind === 'error' ? (
          <View className="mt-8 rounded-card bg-butter px-4 py-3">
            <Text className="font-body text-sm text-ink">{copyFeedback.message}</Text>
          </View>
        ) : null}
        <View className={copyFeedback ? 'mt-3' : 'mt-8'}>
          <Button
            label={t('detail.copyToHousehold')}
            variant="ghost"
            onPress={() => void copyToHousehold()}
          />
        </View>
```

- [ ] **Step 5: Detail-screen tests**

In `recipe-detail.test.tsx` (follow its existing mock rig — chain-stub db, mocked `useLiveQuery`, mocked `lib/db/recipes`/`lib/db/shoppingList`): extend the `lib/db/recipes` mock with `copyRecipeToHousehold: jest.fn(() => 'copy-1')`; mock `../lib/api/auth` with `listHouseholds: jest.fn()`; mock `lib/household` if the file pins a partition, else the real module's `null` default applies; spy on `Alert.alert`. New cases:

```ts
  it('copy with no other household shows the quiet notice', async () => {
    // listHouseholds resolves [ activeOnly ] where id === the screen's partition
    // press 'Copy to another household…'; await
    // expect "You're only in one household." on screen; Alert.alert NOT called
  });

  it('copy picker offers only other households and copies into the chosen one', async () => {
    // listHouseholds resolves [active, other]; press the copy button; await
    // Alert.alert called with copyPickerTitle and buttons: other.name + cancel (no active.name)
    // invoke the other-household button's onPress from the spy's args
    // copyRecipeToHousehold called with (db, <partition>, other.id, recipeId)
    // expect 'Copied to <other.name>' on screen
  });

  it('a failed household fetch shows the network message', async () => {
    // listHouseholds rejects with new NetworkError(...) (real class from ../lib/api/client)
    // press; await; expect 'Cannot reach the server.' on screen
  });
```
Write fully in the file's idioms (async press + `act`/`findByText`). The partition the screen uses must match what the test asserts in the `copyRecipeToHousehold` call — pin it explicitly by mocking `../lib/household` with `useActiveHouseholdId: () => 'h1'` and building fixtures around `'h1'`.

- [ ] **Step 6: Rewrite the TESTING.md interim note**

In `docs/TESTING.md` (repo root): REPLACE the line
```
- Interim note (until the app's multi-household slices land): joining or leaving a household FROM THE APP triggers the sync engine's adoption path, which COPIES your collection into the landing household (originals stay in the other household — nothing is lost, but leave-and-rejoin round trips accumulate duplicates). For trip-style switching, prefer the API switch endpoint for now; the app UI arrives in a later slice.
```
with:
```
- Multi-household (app UI): in Settings → Account, create a second household ("Hytta") — it becomes active and the tabs go empty (fresh partition). Add a recipe there; switch back via the household list — your original content is intact and re-syncs incrementally (watch: no full re-download, no duplicates, no re-upload wave). On a recipe, "Copy to another household…" → pick the other household → switch to it: the copy is there (fresh identity, original untouched) and syncs up on that household's next cycle. Leave flows: leaving a shared household lands you in your oldest other membership; with only one household, leave is refused with "You can't leave your only household." Switching back and forth NEVER moves or duplicates content — that machinery is gone.
```

- [ ] **Step 7: Run everything and commit**

Run: `npm test -- recipe-detail recipes-repository i18n` → green. `npm test` → ~459 (report exact). `npx tsc --noEmit` → clean. `npm run lint` → no new issues.

```bash
git add lib/db/recipes.ts app/recipe/ lib/i18n/ __tests__/recipes-repository.test.ts __tests__/recipe-detail.test.tsx ../docs/TESTING.md
git commit -m "feat: copy a recipe to another household"
```
