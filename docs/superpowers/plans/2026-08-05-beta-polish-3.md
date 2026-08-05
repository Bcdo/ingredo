# Beta Polish Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement beta feedback round 2: version footer in Settings, auto-hyphen code inputs, Settings section hierarchy, and a shopping-list snapshot card on the Today screen.

**Architecture:** Four independent frontend slices on the Expo/React Native app. Version info is snapshotted into `expo-constants` extra at config-evaluation time (so every `eas update` carries its git hash). Code formatting is a pure function wrapped by a `CodeInput` component. The Settings screen gains a shared `SectionHeader` and splits households out of `AccountSection`. The Today screen gains a self-contained `ShoppingCard` querying local SQLite.

**Tech Stack:** Expo SDK (React Native), expo-router, drizzle-orm over expo-sqlite (`useLiveQuery`), NativeWind classes, i18n-js, Jest + @testing-library/react-native (`jest-expo` preset).

**Spec:** `docs/superpowers/specs/2026-08-05-beta-polish-3-design.md`

## Global Constraints

- All work is inside `frontend/`; the backend is untouched.
- Run all commands from `/home/mrb/Work/Programming/ingredo/frontend`. Tests: `npm test -- <pattern>`.
- App version becomes exactly `'0.1.0'` — plain semver, no `-beta` suffix anywhere.
- Every new user-facing string goes into BOTH `lib/i18n/en.json` and `lib/i18n/nb.json` — the parity test in `__tests__/i18n.test.ts` fails otherwise.
- Follow existing styling idiom: NativeWind classes, `font-body`/`font-display` families, `text-ink` on `bg-cream`/`bg-linen`, `rounded-card`.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Version `0.1.0` + git hash snapshot in app.config

**Files:**
- Modify: `frontend/app.config.ts`
- Test: `frontend/__tests__/app-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `expoConfig.version === '0.1.0'` and `expoConfig.extra.build: { gitHash: string | null }`. Task 2 reads both via `expo-constants`.

Why config-time: `app.config.ts` is evaluated by Node whenever `eas update` runs (`publish:beta` script), so `extra.build.gitHash` snapshots the exact commit each published update was built from. `child_process` is fine here — this file never runs inside the app bundle.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('app.config', ...)` in `__tests__/app-config.test.ts`:

```ts
  it('uses pre-launch semver', () => {
    expect(appConfig(ctx).version).toBe('0.1.0');
  });

  it('snapshots the git hash into extra.build', () => {
    const build = appConfig(ctx).extra?.build as { gitHash: string | null };
    // This test runs inside the repo, so the hash must resolve.
    expect(build.gitHash).toMatch(/^[0-9a-f]{7,12}$/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- app-config`
Expected: FAIL — version is `'1.0.0'`, `extra.build` is undefined.

- [ ] **Step 3: Implement**

In `app.config.ts`:

```ts
import { execSync } from 'node:child_process';
```

Below the `EAS_PROJECT_ID` constant:

```ts
// Snapshotted at config-evaluation time: `eas update` evaluates this file
// on the publishing machine, so each update carries the commit it shipped
// from. Null when git is unavailable (e.g. a tarball checkout).
function readGitHash(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}
```

Change `version: '1.0.0'` to `version: '0.1.0'` and extend `extra`:

```ts
  extra: {
    apiUrl: process.env.INGREDO_API_URL ?? 'http://10.0.2.2:8080',
    build: { gitHash: readGitHash() },
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- app-config`
Expected: PASS (all app-config tests, including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add app.config.ts __tests__/app-config.test.ts
git commit -m "feat: version 0.1.0 and git-hash build snapshot in app config"
```

---

### Task 2: Version footer on the Settings screen

**Files:**
- Modify: `frontend/app/settings.tsx`
- Test: `frontend/__tests__/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `Constants.expoConfig.version` and `Constants.expoConfig.extra.build.gitHash` from Task 1 (via `expo-constants`, already a dependency).
- Produces: a footer `<Text>` reading `Ingredo 0.1.0 · <hash>` (or `Ingredo 0.1.0` when the hash is null) at the bottom of the Settings scroll content. Task 5 keeps it as the last child.

- [ ] **Step 1: Write the failing tests**

In `__tests__/settings-screen.test.tsx`, add with the other `jest.mock` calls (top level):

```ts
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: '0.1.0', extra: { build: { gitHash: 'abc1234' } } },
  },
}));
```

Add `import Constants from 'expo-constants';` with the imports, and in the existing `beforeEach`, reset the hash (a later test mutates it):

```ts
    (Constants.expoConfig!.extra as { build: { gitHash: string | null } }).build.gitHash =
      'abc1234';
```

New tests inside `describe('SettingsScreen', ...)`:

```ts
  it('shows the version footer with the build hash', () => {
    render(<SettingsScreen />);
    expect(screen.getByText('Ingredo 0.1.0 · abc1234')).toBeTruthy();
  });

  it('omits the hash from the footer when unavailable', () => {
    (Constants.expoConfig!.extra as { build: { gitHash: string | null } }).build.gitHash = null;
    render(<SettingsScreen />);
    expect(screen.getByText('Ingredo 0.1.0')).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- settings-screen`
Expected: the two new tests FAIL ("Unable to find an element with text..."); existing ones PASS.

- [ ] **Step 3: Implement**

In `app/settings.tsx`, add `import Constants from 'expo-constants';`. Inside `SettingsScreen`, before `return`:

```ts
  const build = (Constants.expoConfig?.extra as { build?: { gitHash: string | null } } | undefined)
    ?.build;
  const versionLine = [`Ingredo ${Constants.expoConfig?.version ?? '0.0.0'}`, build?.gitHash]
    .filter(Boolean)
    .join(' · ');
```

As the last child inside the `<ScrollView>` (after the habits-link `<View>`):

```tsx
          <Text className="pb-2 pt-8 text-center font-body text-xs text-ink opacity-50">
            {versionLine}
          </Text>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- settings-screen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/settings.tsx __tests__/settings-screen.test.tsx
git commit -m "feat: version footer at the bottom of settings"
```

---

### Task 3: `formatCode` helper

**Files:**
- Create: `frontend/lib/codeFormat.ts`
- Test: `frontend/__tests__/code-format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatCode(next: string, previous: string): string` — Task 4's `CodeInput` calls it with the raw TextInput value (`next`) and the currently rendered value (`previous`).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/code-format.test.ts`:

```ts
import { formatCode } from '../lib/codeFormat';

describe('formatCode', () => {
  it('uppercases and appends the hyphen after the third character', () => {
    expect(formatCode('a', '')).toBe('A');
    expect(formatCode('Ab', 'A')).toBe('AB');
    expect(formatCode('ABc', 'AB')).toBe('ABC-');
    expect(formatCode('ABC-d', 'ABC-')).toBe('ABC-D');
  });

  it('never re-appends the hyphen while deleting', () => {
    expect(formatCode('ABC', 'ABC-')).toBe('ABC');
    expect(formatCode('AB', 'ABC')).toBe('AB');
    expect(formatCode('', 'A')).toBe('');
  });

  it('normalizes pasted codes of any shape', () => {
    expect(formatCode('abcdef', '')).toBe('ABC-DEF');
    expect(formatCode('abc def', '')).toBe('ABC-DEF');
    expect(formatCode('ABC-DEF', '')).toBe('ABC-DEF');
  });

  it('strips junk and truncates to six significant characters', () => {
    expect(formatCode('a!b@c#d$e%f^g', '')).toBe('ABC-DEF');
    expect(formatCode('abcdefgh', '')).toBe('ABC-DEF');
    // 0, 1, I, L, O are not in the server's code alphabet, but only the
    // ambiguous digits are stripped client-side; letters pass through and
    // the server stays the validator.
    expect(formatCode('ab0cd1ef', '')).toBe('ABC-DEF');
  });

  it('reflows after a mid-code deletion', () => {
    expect(formatCode('AB-DEF', 'ABC-DEF')).toBe('ABD-EF');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- code-format`
Expected: FAIL — cannot find module `../lib/codeFormat`.

- [ ] **Step 3: Implement**

Create `lib/codeFormat.ts`:

```ts
// Live-formats household/invite/reset codes as ABC-DEF while typing. The
// server canonicalizes on submit (strips hyphens/spaces, uppercases), so
// this is purely a typing aid — which is why it must never fight deletion:
// the trailing hyphen is only auto-appended while the user is adding
// characters, so backspacing over it does not snap it back.
const SIGNIFICANT = /[A-Z2-9]/;
const CODE_LENGTH = 6;

export function formatCode(next: string, previous: string): string {
  const cleaned = next
    .toUpperCase()
    .split('')
    .filter((char) => SIGNIFICANT.test(char))
    .slice(0, CODE_LENGTH);
  if (cleaned.length < 3) return cleaned.join('');
  if (cleaned.length === 3) {
    const grew = next.length > previous.length;
    return grew ? `${cleaned.join('')}-` : cleaned.join('');
  }
  return `${cleaned.slice(0, 3).join('')}-${cleaned.slice(3).join('')}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- code-format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/codeFormat.ts __tests__/code-format.test.ts
git commit -m "feat: auto-hyphen formatter for ABC-DEF codes"
```

---

### Task 4: `CodeInput` component, wired into register and reset

**Files:**
- Create: `frontend/components/ui/CodeInput.tsx`
- Modify: `frontend/components/ui/Input.tsx` (add `autoCorrect` prop)
- Modify: `frontend/app/account/register.tsx`
- Modify: `frontend/app/account/reset.tsx`
- Test: `frontend/__tests__/code-input.test.tsx`

**Interfaces:**
- Consumes: `formatCode(next, previous)` from Task 3; `Input` from `components/ui/Input`.
- Produces: `CodeInput` with props `{ value, onChangeText, label?, placeholder?, tone?, testID?, className? }` — same controlled-value contract as `Input`; parents keep the rendered (hyphenated) value in state. Task 5 uses it for the join-household input.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/code-input.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';

import { CodeInput } from '../components/ui/CodeInput';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function Harness() {
  const [value, setValue] = useState('');
  return <CodeInput testID="code" value={value} onChangeText={setValue} />;
}

describe('CodeInput', () => {
  it('formats typing into ABC-DEF', () => {
    render(<Harness />);
    fireEvent.changeText(screen.getByTestId('code'), 'abc');
    expect(screen.getByTestId('code').props.value).toBe('ABC-');
    fireEvent.changeText(screen.getByTestId('code'), 'ABC-def');
    expect(screen.getByTestId('code').props.value).toBe('ABC-DEF');
  });

  it('lets backspace cross the hyphen without re-adding it', () => {
    render(<Harness />);
    fireEvent.changeText(screen.getByTestId('code'), 'abc');
    expect(screen.getByTestId('code').props.value).toBe('ABC-');
    fireEvent.changeText(screen.getByTestId('code'), 'ABC');
    expect(screen.getByTestId('code').props.value).toBe('ABC');
    fireEvent.changeText(screen.getByTestId('code'), 'AB');
    expect(screen.getByTestId('code').props.value).toBe('AB');
  });

  it('normalizes a paste', () => {
    render(<Harness />);
    fireEvent.changeText(screen.getByTestId('code'), 'abc def');
    expect(screen.getByTestId('code').props.value).toBe('ABC-DEF');
  });

  it('caps the rendered length at 7', () => {
    render(<Harness />);
    expect(screen.getByTestId('code').props.maxLength).toBe(7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- code-input`
Expected: FAIL — cannot find module `../components/ui/CodeInput`.

- [ ] **Step 3: Implement**

In `components/ui/Input.tsx`: add `autoCorrect?: boolean;` to `InputProps`, destructure with default `autoCorrect = true`, and pass `autoCorrect={autoCorrect}` to the `<TextInput>`.

Create `components/ui/CodeInput.tsx`:

```tsx
import React from 'react';

import { formatCode } from '../../lib/codeFormat';
import { Input } from './Input';

type CodeInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  tone?: 'linen' | 'cream';
  testID?: string;
  className?: string;
};

export function CodeInput({ value, onChangeText, ...rest }: CodeInputProps) {
  return (
    <Input
      {...rest}
      value={value}
      onChangeText={(next) => onChangeText(formatCode(next, value))}
      autoCapitalize="characters"
      autoCorrect={false}
      maxLength={7}
    />
  );
}
```

In `app/account/register.tsx`: replace the invite `<Input ...>` with `CodeInput`, keeping `testID="register-invite"`, `label={t('account.inviteCode')}`, `placeholder="ABC-DEF"`, `className="mb-4"`, and drop the now-redundant `autoCapitalize` prop. Import: `import { CodeInput } from '../../components/ui/CodeInput';`

In `app/account/reset.tsx`: same swap for the `testID="reset-code"` input (keep `label={t('account.resetCode')}`, `placeholder="ABC-DEF"`, `className="mb-4"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- code-input ui account-screens`
Expected: PASS — the existing account-screens tests type full codes like `'ABC-DEF'`, which `formatCode` maps to themselves, so their submit assertions are unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/ui/CodeInput.tsx components/ui/Input.tsx app/account/register.tsx app/account/reset.tsx __tests__/code-input.test.tsx
git commit -m "feat: auto-hyphen code input for invite and reset codes"
```

---

### Task 5: Settings hierarchy — `SectionHeader`, `HouseholdsSection` split, spacing

**Files:**
- Create: `frontend/components/ui/SectionHeader.tsx`
- Create: `frontend/components/settings/HouseholdsSection.tsx`
- Modify: `frontend/components/settings/AccountSection.tsx`
- Modify: `frontend/app/settings.tsx`
- Test: create `frontend/__tests__/households-section.test.tsx`; modify `frontend/__tests__/account-section.test.tsx`, `frontend/__tests__/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `CodeInput` from Task 4 (join-code field); everything else already exists (`lib/api/auth` functions, `useSession`, `useSyncStatus`, `Input`, `Button`).
- Produces: `SectionHeader({ title, className? })`; `HouseholdsSection()` (renders `null` when signed out, `testID="households-section"`); slimmed `AccountSection()` (account identity + sync + server override only, `testID="account-section"` kept).

This is a reorganization, not a behavior change: every household handler, state variable, and error mapper moves verbatim from `AccountSection.tsx` into `HouseholdsSection.tsx`.

- [ ] **Step 1: Create the test file for HouseholdsSection (failing)**

Create `__tests__/households-section.test.tsx`. Start from a copy of `__tests__/account-section.test.tsx`'s prelude — the same `jest.mock` blocks for `../lib/db/client`, `../lib/api/auth`, `../lib/api/session`, `../lib/api/config`, `../lib/sync/engine`, `../lib/sync/status`, `expo-router`, `@expo/vector-icons`, and the same `signedOut` / `signedIn` / `household` / `summaries` fixtures — but import and render `HouseholdsSection`:

```tsx
import { HouseholdsSection } from '../components/settings/HouseholdsSection';
```

Then **move** (cut from `account-section.test.tsx`, paste here) every household-behavior test — the tests covering: expanded active row with code and members, join, create, rename, leave (and its confirm dialog), switch-household, and their error paths — changing only `render(<AccountSection />)` to `render(<HouseholdsSection />)`. Add two new tests:

```tsx
describe('HouseholdsSection visibility', () => {
  it('renders nothing when signed out', () => {
    useSessionMock.mockReturnValue(signedOut);
    const { toJSON } = render(<HouseholdsSection />);
    expect(toJSON()).toBeNull();
  });

  it('shows the section header when signed in', async () => {
    useSessionMock.mockReturnValue(signedIn);
    getHouseholdMock.mockResolvedValue(household);
    listHouseholdsMock.mockResolvedValue(summaries);
    render(<HouseholdsSection />);
    await act(async () => {});
    expect(screen.getByText('Households')).toBeTruthy();
  });
});
```

Keep in `account-section.test.tsx` only: the signed-out CTA test, and the signed-in tests covering email display, sign-out, and the sync status line / sync-now press. Unused mocks and fixtures may remain.

- [ ] **Step 2: Run tests to verify the new file fails**

Run: `npm test -- households-section`
Expected: FAIL — cannot find module `../components/settings/HouseholdsSection`.

- [ ] **Step 3: Create SectionHeader**

Create `components/ui/SectionHeader.tsx`:

```tsx
import React from 'react';
import { Text } from 'react-native';

// The one header level for Settings sections: quiet, uppercase, clearly
// not body text.
type SectionHeaderProps = { title: string; className?: string };

export function SectionHeader({ title, className = '' }: SectionHeaderProps) {
  return (
    <Text
      className={`mb-2 font-body-bold text-xs uppercase tracking-wider text-ink opacity-60 ${className}`}>
      {title}
    </Text>
  );
}
```

- [ ] **Step 4: Create HouseholdsSection and slim AccountSection**

Create `components/settings/HouseholdsSection.tsx` by moving from `AccountSection.tsx`, unchanged: the `joinErrorMessage`, `leaveErrorMessage`, `createErrorMessage`, `genericErrorMessage` helpers; the state (`household`, `households`, `joinCode`, `createName`, `error`, `revealCreate`, `revealJoin`, `renaming`, `renameValue`); the session-transition `useEffect`; the `join`, `switchTo`, `create`, `startRename`, `saveRename`, `confirmLeave` handlers; and the households JSX (active/inactive rows, create/join reveals, error text). Shape:

```tsx
export function HouseholdsSection() {
  const session = useSession();
  // ...moved state...
  const palette = usePalette();
  const signedIn = session.status === 'signedIn';

  // ...moved effect and handlers...

  if (!signedIn) return null;

  return (
    <View testID="households-section" className="px-4 pt-8">
      <SectionHeader title={t('account.householdsTitle')} />
      {/* moved: households list, create reveal, join reveal, error text */}
    </View>
  );
}
```

Two deltas from the moved code: the old `<Text className="font-body text-sm text-ink">{t('account.householdsTitle')}</Text>` label is replaced by the `SectionHeader` above, and the join input becomes:

```tsx
              <CodeInput
                testID="join-code-input"
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder={t('account.joinPlaceholder')}
              />
```

(imports: `SectionHeader` from `../ui/SectionHeader`, `CodeInput` from `../ui/CodeInput`; trim the moved imports to what the file uses).

Slim `AccountSection.tsx` down to session identity + sync + server override, with the header switched to `SectionHeader`:

```tsx
export function AccountSection() {
  const session = useSession();
  const syncStatus = useSyncStatus();
  const [serverOverride, setServerOverride] = useState(() => getApiUrlOverride(db) ?? '');
  const showServerField = __DEV__ || serverOverride !== '';
  const signedIn = session.status === 'signedIn';

  const serverField = showServerField ? (
    /* unchanged serverField JSX */
  ) : null;

  if (!signedIn) {
    return (
      <View testID="account-section" className="px-4 pt-2">
        <SectionHeader title={t('account.title')} />
        {/* unchanged: signedOutHint text, sign-in Button, serverField */}
      </View>
    );
  }

  return (
    <View testID="account-section" className="px-4 pt-2">
      <SectionHeader title={t('account.title')} />
      {/* unchanged: email + sign-out row, sync status + sync-now row */}
      {serverField}
    </View>
  );
}
```

Delete everything that moved (the four error mappers, household state/handlers/JSX, `syncStatusLine` stays); trim imports (`Alert`, `Share`, api functions other than `signOut`, `CodeInput`/`Input` if unused, etc. — `Input` stays for the server field).

- [ ] **Step 5: Update settings.tsx layout**

In `app/settings.tsx`:
- Import `HouseholdsSection` and `SectionHeader`.
- Render `<HouseholdsSection />` directly after `<AccountSection />`.
- Replace the two `<Text className="mb-2 font-body-bold text-sm text-ink">...</Text>` labels for appearance and language with `<SectionHeader title={t('settings.appearance')} />` / `<SectionHeader title={t('settings.language')} />`.
- Give the appearance (currently `pt-2`), language (currently `pt-6`), and habits-link (currently `pt-6`) `<View>`s `className="px-4 pt-8"` so every section gets the same gap. Account keeps `pt-2` as the first section, `HouseholdsSection` brings its own `pt-8`, and the version footer from Task 2 stays last with its `pt-8`.

- [ ] **Step 6: Run the affected suites**

Run: `npm test -- households-section account-section settings-screen`
Expected: PASS. If `settings-screen` tests fail on missing mocks, `HouseholdsSection` renders `null` there (real `useSession` reports signed out in tests) — no new mocks should be needed.

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/ui/SectionHeader.tsx components/settings/HouseholdsSection.tsx components/settings/AccountSection.tsx app/settings.tsx __tests__/households-section.test.tsx __tests__/account-section.test.tsx __tests__/settings-screen.test.tsx
git commit -m "feat: settings section hierarchy with households split out"
```

---

### Task 6: Today screen shopping-list card

**Files:**
- Create: `frontend/components/today/ShoppingCard.tsx`
- Modify: `frontend/app/(tabs)/index.tsx`
- Modify: `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`
- Test: create `frontend/__tests__/shopping-card.test.tsx`; modify `frontend/__tests__/today-screen.test.tsx`

**Interfaces:**
- Consumes: `shoppingItems` schema, `notDeleted`/`inHousehold` predicates, `useActiveHouseholdId()` from `lib/household`, `Card`, `t`, `usePalette`.
- Produces: `ShoppingCard()` — self-contained card; renders `null` when there are no active items. New i18n keys `today.shoppingTitle` and `today.itemsToBuy` (plural object).

- [ ] **Step 1: Add i18n strings**

`lib/i18n/en.json`, inside `"today"`:

```json
    "shoppingTitle": "Shopping list",
    "itemsToBuy": {
      "one": "1 item to buy",
      "other": "%{count} items to buy"
    }
```

`lib/i18n/nb.json`, inside `"today"`:

```json
    "shoppingTitle": "Handleliste",
    "itemsToBuy": {
      "one": "1 vare å kjøpe",
      "other": "%{count} varer å kjøpe"
    }
```

(i18n-js resolves `{one, other}` objects via the `count` option; the parity test flattens both files identically, so it stays green.)

- [ ] **Step 2: Write the failing tests**

Create `__tests__/shopping-card.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import { ShoppingCard } from '../components/today/ShoppingCard';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

jest.mock('../lib/household', () => ({
  useActiveHouseholdId: () => 'household-1',
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;

const item = (id: string, name: string) => ({ id, name });

describe('ShoppingCard', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('shows count, three-item preview with ellipsis, and navigates to shop', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [
        item('s1', 'Milk'),
        item('s2', 'Bread'),
        item('s3', 'Tomatoes'),
        item('s4', 'Cheese'),
        item('s5', 'Butter'),
      ],
      updatedAt: new Date(),
    }));

    render(<ShoppingCard />);

    expect(screen.getByText('Shopping list')).toBeTruthy();
    expect(screen.getByText('5 items to buy')).toBeTruthy();
    expect(screen.getByText('Milk, Bread, Tomatoes…')).toBeTruthy();

    fireEvent.press(screen.getByText('Shopping list'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/shop');
  });

  it('uses the singular form and no ellipsis for a short list', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [item('s1', 'Milk')],
      updatedAt: new Date(),
    }));

    render(<ShoppingCard />);

    expect(screen.getByText('1 item to buy')).toBeTruthy();
    expect(screen.getByText('Milk')).toBeTruthy();
  });

  it('renders nothing when the list has no active items', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));

    const { toJSON } = render(<ShoppingCard />);
    expect(toJSON()).toBeNull();
  });
});
```

(Exclusion of purchased/deleted/other-household rows lives in the drizzle `where` clause, which this mock bypasses — that clause reuses the same predicate helpers as the Shop tab and is covered by review, matching how `today-screen.test.tsx` treats its query.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- shopping-card`
Expected: FAIL — cannot find module `../components/today/ShoppingCard`.

- [ ] **Step 4: Implement the card**

Create `components/today/ShoppingCard.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { and, asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { db } from '../../lib/db/client';
import { inHousehold, notDeleted } from '../../lib/db/predicates';
import { shoppingItems } from '../../lib/db/schema';
import { useActiveHouseholdId } from '../../lib/household';
import { t } from '../../lib/i18n';
import { usePalette } from '../../lib/usePalette';
import { Card } from '../ui/Card';

export function ShoppingCard() {
  const router = useRouter();
  const palette = usePalette();
  const householdId = useActiveHouseholdId();

  const { data: rows } = useLiveQuery(
    db
      .select({ id: shoppingItems.id, name: shoppingItems.name })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.status, 'active'),
          notDeleted(shoppingItems),
          inHousehold(shoppingItems, householdId)
        )
      )
      .orderBy(asc(shoppingItems.createdAt)),
    [householdId]
  );

  const items = rows ?? [];
  if (items.length === 0) return null;

  const preview =
    items
      .slice(0, 3)
      .map((row) => row.name)
      .join(', ') + (items.length > 3 ? '…' : '');

  return (
    <Pressable
      accessibilityRole="button"
      className="active:opacity-80"
      onPress={() => router.push('/(tabs)/shop')}>
      <Card className="gap-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-display text-base text-ink">{t('today.shoppingTitle')}</Text>
          <Ionicons name="chevron-forward" size={18} color={palette.ink} />
        </View>
        <Text className="font-body text-base text-ink">
          {t('today.itemsToBuy', { count: items.length })}
        </Text>
        <Text className="font-body text-sm text-ink opacity-70" numberOfLines={1}>
          {preview}
        </Text>
      </Card>
    </Pressable>
  );
}
```

- [ ] **Step 5: Wire into the Today screen**

In `app/(tabs)/index.tsx`: `import { ShoppingCard } from '../../components/today/ShoppingCard';` and render `<ShoppingCard />` as the last child of the `<ScrollView>` (after the tomorrow block — the ScrollView's `gap-6` supplies the spacing).

In `__tests__/today-screen.test.tsx`, add with the other mocks:

```ts
jest.mock('../components/today/ShoppingCard', () => ({
  ShoppingCard: () => null,
}));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- shopping-card today-screen i18n`
Expected: PASS.

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/today/ShoppingCard.tsx "app/(tabs)/index.tsx" lib/i18n/en.json lib/i18n/nb.json __tests__/shopping-card.test.tsx __tests__/today-screen.test.tsx
git commit -m "feat: shopping-list snapshot card on the today screen"
```

---

## Not in this plan (per spec)

- Home-screen widget: deferred to post-beta (needs native builds + TestFlight).
- Version bump automation: bumping `0.1.0` stays manual by design.
- Backend changes: none.
