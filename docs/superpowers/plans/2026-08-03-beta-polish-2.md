# Beta Polish 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Password confidence at registration (eye toggle + confirm field), a visible auto-focused rename input, and the rename/reveal state-reset fixes deferred from the beta-polish final review.

**Architecture:** `Input` (`components/ui/Input.tsx`) gains three opt-in props (`secureToggle`, `autoFocus`, `tone`) — every existing call site keeps today's look. The register screen adds a confirm field with a client-side mismatch check; sign-in gets the eye for free. AccountSection's rename input uses the new props, and its fetch effect resets all transient editing state on session/household transitions.

**Tech Stack:** Expo SDK 54 / RN 0.81, NativeWind, Jest + RNTL, i18n-js. Frontend-only. Spec: `docs/superpowers/specs/2026-08-03-beta-polish-2-design.md`.

## Global Constraints

- Every new user-facing string lands in BOTH `frontend/lib/i18n/nb.json` and `en.json`, exactly as the spec's table writes them (key-parity test enforces): `account.confirmPassword` "Bekreft passord"/"Confirm password"; `account.showPassword` "Vis passord"/"Show password"; `account.hidePassword` "Skjul passord"/"Hide password"; `account.errors.passwordMismatch` "Passordene er ikke like."/"Passwords don't match.".
- Palette: cream `#FBF7F1`, linen `#F3ECE1`, clay `#C96B45`, ink `#3A322B` — tone classes are `bg-cream` + `border border-clay` (cream) vs `bg-linen` (linen, default).
- No new native modules; no backend changes.
- Frontend gates before every commit, run from `frontend/`: `npx jest`, `npx tsc --noEmit`, `npm run lint` (10 pre-existing prettier-drift files are the accepted baseline — changed files must stay clean).
- Commit prefixes house style; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Git from repo root.

---

### Task 1: Input — secureToggle, autoFocus, tone

**Files:**
- Modify: `frontend/components/ui/Input.tsx` (full replacement below)
- Modify: `frontend/lib/i18n/nb.json` / `en.json` (+`account.showPassword`, +`account.hidePassword`)
- Test: `frontend/__tests__/ui.test.tsx` (append a describe)

**Interfaces:**
- Produces: `Input` accepts `secureToggle?: boolean`, `autoFocus?: boolean`, `tone?: 'linen' | 'cream'` (defaults `false`/`false`/`'linen'`). `autoFocus` and the effective `secureTextEntry` pass through to the native TextInput (assertable via `props`). Tasks 2 and 3 use these props.

- [ ] **Step 1: Add the i18n keys.** In BOTH locale files' `account` object: `nb.json` gains `"showPassword": "Vis passord",` and `"hidePassword": "Skjul passord",` — `en.json` gains `"showPassword": "Show password",` and `"hidePassword": "Hide password",`.

- [ ] **Step 2: Write the failing tests.** Append to `frontend/__tests__/ui.test.tsx` — add these imports at the top (`Input` next to the other component imports) and this mock line below the existing imports:

```tsx
import { Input } from '../components/ui/Input';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
```

and the describe at the end:

```tsx
describe('Input', () => {
  it('secure toggle reveals and re-hides the password', () => {
    render(<Input value="hemmelig" onChangeText={() => {}} secureTextEntry secureToggle testID="pw" />);
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);

    fireEvent.press(screen.getByLabelText('Hide password'));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('renders no toggle without secureToggle', () => {
    render(<Input value="x" onChangeText={() => {}} secureTextEntry testID="pw" />);
    expect(screen.queryByLabelText('Show password')).toBeNull();
  });

  it('passes autoFocus through to the native input', () => {
    render(<Input value="x" onChangeText={() => {}} autoFocus testID="field" />);
    expect(screen.getByTestId('field').props.autoFocus).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx jest __tests__/ui.test.tsx`
Expected: FAIL — no element with label "Show password"; `autoFocus` undefined.

- [ ] **Step 4: Replace `frontend/components/ui/Input.tsx`** with:

```tsx
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { t } from '../../lib/i18n';
import { usePalette } from '../../lib/usePalette';

type InputProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
  // Eye button inside the field that reveals/hides a secure entry.
  secureToggle?: boolean;
  autoFocus?: boolean;
  // 'cream' stands out on linen surfaces (cream field, clay border).
  tone?: 'linen' | 'cream';
  testID?: string;
  className?: string;
  maxLength?: number;
};

export function Input({
  value,
  onChangeText,
  placeholder,
  label,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  secureTextEntry = false,
  secureToggle = false,
  autoFocus = false,
  tone = 'linen',
  testID,
  className = '',
  maxLength,
}: InputProps) {
  const palette = usePalette();
  const [revealed, setRevealed] = useState(false);
  const toneClasses = tone === 'cream' ? 'border border-clay bg-cream' : 'bg-linen';
  return (
    <View className={className}>
      {label ? <Text className="mb-1 font-body-bold text-sm text-ink">{label}</Text> : null}
      <View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.inkFaint}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secureTextEntry && !revealed}
          autoFocus={autoFocus}
          testID={testID}
          maxLength={maxLength}
          className={`min-h-14 rounded-card px-4 py-3 font-body text-base text-ink ${toneClasses} ${
            multiline ? 'min-h-24' : ''
          } ${secureToggle ? 'pr-12' : ''}`}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
        {secureToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? t('account.hidePassword') : t('account.showPassword')}
            onPress={() => setRevealed((prev) => !prev)}
            className="absolute bottom-0 right-0 top-0 justify-center px-3">
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={palette.inkMuted}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
```

(The class order inside the template literal must keep `bg-linen`/`bg-cream` via `toneClasses` — behavior identical for every existing call site since all defaults preserve today's output.)

- [ ] **Step 5: Run the gates**

Run: `cd frontend && npx jest __tests__/ui.test.tsx && npx jest && npx tsc --noEmit && npm run lint`
Expected: all green — including every pre-existing suite that renders `Input` (no default-path behavior changed), and the i18n parity test.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ui/Input.tsx frontend/__tests__/ui.test.tsx frontend/lib/i18n/nb.json frontend/lib/i18n/en.json
git commit -m "feat: Input gains secure-entry eye toggle, autoFocus and cream tone"
```

---

### Task 2: Register confirm field + eyes on both auth screens

**Files:**
- Modify: `frontend/app/account/register.tsx`
- Modify: `frontend/app/account/sign-in.tsx:55-63` (password Input only)
- Modify: `frontend/lib/i18n/nb.json` / `en.json` (+`account.confirmPassword`, +`account.errors.passwordMismatch`)
- Test: `frontend/__tests__/account-screens.test.tsx`

**Interfaces:**
- Consumes: Task 1's `secureToggle` prop.
- Produces: final auth-screen UX; nothing downstream.

- [ ] **Step 1: Add the i18n keys.** Both locales: `account.confirmPassword` = "Bekreft passord" / "Confirm password"; inside `account.errors`: `passwordMismatch` = "Passordene er ikke like." / "Passwords don't match.".

- [ ] **Step 2: Failing tests.** In `frontend/__tests__/account-screens.test.tsx`:

(a) Every existing RegisterScreen test that presses "Create account" after filling `register-password` gains one line right after that fill (there are three: the submit test, the 409 test, the 400 test — matching confirm keeps them green once the guard exists):

```tsx
    fireEvent.changeText(screen.getByTestId('register-confirm'), 'passord123');
```

(For the 400 test the password value used in that test is repeated verbatim in the confirm fill.)

(b) Append inside `describe('RegisterScreen', …)`:

```tsx
  it('blocks mismatched passwords without calling the API', async () => {
    render(<RegisterScreen />);

    fireEvent.changeText(screen.getByTestId('register-name'), 'Kari');
    fireEvent.changeText(screen.getByTestId('register-email'), 'kari@example.test');
    fireEvent.changeText(screen.getByTestId('register-password'), 'passord123');
    fireEvent.changeText(screen.getByTestId('register-confirm'), 'passord124');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    });

    expect(registerMock).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords don't match.")).toBeOnTheScreen();
  });

  it('the eye reveals the password', () => {
    render(<RegisterScreen />);
    expect(screen.getByTestId('register-password').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getAllByLabelText('Show password')[0]);
    expect(screen.getByTestId('register-password').props.secureTextEntry).toBe(false);
    expect(screen.getByTestId('register-confirm').props.secureTextEntry).toBe(true);
  });
```

(c) Append inside `describe('SignInScreen', …)`:

```tsx
  it('the eye reveals the password', () => {
    render(<SignInScreen />);
    expect(screen.getByTestId('sign-in-password').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByTestId('sign-in-password').props.secureTextEntry).toBe(false);
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx jest __tests__/account-screens.test.tsx`
Expected: FAIL — no `register-confirm` testID, no "Show password" labels.

- [ ] **Step 4: Implement.** `register.tsx`: add state `const [confirm, setConfirm] = useState('');` next to `password`. Guard at the top of `submit` (before `setBusy`):

```tsx
  const submit = async () => {
    if (password !== confirm) {
      setError(t('account.errors.passwordMismatch'));
      return;
    }
    setBusy(true);
    // ...rest unchanged
```

Password Input gains `secureToggle`; directly below it insert:

```tsx
      <Input
        testID="register-confirm"
        label={t('account.confirmPassword')}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        className="mb-4"
      />
```

`sign-in.tsx`: the password Input (lines 55-63) gains one prop: `secureToggle`.

- [ ] **Step 5: Run the gates**

Run: `cd frontend && npx jest && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/account/register.tsx frontend/app/account/sign-in.tsx frontend/lib/i18n/nb.json frontend/lib/i18n/en.json frontend/__tests__/account-screens.test.tsx
git commit -m "feat: confirm password at registration with show-password eyes"
```

---

### Task 3: Rename affordance + editing-state reset + manual pass

**Files:**
- Modify: `frontend/components/settings/AccountSection.tsx` (rename Input props; reset block in the fetch effect)
- Test: `frontend/__tests__/account-section.test.tsx` (three new tests)
- Modify: `docs/TESTING.md` (extend the "Beta polish (manual pass)" section)

**Interfaces:**
- Consumes: Task 1's `autoFocus`/`tone` props; existing `renameHousehold` mock already in the test file.

- [ ] **Step 1: Failing tests.** Append inside `describe('AccountSection signed in', …)` of `frontend/__tests__/account-section.test.tsx`:

```tsx
  it('the rename input auto-focuses', async () => {
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByLabelText('Rename'));
    expect(screen.getByTestId('rename-input').props.autoFocus).toBe(true);
  });

  it('a household switch closes an in-progress rename', async () => {
    render(<AccountSection />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText('Rename'));
    expect(screen.getByTestId('rename-input')).toBeOnTheScreen();

    useSessionMock.mockReturnValue({ ...signedIn, householdId: 'household-2' });
    getHouseholdMock.mockResolvedValue({
      id: 'household-2',
      name: 'Hytta',
      joinCode: 'GHI-JKL',
      members: [],
    });
    listHouseholdsMock.mockResolvedValue([
      { ...summaries[0], isActive: false },
      { ...summaries[1], isActive: true },
    ]);
    screen.rerender(<AccountSection />);
    await act(async () => {});

    expect(screen.queryByTestId('rename-input')).toBeNull();
    expect(renameHouseholdMock).not.toHaveBeenCalled();
  });

  it('create and join stay revealed when the API fails', async () => {
    createHouseholdMock.mockRejectedValueOnce(new ApiError(400, null));
    joinHouseholdMock.mockRejectedValueOnce(new ApiError(404, null));
    render(<AccountSection />);
    await act(async () => {});

    fireEvent.press(screen.getByText('+ New household'));
    fireEvent.changeText(screen.getByTestId('create-household-input'), 'Hytta');
    await act(async () => {
      fireEvent.press(screen.getByText('Create'));
    });
    expect(screen.getByTestId('create-household-input')).toBeOnTheScreen();
    expect(screen.getByText('Give the household a name.')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Join with code'));
    fireEvent.changeText(screen.getByTestId('join-code-input'), 'ABC-DEF');
    await act(async () => {
      fireEvent.press(screen.getByText('Join'));
    });
    expect(screen.getByTestId('join-code-input')).toBeOnTheScreen();
    expect(screen.getByText('No household with that code.')).toBeOnTheScreen();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx jest __tests__/account-section.test.tsx`
Expected: `the rename input auto-focuses` FAILS (`autoFocus` undefined); `a household switch closes an in-progress rename` FAILS (input still rendered). `create and join stay revealed…` PASSES already (the code is correct today; the test exists to kill the deferred mutant — note this in the report, it is expected).

- [ ] **Step 3: Implement.** In `AccountSection.tsx`:

(a) The fetch `useEffect` (keyed `[signedIn, session.householdId]`) resets all transient editing state at the top of every run — insert as its first lines:

```tsx
  useEffect(() => {
    // Any session/household transition invalidates in-progress edits: a
    // rename left open across a switch would rename the WRONG household.
    setRenaming(false);
    setRenameValue('');
    setRevealCreate(false);
    setRevealJoin(false);
    setCreateName('');
    setJoinCode('');
    if (!signedIn) {
```

(b) The rename Input gains two props:

```tsx
                    <Input
                      testID="rename-input"
                      value={renameValue}
                      onChangeText={setRenameValue}
                      autoFocus
                      tone="cream"
                    />
```

- [ ] **Step 4: Kill-proof the reset, then run the gates.** Mutation check: temporarily DELETE the six reset lines, run `npx jest __tests__/account-section.test.tsx`, and confirm `a household switch closes an in-progress rename` FAILS (the mutant is killed). Restore the lines, confirm the suite is green again, and record both runs in your report.

Run: `cd frontend && npx jest && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 5: Append to `docs/TESTING.md`'s "## Beta polish (manual pass)" section** (three new bullets at its end):

```markdown
- Register: the eye toggles visibility on both password fields; mismatched
  passwords show "Passordene er ikke like." and no account is created; the
  sign-in password field has the eye too.
- Rename: tapping ✎ opens the keyboard with the cursor at the end of the
  name, and the field is visibly distinct (cream with a clay border) from
  the linen card behind it.
- Start a rename, then switch household — the editor closes and nothing is
  renamed.
```

- [ ] **Step 6: Commit**

```bash
git add frontend/components/settings/AccountSection.tsx frontend/__tests__/account-section.test.tsx docs/TESTING.md
git commit -m "fix: focused, visible rename input; reset editing state on household transitions"
```

---

## Post-merge rollout (operator checklist — not plan tasks)

1. `npm run publish:beta` — everything in this slice is JS-only; both phones pick it up OTA (Android needs the double cold-start).
2. Run the extended TESTING.md "Beta polish" manual bullets on a phone.
