# Colour Mode Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persisted Light / Dark / System appearance preference, applied app-wide via React Native's `Appearance.setColorScheme()` override, housed in the app's first (minimal) settings modal reached from a gear icon on the Today tab header.

**Architecture:** A `color_mode` key in the existing `settings` table (repository functions mirror the `unit_system` pattern). A tiny `lib/colorMode.ts` owns the mode→scheme mapping (`'system'` → `null`). The root layout applies the stored mode once migrations are ready; the new `app/settings.tsx` modal writes the DB and applies the override live. No theme-infrastructure code changes — `usePalette` and the `vars()` injection already listen to the scheme.

**Tech Stack:** Expo SDK 54, drizzle-orm + expo-sqlite (better-sqlite3 in tests), NativeWind, Jest + `@testing-library/react-native` v13.

**Spec:** `docs/superpowers/specs/2026-07-17-color-mode-setting-design.md`

## Global Constraints

- `ColorMode = 'light' | 'dark' | 'system'`; default and unknown-stored-value fallback: `'system'`. No schema change.
- `'system'` maps to `Appearance.setColorScheme(null)`; `'light'`/`'dark'` pass through. Only `lib/colorMode.ts` performs this mapping.
- The stored mode is applied when migration state becomes `ready`, before the main `Stack` renders.
- `color_mode` is device-local; nothing in this feature prepares it for sync (and future sync must exclude it).
- New strings in BOTH `lib/i18n/en.json` and `lib/i18n/nb.json` (key-parity test enforces it).
- Test constraints: `@testing-library/react-native` v13 sync `render(...)`; out-of-scope vars referenced inside `jest.mock` factories must be `mock`-prefixed (`jest.fn()` inside factories is fine).
- Run all commands from `frontend/`. Zero lint warnings, clean `npx tsc --noEmit`, all tests green before every commit.

## File Structure

- Create: `lib/colorMode.ts` (mode→scheme mapping), `app/settings.tsx` (settings modal).
- Modify: `lib/db/settings.ts` (+`ColorMode`, `getColorMode`, `setColorMode`), `app/_layout.tsx` (apply on ready + route registration), `app/(tabs)/_layout.tsx` (gear icon), `lib/i18n/en.json`, `lib/i18n/nb.json`.
- Tests: extend `__tests__/settings-repository.test.ts`; new `__tests__/color-mode.test.ts`, `__tests__/settings-screen.test.tsx`.

---

### Task 1: ColorMode repository functions

**Files:**
- Modify: `lib/db/settings.ts`
- Test: extend `__tests__/settings-repository.test.ts`

**Interfaces:**
- Consumes: existing `settings` table, `DB` type, and the file's `unit_system` pattern.
- Produces (used by Tasks 2–4): `export type ColorMode = 'light' | 'dark' | 'system'`; `getColorMode(db: DB): ColorMode`; `setColorMode(db: DB, mode: ColorMode): void`.

- [ ] **Step 0: Create the feature branch**

```bash
git checkout develop
git checkout -b feature/color-mode-setting
```

(Working tree must be clean; the repo may be parked on a `design/*` branch from theme testing.)

- [ ] **Step 1: Write the failing tests**

In `__tests__/settings-repository.test.ts`, extend the settings import:

```ts
import { getColorMode, getUnitSystem, setColorMode, setUnitSystem } from '../lib/db/settings';
```

Append at the end of the file:

```ts
describe('color mode', () => {
  it('defaults to system when unset', () => {
    const db = makeTestDb();
    expect(getColorMode(db)).toBe('system');
  });

  it('persists and reads back light and dark', () => {
    const db = makeTestDb();
    setColorMode(db, 'light');
    expect(getColorMode(db)).toBe('light');
    setColorMode(db, 'dark');
    expect(getColorMode(db)).toBe('dark');
  });

  it('falls back to system on an unrecognized stored value', () => {
    const db = makeTestDb();
    setColorMode(db, 'dark');
    db.update(settings).set({ value: 'midnight' }).where(eq(settings.key, 'color_mode')).run();
    expect(getColorMode(db)).toBe('system');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- settings-repository`
Expected: FAIL — `getColorMode` is not exported (TS/import error); the four existing tests are otherwise unaffected.

- [ ] **Step 3: Implement the repository functions**

In `lib/db/settings.ts`, after the `setUnitSystem` function, add:

```ts
export type ColorMode = 'light' | 'dark' | 'system';

const COLOR_MODE_KEY = 'color_mode';

// Device-local preference — must be excluded if settings ever sync.
export function getColorMode(db: DB): ColorMode {
  const row = db.select().from(settings).where(eq(settings.key, COLOR_MODE_KEY)).get();
  const value = row?.value;
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function setColorMode(db: DB, mode: ColorMode): void {
  db.insert(settings)
    .values({ key: COLOR_MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: settings.key, set: { value: mode } })
    .run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- settings-repository`
Expected: PASS — 7 tests (4 existing + 3 new).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/db/settings.ts __tests__/settings-repository.test.ts
git commit -m "feat: add color mode repository functions"
```

---

### Task 2: applyColorMode mapping

**Files:**
- Create: `lib/colorMode.ts`
- Test: `__tests__/color-mode.test.ts` (new)

**Interfaces:**
- Consumes: `ColorMode` from `lib/db/settings` (Task 1); `Appearance` from `react-native`.
- Produces (used by Tasks 3–4): `applyColorMode(mode: ColorMode): void`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/color-mode.test.ts`:

```ts
import { Appearance } from 'react-native';

import { applyColorMode } from '../lib/colorMode';

describe('applyColorMode', () => {
  it('forces light and dark, and clears the override for system', () => {
    const spy = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});

    applyColorMode('light');
    expect(spy).toHaveBeenLastCalledWith('light');
    applyColorMode('dark');
    expect(spy).toHaveBeenLastCalledWith('dark');
    applyColorMode('system');
    expect(spy).toHaveBeenLastCalledWith(null);

    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- color-mode`
Expected: FAIL — `Cannot find module '../lib/colorMode'`.

- [ ] **Step 3: Implement lib/colorMode.ts**

Create `lib/colorMode.ts`:

```ts
import { Appearance } from 'react-native';

import type { ColorMode } from './db/settings';

// One place owns the mode→scheme mapping: 'system' clears the override so
// the OS scheme flows through; 'light'/'dark' force it app-wide. Everything
// downstream (useColorScheme, usePalette, the root vars() injection)
// already listens to the resulting scheme.
export function applyColorMode(mode: ColorMode): void {
  Appearance.setColorScheme(mode === 'system' ? null : mode);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- color-mode`
Expected: PASS — 1 test.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/colorMode.ts __tests__/color-mode.test.ts
git commit -m "feat: add applyColorMode scheme override"
```

---

### Task 3: Settings modal screen

**Files:**
- Create: `app/settings.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/nb.json`
- Test: `__tests__/settings-screen.test.tsx` (new)

**Interfaces:**
- Consumes: `getColorMode`/`setColorMode`/`ColorMode` (Task 1); `applyColorMode` (Task 2); `SegmentedControl` from `components/ui/SegmentedControl` (generic over the key type); `usePalette` from `lib/usePalette`; `db` from `lib/db/client`; `t` from `lib/i18n`.
- Produces: the default-exported `SettingsScreen`, registered as a route in Task 4.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/settings-screen.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

import SettingsScreen from '../app/settings';
import { applyColorMode } from '../lib/colorMode';
import { getColorMode, setColorMode } from '../lib/db/settings';

jest.mock('../lib/db/client', () => ({ db: {} }));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../lib/colorMode', () => ({
  applyColorMode: jest.fn(),
}));

jest.mock('../lib/db/settings', () => ({
  getColorMode: jest.fn(() => 'system'),
  setColorMode: jest.fn(),
}));

const getColorModeMock = getColorMode as jest.Mock;
const setColorModeMock = setColorMode as jest.Mock;
const applyColorModeMock = applyColorMode as jest.Mock;
const backMock = router.back as jest.Mock;

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getColorModeMock.mockReturnValue('system');
  });

  it('renders the three modes with the stored one selected', () => {
    getColorModeMock.mockReturnValue('dark');
    render(<SettingsScreen />);

    expect(screen.getByText('Appearance')).toBeOnTheScreen();
    expect(screen.getByLabelText('Dark').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(screen.getByLabelText('System').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
  });

  it('stores and applies a newly selected mode', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Light'));

    expect(setColorModeMock).toHaveBeenCalledWith(expect.anything(), 'light');
    expect(applyColorModeMock).toHaveBeenCalledWith('light');
    expect(screen.getByLabelText('Light').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
  });

  it('closes via the header button', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByLabelText('Close settings'));

    expect(backMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settings-screen`
Expected: FAIL — `Cannot find module '../app/settings'`.

- [ ] **Step 3: Add the i18n keys**

In `lib/i18n/en.json`, add a top-level `"settings"` section (after `"startup"`):

```json
  "settings": {
    "title": "Settings",
    "open": "Open settings",
    "close": "Close settings",
    "appearance": "Appearance",
    "modeLight": "Light",
    "modeDark": "Dark",
    "modeSystem": "System"
  },
```

In `lib/i18n/nb.json`, same position:

```json
  "settings": {
    "title": "Innstillinger",
    "open": "Åpne innstillinger",
    "close": "Lukk innstillinger",
    "appearance": "Utseende",
    "modeLight": "Lys",
    "modeDark": "Mørk",
    "modeSystem": "System"
  },
```

- [ ] **Step 4: Implement app/settings.tsx**

Create `app/settings.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedControl } from '../components/ui/SegmentedControl';
import { applyColorMode } from '../lib/colorMode';
import { db } from '../lib/db/client';
import { getColorMode, setColorMode, type ColorMode } from '../lib/db/settings';
import { t } from '../lib/i18n';
import { usePalette } from '../lib/usePalette';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const [mode, setMode] = useState<ColorMode>(() => getColorMode(db));

  const select = (next: ColorMode) => {
    setColorMode(db, next);
    applyColorMode(next);
    setMode(next);
  };

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="font-display text-xl text-ink">{t('settings.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.close')}
          onPress={() => router.back()}
          className="h-14 w-10 items-center justify-center">
          <Ionicons name="close" size={24} color={palette.ink} />
        </Pressable>
      </View>
      <View className="px-4 pt-2">
        <Text className="mb-2 font-body-bold text-sm text-ink">{t('settings.appearance')}</Text>
        <SegmentedControl<ColorMode>
          segments={[
            { key: 'light', label: t('settings.modeLight') },
            { key: 'dark', label: t('settings.modeDark') },
            { key: 'system', label: t('settings.modeSystem') },
          ]}
          selected={mode}
          onSelect={select}
        />
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- settings-screen && npm test -- i18n`
Expected: PASS — 3 settings-screen tests; i18n parity green.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add app/settings.tsx lib/i18n/en.json lib/i18n/nb.json __tests__/settings-screen.test.tsx
git commit -m "feat: add settings modal with appearance control"
```

---

### Task 4: Wiring — startup apply, route, gear icon; final verification

**Files:**
- Modify: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, root `docs/TESTING.md` (append manual checklist)

**Interfaces:**
- Consumes: `applyColorMode` (Task 2); `getColorMode` (Task 1); `SettingsScreen` route file (Task 3); existing `db`, `t`, `usePalette`.
- Produces: nothing consumed by later tasks — this completes the feature.

- [ ] **Step 1: Apply the stored mode on startup and register the route**

In `app/_layout.tsx`, add the two imports (after the `import { t } from '../lib/i18n';` line):

```tsx
import { applyColorMode } from '../lib/colorMode';
import { getColorMode } from '../lib/db/settings';
```

In `RootLayout`, directly after `const { state, retry } = useDbMigrations();`, add (the settings table only exists once migrations resolve):

```tsx
  useEffect(() => {
    if (state === 'ready') {
      applyColorMode(getColorMode(db));
    }
  }, [state]);
```

In the main return's `<Stack>`, after the `plan/entry/[id]` screen, add:

```tsx
          <Stack.Screen name="settings" options={{ presentation: 'modal', headerShown: false }} />
```

- [ ] **Step 2: Add the gear icon to the Today tab header**

In `app/(tabs)/_layout.tsx`:

1. Extend the imports:

```tsx
import { router, Tabs } from 'expo-router';
import { Pressable } from 'react-native';
```

(replacing the existing `import { Tabs } from 'expo-router';` line).

2. Replace the `name="index"` screen registration with:

```tsx
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.today'),
          tabBarIcon: ({ color }) => <Ionicons name="sunny-outline" size={24} color={color} />,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.open')}
              onPress={() => router.push('/settings')}
              className="min-h-14 justify-center px-4">
              <Ionicons name="settings-outline" size={24} color={palette.ink} />
            </Pressable>
          ),
        }}
      />
```

(`palette` already exists in `TabLayout` via `usePalette()`.)

- [ ] **Step 3: Full automated pass**

Run from `frontend/`:

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
```

Expected: all green (179 tests: 173 existing + 3 repository/mapping + 3 screen), zero lint warnings, bundle exports. Fix anything that isn't before proceeding.

- [ ] **Step 4: Append the manual checklist to docs/TESTING.md**

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Colour mode setting (manual pass)

- Gear icon on the Today header opens Settings; the close button returns.
- Selecting Light / Dark / System restyles the app immediately behind the modal (visible on a design/* theme branch; on develop dark mirrors light, so Light and Dark look identical there).
- The selection persists across kill & relaunch.
- System follows the OS light/dark toggle live; Light and Dark ignore it.
- Norwegian device language: Innstillinger / Utseende / Lys / Mørk / System.
```

- [ ] **Step 5: Commit**

```bash
git add app/_layout.tsx 'app/(tabs)/_layout.tsx' ../docs/TESTING.md
git commit -m "feat: apply stored color mode and add settings entry point"
```

---

## Self-Review Notes

- **Spec coverage:** repository key + fallback (T1), mapping decision 1 (T2), settings modal + i18n incl. `settings.close` (T3), startup apply on ready + modal route + gear entry point + manual checklist (T4). Gear icon has no unit test by spec decision (navigator options never rendered in unit tests). Rollout (merge to develop, rebase `design/*` branches) is a post-plan step for the human/orchestrator, not a task.
- **Known judgment calls:** the startup effect keys on `state` and re-applies on migration retry — harmless (idempotent). `applyColorMode` in the screen is called before `setMode` so the restyle and the selection update land in the same commit-frame; order is not observable in tests. The `expect.anything()` in the screen test matches the mocked `db` object (`{}`), which `toHaveBeenCalledWith(expect.anything(), 'light')` — a plain `{}` is truthy and matches.
- **Type consistency check:** `ColorMode` is exported from `lib/db/settings` (T1) and imported by `lib/colorMode.ts` (T2) and `app/settings.tsx` (T3); `applyColorMode(mode: ColorMode)` matches all call sites (T3 screen, T4 root layout); `SegmentedControl<ColorMode>` satisfies `Segment<K extends string>[]` with keys `'light' | 'dark' | 'system'`; `getColorMode(db)` call sites pass the drizzle `DB` (real in T4, `{}` mock in T3 tests where the function itself is mocked).
