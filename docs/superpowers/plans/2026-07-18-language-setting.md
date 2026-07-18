# Language Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persisted Norsk / English / System language preference in the settings modal, applied instantly app-wide by remounting the navigation tree (accepted trade-off: navigation resets to Today and the modal closes).

**Architecture:** A `language` key in the settings table (repository mirrors `color_mode`). New `lib/locale.ts` owns application: resolves the mode to an effective locale, mutates the shared `i18n` instance, and bumps a version exposed through a `useLocaleVersion()` hook (`useSyncExternalStore`); the root layout keys its themed content `<View>` on that version. The settings screen gains a Language section using the existing `SegmentedControl`.

**Tech Stack:** Expo SDK 54, i18n-js + expo-localization, React 18 `useSyncExternalStore`, NativeWind, Jest + `@testing-library/react-native` v13 (incl. `renderHook`).

**Spec:** `docs/superpowers/specs/2026-07-18-language-setting-design.md`

## Global Constraints

- `LanguageMode = 'nb' | 'en' | 'system'`; default and unknown-stored-value fallback: `'system'`. No schema change.
- `'system'` resolves the device locale at apply time: `getLocales()[0]?.languageCode` starting with `nb` → `'nb'`, anything else (incl. missing) → `'en'`. Only `lib/locale.ts` mutates `i18n.locale` after startup.
- Every `applyLanguageMode` call bumps the version exactly once and notifies subscribers.
- The stored mode is applied in the root layout's existing migrations-ready effect, alongside the colour mode.
- `language` is device-local; nothing prepares it for sync (future sync must exclude it).
- Language names are untranslated: `languageNorwegian` = "Norsk" and `languageEnglish` = "English" in BOTH locale files; `language` = "Language"/"Språk"; `languageSystem` = "System"/"System" (key-parity test enforces presence).
- Test constraints: `@testing-library/react-native` v13 sync `render(...)`; out-of-scope vars in `jest.mock` factories must be `mock`-prefixed (post-import aliases fine); the two "System" labels (appearance + language) make `getByLabelText('System')` ambiguous — scope with `within(screen.getByTestId('appearance-section' | 'language-section'))`.
- Run all commands from `frontend/`. Zero lint warnings, clean `npx tsc --noEmit`, all tests green before every commit.

## File Structure

- Create: `lib/locale.ts`.
- Modify: `lib/db/settings.ts` (+`LanguageMode`, `getLanguageMode`, `setLanguageMode`), `app/settings.tsx` (Language section + section testIDs), `app/_layout.tsx` (startup apply + remount key), `lib/i18n/en.json`, `lib/i18n/nb.json`.
- Tests: extend `__tests__/settings-repository.test.ts` and `__tests__/settings-screen.test.tsx`; new `__tests__/locale.test.ts`.

---

### Task 1: LanguageMode repository functions

**Files:**
- Modify: `lib/db/settings.ts`
- Test: extend `__tests__/settings-repository.test.ts`

**Interfaces:**
- Consumes: existing `settings` table, `DB` type, the file's `color_mode` pattern.
- Produces (used by Tasks 2–4): `export type LanguageMode = 'nb' | 'en' | 'system'`; `getLanguageMode(db: DB): LanguageMode`; `setLanguageMode(db: DB, mode: LanguageMode): void`.

- [ ] **Step 0: Create the feature branch**

```bash
git checkout develop
git checkout -b feature/language-setting
```

- [ ] **Step 1: Write the failing tests**

In `__tests__/settings-repository.test.ts`, extend the settings-function import to include `getLanguageMode, setLanguageMode`, then append at the end of the file:

```ts
describe('language mode', () => {
  it('defaults to system when unset', () => {
    const db = makeTestDb();
    expect(getLanguageMode(db)).toBe('system');
  });

  it('persists and reads back nb and en', () => {
    const db = makeTestDb();
    setLanguageMode(db, 'nb');
    expect(getLanguageMode(db)).toBe('nb');
    setLanguageMode(db, 'en');
    expect(getLanguageMode(db)).toBe('en');
  });

  it('falls back to system on an unrecognized stored value', () => {
    const db = makeTestDb();
    setLanguageMode(db, 'nb');
    db.update(settings).set({ value: 'sv' }).where(eq(settings.key, 'language')).run();
    expect(getLanguageMode(db)).toBe('system');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- settings-repository`
Expected: FAIL — `getLanguageMode` is not exported; the 7 existing tests otherwise unaffected.

- [ ] **Step 3: Implement the repository functions**

In `lib/db/settings.ts`, after `setColorMode`, add:

```ts
export type LanguageMode = 'nb' | 'en' | 'system';

const LANGUAGE_KEY = 'language';

// Device-local preference — must be excluded if settings ever sync.
export function getLanguageMode(db: DB): LanguageMode {
  const row = db.select().from(settings).where(eq(settings.key, LANGUAGE_KEY)).get();
  const value = row?.value;
  return value === 'nb' || value === 'en' ? value : 'system';
}

export function setLanguageMode(db: DB, mode: LanguageMode): void {
  db.insert(settings)
    .values({ key: LANGUAGE_KEY, value: mode })
    .onConflictDoUpdate({ target: settings.key, set: { value: mode } })
    .run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- settings-repository`
Expected: PASS — 10 tests (7 existing + 3 new).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/db/settings.ts __tests__/settings-repository.test.ts
git commit -m "feat: add language mode repository functions"
```

---

### Task 2: locale application module

**Files:**
- Create: `lib/locale.ts`
- Test: `__tests__/locale.test.ts` (new)

**Interfaces:**
- Consumes: `LanguageMode` (Task 1); `i18n` instance and `currentLocale` from `lib/i18n`; `getLocales` from `expo-localization`.
- Produces (used by Tasks 3–4): `applyLanguageMode(mode: LanguageMode): void`; `useLocaleVersion(): number`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/locale.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';

import { currentLocale, i18n } from '../lib/i18n';
import { applyLanguageMode, useLocaleVersion } from '../lib/locale';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en' }]),
}));

const getLocalesMock = getLocales as jest.Mock;

describe('applyLanguageMode', () => {
  afterEach(() => {
    applyLanguageMode('en');
  });

  it('forces nb and en, and currentLocale agrees', () => {
    applyLanguageMode('nb');
    expect(i18n.locale).toBe('nb');
    expect(currentLocale()).toBe('nb');

    applyLanguageMode('en');
    expect(i18n.locale).toBe('en');
    expect(currentLocale()).toBe('en');
  });

  it('resolves system from the device locale, defaulting to en', () => {
    getLocalesMock.mockReturnValue([{ languageCode: 'nb' }]);
    applyLanguageMode('system');
    expect(i18n.locale).toBe('nb');

    getLocalesMock.mockReturnValue([{ languageCode: 'de' }]);
    applyLanguageMode('system');
    expect(i18n.locale).toBe('en');

    getLocalesMock.mockReturnValue([]);
    applyLanguageMode('system');
    expect(i18n.locale).toBe('en');
  });

  it('bumps the version observed by useLocaleVersion on every apply', () => {
    const { result } = renderHook(() => useLocaleVersion());
    const before = result.current;

    act(() => applyLanguageMode('nb'));
    expect(result.current).toBe(before + 1);

    act(() => applyLanguageMode('nb'));
    expect(result.current).toBe(before + 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- locale.test`
Expected: FAIL — `Cannot find module '../lib/locale'`.

- [ ] **Step 3: Implement lib/locale.ts**

Create `lib/locale.ts`:

```ts
import { getLocales } from 'expo-localization';
import { useSyncExternalStore } from 'react';

import type { LanguageMode } from './db/settings';
import { i18n } from './i18n';

// Owns post-startup language switching: resolves the stored mode to an
// effective locale, mutates the shared i18n instance, and bumps a version
// the root layout keys its content View on — remounting the tree so every
// screen re-renders in the new language. Only this module touches
// i18n.locale after lib/i18n's device-locale initialization.
let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return version;
}

function deviceLocale(): 'en' | 'nb' {
  return getLocales()[0]?.languageCode?.startsWith('nb') ? 'nb' : 'en';
}

export function applyLanguageMode(mode: LanguageMode): void {
  i18n.locale = mode === 'system' ? deviceLocale() : mode;
  version += 1;
  listeners.forEach((listener) => listener());
}

export function useLocaleVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- locale.test`
Expected: PASS — 3 tests.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/locale.ts __tests__/locale.test.ts
git commit -m "feat: add locale application module with remount version"
```

---

### Task 3: Language section in the settings screen

**Files:**
- Modify: `app/settings.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`
- Test: extend `__tests__/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `getLanguageMode`/`setLanguageMode`/`LanguageMode` (Task 1); `applyLanguageMode` (Task 2); existing `SegmentedControl`, `db`, `t`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the screen tests**

In `__tests__/settings-screen.test.tsx`:

1. Add `within` to the testing-library import:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react-native';
```

2. Add the locale mock alongside the colorMode mock:

```tsx
jest.mock('../lib/locale', () => ({
  applyLanguageMode: jest.fn(),
}));
```

with import and alias:

```tsx
import { applyLanguageMode } from '../lib/locale';
```

```tsx
const applyLanguageModeMock = applyLanguageMode as jest.Mock;
```

3. Extend the `../lib/db/settings` mock factory with:

```tsx
  getLanguageMode: jest.fn(() => 'system'),
  setLanguageMode: jest.fn(),
```

add `getLanguageMode, setLanguageMode` to the settings import, and aliases:

```tsx
const getLanguageModeMock = getLanguageMode as jest.Mock;
const setLanguageModeMock = setLanguageMode as jest.Mock;
```

In `beforeEach`, after the existing color-mode reset line, add:

```tsx
    getLanguageModeMock.mockReturnValue('system');
```

4. In the existing test `'renders the three modes with the stored one selected'`, the `getByLabelText('System')` assertion becomes ambiguous once the language section exists. Replace that single assertion with the scoped version:

```tsx
    expect(
      within(screen.getByTestId('appearance-section')).getByLabelText('System').props
        .accessibilityState
    ).toEqual(expect.objectContaining({ selected: false }));
```

5. Append two tests to the describe block:

```tsx
  it('renders the language options with the stored one selected', () => {
    getLanguageModeMock.mockReturnValue('nb');
    render(<SettingsScreen />);

    expect(screen.getByText('Language')).toBeOnTheScreen();
    expect(screen.getByLabelText('Norsk').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(screen.getByLabelText('English').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(
      within(screen.getByTestId('language-section')).getByLabelText('System').props
        .accessibilityState
    ).toEqual(expect.objectContaining({ selected: false }));
  });

  it('stores and applies a newly selected language', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Norsk'));

    expect(setLanguageModeMock).toHaveBeenCalledWith(expect.anything(), 'nb');
    expect(applyLanguageModeMock).toHaveBeenCalledWith('nb');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settings-screen`
Expected: FAIL — `getLanguageMode` missing from the real module (import error) or `Unable to find an element with text: Language`.

- [ ] **Step 3: Add the i18n keys**

In `lib/i18n/en.json`, inside `"settings"`, after `"modeSystem"`:

```json
    "modeSystem": "System",
    "language": "Language",
    "languageNorwegian": "Norsk",
    "languageEnglish": "English",
    "languageSystem": "System"
```

In `lib/i18n/nb.json`, same position:

```json
    "modeSystem": "System",
    "language": "Språk",
    "languageNorwegian": "Norsk",
    "languageEnglish": "English",
    "languageSystem": "System"
```

- [ ] **Step 4: Implement the Language section in app/settings.tsx**

1. Extend the imports:

```tsx
import {
  getColorMode,
  getLanguageMode,
  setColorMode,
  setLanguageMode,
  type ColorMode,
  type LanguageMode,
} from '../lib/db/settings';
import { applyLanguageMode } from '../lib/locale';
```

2. Inside `SettingsScreen`, after the colour-mode `select` function, add:

```tsx
  const [language, setLanguage] = useState<LanguageMode>(() => getLanguageMode(db));

  const selectLanguage = (next: LanguageMode) => {
    setLanguageMode(db, next);
    setLanguage(next);
    applyLanguageMode(next);
  };
```

3. Add `testID="appearance-section"` to the existing Appearance section `<View className="px-4 pt-2">`, and add the Language section directly after it (before the closing outer `</View>`):

```tsx
      <View testID="language-section" className="px-4 pt-6">
        <Text className="mb-2 font-body-bold text-sm text-ink">{t('settings.language')}</Text>
        <SegmentedControl<LanguageMode>
          segments={[
            { key: 'nb', label: t('settings.languageNorwegian') },
            { key: 'en', label: t('settings.languageEnglish') },
            { key: 'system', label: t('settings.languageSystem') },
          ]}
          selected={language}
          onSelect={selectLanguage}
        />
      </View>
```

(`setLanguage` runs before `applyLanguageMode` so the state update lands before the remount unmounts the screen.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- settings-screen && npm test -- i18n`
Expected: PASS — 5 settings-screen tests (3 existing + 2 new); i18n parity green.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add app/settings.tsx lib/i18n/en.json lib/i18n/nb.json __tests__/settings-screen.test.tsx
git commit -m "feat: add language section to settings"
```

---

### Task 4: Root layout wiring; final verification and manual checklist

**Files:**
- Modify: `app/_layout.tsx`, root `docs/TESTING.md` (append manual checklist)

**Interfaces:**
- Consumes: `applyLanguageMode`/`useLocaleVersion` (Task 2); `getLanguageMode` (Task 1); existing `db`.
- Produces: nothing — completes the feature.

- [ ] **Step 1: Wire startup apply and the remount key**

In `app/_layout.tsx`:

1. Add the import (after the `cssVars` theme import):

```tsx
import { applyLanguageMode, useLocaleVersion } from '../lib/locale';
```

and add `getLanguageMode` to the existing `../lib/db/settings` import.

2. Extend the migrations-ready effect:

```tsx
  useEffect(() => {
    if (state === 'ready') {
      applyColorMode(getColorMode(db));
      applyLanguageMode(getLanguageMode(db));
    }
  }, [state]);
```

3. After the `const palette = usePalette();` line, add:

```tsx
  const localeVersion = useLocaleVersion();
```

4. Key the themed content View in the main return (the one wrapping `<Stack>`):

```tsx
      <View key={localeVersion} style={themeVars} className="flex-1">
```

(The error/loading branches keep their unkeyed Views.)

- [ ] **Step 2: Full automated pass**

Run from `frontend/`:

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
```

Expected: all green (228 pre-slice tests plus the 8 new — report the actual total), zero lint warnings, bundle exports. Fix anything that isn't before proceeding.

- [ ] **Step 3: Append the manual checklist to docs/TESTING.md**

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Language setting (manual pass)

- Settings → Language/Språk: choosing Norsk switches the whole app instantly — the modal closes and Today renders in Norwegian. English likewise.
- Quantity formatting follows: the same ingredient shows 0,5 under Norsk and 0.5 under English.
- System: the app follows the device language; with System selected, changing the device language switches the app (relaunch OK).
- The choice persists across kill & relaunch.
- The colour-mode setting still works after a language switch, and its labels translate (Lys/Mørk under Norsk).
```

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx ../docs/TESTING.md
git commit -m "feat: apply stored language and remount on switch"
```

---

## Self-Review Notes

- **Spec coverage:** repository key + fallback (T1 ↔ decision 1), locale module with system resolution, version store, single-mutator rule (T2 ↔ decision 2), settings UI with untranslated language names (T3 ↔ decision 5), startup apply + remount key (T4 ↔ decisions 3–4), `currentLocale()` agreement asserted (T2 test ↔ decision 6), i18n keys per spec, checklist covers the manual-only remount wiring.
- **Known judgment calls:** `locale.test.ts` mocks `expo-localization` at the file level, which also feeds `lib/i18n`'s startup initialization within that test file's module registry — harmless (the mock's default `en` matches the test-env default, and each Jest file has an isolated registry). The `afterEach(applyLanguageMode('en'))` keeps `i18n.locale` deterministic within the file. Startup double-render: the migrations-ready effect bumps the version once at launch, remounting a tree the user has barely seen — accepted in spec decision 4. The settings screen keeps `useState` for the selected language even though the remount closes the modal — consistent with the appearance section and harmless.
- **Type consistency check:** `LanguageMode` exported from `lib/db/settings` (T1), imported type-only by `lib/locale.ts` (T2) and by value-position generics in `app/settings.tsx` (T3); `applyLanguageMode(mode: LanguageMode)` matches call sites in T3/T4; `useLocaleVersion(): number` used as a React key (number is a valid key); `SegmentedControl<LanguageMode>` satisfies `Segment<K extends string>[]`; the screen-test mock factory returns only literals (no out-of-scope vars), and all aliases are derived post-import.
