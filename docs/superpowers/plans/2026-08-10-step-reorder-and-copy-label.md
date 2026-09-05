# Step Reordering + Copy-Button Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let recipe authors reorder instruction steps by holding and dragging a step row, and drop the trailing ellipsis from the copy-to-household button.

**Architecture:** The step list in `RecipeForm` becomes a `Sortable.Grid` (from `react-native-sortables`) with one column, living inside the form's ScrollView (converted to reanimated's `Animated.ScrollView` so the grid can auto-scroll while dragging). Drag activates only from an invisible handle region around the step number (`customHandle` + `Sortable.Handle`), so the multiline text input keeps fully native editing behavior. On drop, `onDragEnd` returns the reordered array, which is committed to form state via the existing `patch` helper. Instructions already persist as an ordered array — no backend/db changes.

**Tech Stack:** Expo (SDK 54, Expo Go distribution), React Native, react-native-sortables (new dep), react-native-reanimated ~4.1 + react-native-gesture-handler ~2.28 (already installed), NativeWind classes, Jest + jest-expo + @testing-library/react-native.

## Global Constraints

- Bilingual app: every user-facing string changes in BOTH `frontend/lib/i18n/nb.json` and `frontend/lib/i18n/en.json`.
- Beta runs in **Expo Go** — no native modules beyond what Expo Go bundles. `react-native-sortables` is pure JS on top of reanimated/gesture-handler (both bundled in Expo Go), so it qualifies.
- **No visible drag affordance**: no handle icon, no hint text. The drag handle region is the existing step number plus invisible padding (user decision).
- Long-press **inside the step text input** must keep native text behavior (focus, cursor, selection).
- All Jest commands run from `frontend/` (`npx jest ...`).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Remove ellipsis from copy-to-household button label

**Files:**
- Modify: `frontend/lib/i18n/nb.json:58` (key `detail.copyToHousehold`)
- Modify: `frontend/lib/i18n/en.json:58` (key `detail.copyToHousehold`)

**Interfaces:**
- Consumes: nothing.
- Produces: unchanged key `detail.copyToHousehold`; only the string values change. No test asserts these strings today, and the button is rendered from the key in `frontend/app/recipe/[id]/index.tsx`, so no code changes.

- [ ] **Step 1: Edit both i18n files**

In `frontend/lib/i18n/nb.json`, change (note the leading space before `…`):

```json
"copyToHousehold": "Kopier til en annen husholdning …",
```

to

```json
"copyToHousehold": "Kopier til en annen husholdning",
```

In `frontend/lib/i18n/en.json`, change:

```json
"copyToHousehold": "Copy to another household…",
```

to

```json
"copyToHousehold": "Copy to another household",
```

- [ ] **Step 2: Run the i18n and recipe-detail tests**

Run: `npx jest __tests__/i18n.test.ts __tests__/recipe-detail.test.tsx`
Expected: PASS (the i18n test suite checks key parity between languages, which is unchanged; no test asserts the old string).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/i18n/nb.json frontend/lib/i18n/en.json
git commit -m "fix: drop trailing ellipsis from copy-to-household button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Install react-native-sortables and add GestureHandlerRootView at the app root

**Files:**
- Modify: `frontend/package.json` (+ lockfile, via npm install)
- Modify: `frontend/app/_layout.tsx:105-142` (final return block)

**Interfaces:**
- Consumes: nothing.
- Produces: `react-native-sortables` available for import; the app tree is wrapped in `GestureHandlerRootView`, which gesture-handler requires for any gesture (sortables' drags) to work. Task 3 depends on both.

- [ ] **Step 1: Install the library**

```bash
cd frontend && npm install react-native-sortables
```

Expected: installs cleanly with no peer-dependency errors against reanimated ~4.1.1 / gesture-handler ~2.28.0 (the library supports reanimated 3.x–4.x and gesture-handler 2.x–3.x).

- [ ] **Step 2: Wrap the root layout in GestureHandlerRootView**

In `frontend/app/_layout.tsx`, add the import (alphabetical position among the other `react-native-*` imports):

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
```

Then wrap the final return of `RootLayout` (the one returning `<SafeAreaProvider>`, currently lines 105–142) so it reads:

```tsx
return (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      {/* ...existing content unchanged... */}
    </SafeAreaProvider>
  </GestureHandlerRootView>
);
```

The `state === 'error'` and `pending` early returns stay as they are (no gestures on those screens).

- [ ] **Step 3: Run the full test suite**

Run: `npx jest`
Expected: PASS. No test renders `app/_layout.tsx` today, so nothing should touch the new import. **If** any suite fails with a transform/syntax error pointing into `node_modules/react-native-gesture-handler`, add `react-native-gesture-handler` to the `transformIgnorePatterns` alternation in `frontend/jest.config.js` (inside the existing `(?!(...))` group, e.g. `...|expo-constants|react-native-gesture-handler)/`) and re-run.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/app/_layout.tsx frontend/jest.config.js
git commit -m "feat: add react-native-sortables and gesture-handler root

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Leave `jest.config.js` out of the `git add` if Step 3 didn't touch it.)

---

### Task 3: Hold-to-drag reordering of instruction steps in RecipeForm

**Files:**
- Create: `frontend/__mocks__/react-native-sortables.tsx` (Jest auto-mock — lives adjacent to `node_modules`, applied automatically to every suite)
- Modify: `frontend/jest.setup.js` (reanimated mock)
- Modify: `frontend/components/RecipeForm.tsx` (imports, scroll ref, instructions block at lines 326–363)
- Test: `frontend/__tests__/recipe-form.test.tsx`

**Interfaces:**
- Consumes: `react-native-sortables` default export `Sortable` with `Sortable.Grid` (props used: `data`, `renderItem`, `customHandle`, `scrollableRef`, `rowGap`, `onDragEnd`; `onDragEnd` receives `{ data, fromIndex, toIndex, ... }` where `data` is the array in the new order), `Sortable.Handle` (wrapper that makes its children the drag handle when `customHandle` is set); `useAnimatedRef` + `Animated.ScrollView` from `react-native-reanimated`; existing `patch` helper and `InstructionDraft = { key: string; text: string }` from `frontend/lib/form.ts`.
- Produces: the test mock exposes `__getLastGridProps()` returning the props of the most recently rendered `Sortable.Grid` (used by tests to simulate drops; retrieve it via `jest.requireMock('react-native-sortables')`).

- [ ] **Step 1: Add the Jest mocks**

Create `frontend/__mocks__/react-native-sortables.tsx`:

```tsx
import React from 'react';
import { View } from 'react-native';

let lastGridProps: any = null;

export function __getLastGridProps() {
  return lastGridProps;
}

function Grid(props: any) {
  lastGridProps = props;
  return (
    <View>
      {props.data.map((item: any, index: number) => (
        <View key={item.key ?? item.id ?? String(index)}>{props.renderItem({ item, index })}</View>
      ))}
    </View>
  );
}

function Handle({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export default { Grid, Handle };
```

Append to `frontend/jest.setup.js` (reanimated's real module can't load under Node; this provides the two things `RecipeForm` imports):

```js
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: {
      ScrollView: RN.ScrollView,
      View: RN.View,
      createAnimatedComponent: (component) => component,
    },
    useAnimatedRef: () => ({ current: null }),
  };
});
```

- [ ] **Step 2: Write the failing tests**

Add to `frontend/__tests__/recipe-form.test.tsx`. Extend the testing-library import at the top of the file to include `act`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react-native';
```

Then add inside the `describe('RecipeForm', ...)` block:

```tsx
function threeStepState(): RecipeFormState {
  return {
    title: 'Soup',
    description: '',
    servings: 4,
    notes: '',
    ingredients: [],
    instructions: [
      { key: 's1', text: 'Chop the onions' },
      { key: 's2', text: 'Boil the stock' },
      { key: 's3', text: 'Serve hot' },
    ],
  };
}

it('saves instructions in the new order after a drag ends', () => {
  const { __getLastGridProps } = jest.requireMock('react-native-sortables') as any;
  const onSave = jest.fn();
  const initial = threeStepState();
  render(<RecipeForm heading="Edit" initialState={initial} onSave={onSave} />);

  const grid = __getLastGridProps();
  act(() => {
    grid.onDragEnd({
      data: [initial.instructions[1], initial.instructions[0], initial.instructions[2]],
      fromIndex: 1,
      toIndex: 0,
    });
  });

  fireEvent.press(screen.getByRole('button', { name: t('form.save') }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      instructions: [
        expect.objectContaining({ key: 's2', text: 'Boil the stock' }),
        expect.objectContaining({ key: 's1', text: 'Chop the onions' }),
        expect.objectContaining({ key: 's3', text: 'Serve hot' }),
      ],
    })
  );
});

it('renumbers steps from their current order after a reorder', () => {
  const { __getLastGridProps } = jest.requireMock('react-native-sortables') as any;
  const initial = threeStepState();
  render(<RecipeForm heading="Edit" initialState={initial} onSave={jest.fn()} />);

  act(() => {
    __getLastGridProps().onDragEnd({
      data: [initial.instructions[2], initial.instructions[0], initial.instructions[1]],
      fromIndex: 2,
      toIndex: 0,
    });
  });

  // Each step number appears exactly once — numbers follow position, not identity.
  expect(screen.getAllByText('1')).toHaveLength(1);
  expect(screen.getAllByText('2')).toHaveLength(1);
  expect(screen.getAllByText('3')).toHaveLength(1);
  // The moved step's text is still editable content in the form.
  expect(screen.getByDisplayValue('Serve hot')).toBeTruthy();
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx jest __tests__/recipe-form.test.tsx`
Expected: the two new tests FAIL — `__getLastGridProps()` returns `null` because `RecipeForm` doesn't render `Sortable.Grid` yet (`grid.onDragEnd` throws on null). Pre-existing tests in the file must still PASS.

- [ ] **Step 4: Implement the sortable step list in RecipeForm**

All edits in `frontend/components/RecipeForm.tsx`.

Add imports (after the existing `react-native` import, before `react-native-safe-area-context`):

```tsx
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';
```

Inside the `RecipeForm` component body, next to the other hooks (after `const palette = usePalette();`):

```tsx
const scrollRef = useAnimatedRef<Animated.ScrollView>();
```

Convert the form's `<ScrollView ...>` (currently line 199) to reanimated's animated ScrollView with the ref — props are otherwise unchanged:

```tsx
<Animated.ScrollView
  ref={scrollRef}
  className="flex-1 px-4"
  contentContainerStyle={{ paddingBottom: insets.bottom + 32, gap: 16 }}
  keyboardShouldPersistTaps="handled">
```

(and the matching closing tag `</Animated.ScrollView>`). Keep the plain `ScrollView` import from `react-native` — the horizontal unit picker still uses it.

Replace the instructions map (currently lines 328–354, the `{state.instructions.map((step, index) => ( ... ))}` block) with:

```tsx
<Sortable.Grid
  data={state.instructions}
  customHandle
  scrollableRef={scrollRef}
  rowGap={12}
  onDragEnd={({ data }) => patch({ instructions: [...data] })}
  renderItem={({ item }) => {
    const index = state.instructions.findIndex((s) => s.key === item.key);
    return (
      <View className="flex-row items-start gap-3">
        <Sortable.Handle>
          <View className="min-h-14 w-8 items-center pt-3">
            <Text className="font-display text-xl text-clay">{index + 1}</Text>
          </View>
        </Sortable.Handle>
        <Input
          value={item.text}
          onChangeText={(text) =>
            patch({
              instructions: state.instructions.map((s) =>
                s.key === item.key ? { ...s, text } : s
              ),
            })
          }
          placeholder={t('form.stepPlaceholder')}
          multiline
          className="flex-1"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('form.removeRow')}
          onPress={() =>
            patch({ instructions: state.instructions.filter((s) => s.key !== item.key) })
          }
          className="h-14 w-10 items-center justify-center">
          <Ionicons name="close" size={20} color={palette.ink} />
        </Pressable>
      </View>
    );
  }}
/>
```

Notes for the implementer:

- The handle is the step number wrapped in an invisible `min-h-14 w-8` touch zone — no icon, per the spec. `customHandle` means drags start ONLY there, so the `Input` and the delete `Pressable` keep their normal touch behavior (that's why the delete button stays a plain `Pressable`).
- The surrounding `<View className="gap-3">` with the `instructionsLabel` heading and the trailing "+ add step" `Pressable` stay exactly as they are; the grid replaces only the `.map(...)` block. The outer `gap-3` still separates label / grid / add-button; `rowGap={12}` reproduces the old 12px between rows.
- `keyExtractor` is not needed: the library defaults to the item's `key` property, which `InstructionDraft` has.
- `onDragEnd`'s `data` is spread into a fresh array before `patch` in case the library hands back a readonly/frozen array.
- The step number derives from `findIndex` on the live state (not a `renderItem` index argument) so numbering is correct regardless of the library's render-prop shape; n is small, O(n²) is irrelevant.
- If TypeScript rejects the `renderItem` inline function, type it explicitly: `renderItem={({ item }: { item: InstructionDraft }) => ...}` and add `InstructionDraft` to the existing `../lib/form` import.

- [ ] **Step 5: Run the RecipeForm tests to verify they pass**

Run: `npx jest __tests__/recipe-form.test.tsx`
Expected: PASS — both new tests and all pre-existing ones (the reanimated mock's `ScrollView` keeps the `KeyboardAvoidingView`/scroll assertions working).

- [ ] **Step 6: Run the full suite**

Run: `npx jest`
Expected: PASS. `recipe-edit.test.tsx` and `recipe-import.test.tsx` also render `RecipeForm`; the auto-mock in `frontend/__mocks__/` covers them without per-file changes. If a suite fails with a transform error inside `node_modules/react-native-sortables` or `node_modules/react-native-reanimated`, something imported the real module — check that the mock file name matches the package name exactly and that `jest.setup.js` was edited, rather than adding transform patterns.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/RecipeForm.tsx frontend/__tests__/recipe-form.test.tsx frontend/__mocks__/react-native-sortables.tsx frontend/jest.setup.js
git commit -m "feat: hold-to-drag reordering of recipe instruction steps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Emulator verification (manual, screenshots)

**Files:** none (verification only; screenshots go to `screenshots/`, which is untracked).

**Interfaces:**
- Consumes: the running app with Tasks 1–3 merged into the working tree.
- Produces: screenshot evidence that dragging works in Expo Go and text editing is intact. This is the spec's gate for the library choice — if dragging fails here, STOP and report back to the user (the fallback decision is theirs, per the spec).

- [ ] **Step 1: Boot the app in the emulator**

Known-good recipe (from project memory, `emulator-theme-screenshot-workflow`):

```bash
adb devices                      # expect emulator-5554 (Pixel_API_35, 1080x2400)
adb reverse tcp:8081 tcp:8081
fuser -k 8081/tcp                # kill any old Metro (lsof not installed)
cd frontend && npx expo start -c # run in background
adb shell am force-stop host.exp.exponent
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
# first deep link after -c often stalls: wait ~10s, fire the same deep link again, wait ~25s
adb exec-out screencap -p > ../screenshots/reorder-boot.png   # verify app is up before tapping
```

- [ ] **Step 2: Open a recipe editor with at least 3 steps**

Navigate by screencap-then-tap (verify each screenshot before tapping; coordinates below are for 1080×2400): Recipes tab is at `adb shell input tap 674 2285`. Open any seeded recipe with ≥3 steps and enter its edit screen, or create a new recipe and add three steps ("Chop", "Boil", "Serve") via the on-screen form. Determine remaining tap coordinates from the screenshots as you go.

- [ ] **Step 3: Exercise the drag and capture evidence**

The drag handle is the step-number column at the left edge of each step row. Read the number column's x/y from a screenshot, then long-press-and-drag step 1 down past step 2:

```bash
adb shell input draganddrop <x> <y1> <x> <y2> 1200 || {
  adb shell input motionevent DOWN <x> <y1>; sleep 0.4;
  adb shell input motionevent MOVE <x> <yMid>; adb shell input motionevent MOVE <x> <y2>;
  adb shell input motionevent UP <x> <y2>;
}
adb exec-out screencap -p > ../screenshots/reorder-after-drag.png
```

Verify in the screenshot: the two steps swapped and the numbers still read 1, 2, 3 top-to-bottom.

- [ ] **Step 4: Verify text editing is untouched**

Tap inside a step's text field → keyboard opens, cursor lands (screenshot `reorder-input-focus.png`). Long-press a word inside the field → native selection handles appear, NO drag starts (screenshot `reorder-input-selection.png`). Tap the ✕ on a step → the step is removed. Save the recipe, reopen it, and confirm the new step order persisted (screenshot `reorder-persisted.png`).

- [ ] **Step 5: Verify the label fix**

On a recipe's detail screen, screenshot the "Kopier til en annen husholdning" button — no trailing `…` (`copy-label.png`).

- [ ] **Step 6: Report**

Summarize results with the screenshots. If drag activation, auto-scroll, or Expo Go compatibility failed in any way, report the exact symptom and STOP — do not switch libraries or approaches without the user (spec: the fallback decision returns to the user).
