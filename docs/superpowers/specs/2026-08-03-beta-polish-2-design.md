# Beta Polish 2 — Design Spec

**Date:** 2026-08-03
**Slice:** beta-polish-2 — second beta-feedback batch: password confidence at registration (eye toggle + confirm field), visible/focused rename input, and the rename/reveal state-reset fixes deferred from the beta-polish final review.
**Context:** Frontend-only; ships to both phones via `publish:beta` (no native changes, no new APK). No backend or schema changes. Passwords have no reset flow during beta (operator DB surgery), which motivates "both" on the typo guards.

## Goals

- A user creating an account can see what they typed (eye toggle) AND is caught by a confirm field if the two entries differ.
- The rename field on the settings screen is visibly an input (contrast against its linen card) and focuses immediately with the keyboard open and the cursor at the end.
- Switching household or signing out clears any in-progress rename/reveal editing state (closes the "switch mid-rename renames the wrong household" edge from the beta-polish final review).

## Non-goals

- No password strength rules beyond the backend's existing ≥8 length; no reset flow (deferred to pre-public-exposure).
- No visual redesign of `Input` defaults — `tone` is opt-in; every existing call site keeps today's look.

## Key decisions

1. **`Input` gains three opt-in props** (`frontend/components/ui/Input.tsx`):
   - `secureToggle?: boolean` — only meaningful with `secureTextEntry`. Renders an Ionicons eye (`eye-outline` when hidden, `eye-off-outline` when shown) as a `Pressable` inside the field's right edge; pressing flips an internal "revealed" state that overrides `secureTextEntry`. `accessibilityLabel` is `t('account.showPassword')` when hidden and `t('account.hidePassword')` when revealed. The TextInput gets right padding so text never runs under the icon.
   - `autoFocus?: boolean` — passed through to the native `TextInput`. RN focuses on mount with the cursor at the end of the initial value; keyboard opens.
   - `tone?: 'linen' | 'cream'` — default `'linen'` (today's `bg-linen`, unchanged everywhere). `'cream'` renders `bg-cream` with `border border-clay`, for inputs sitting on linen surfaces.
2. **Registration** (`frontend/app/account/register.tsx`): the password field gets `secureToggle`. A new confirm field ("Bekreft passord"/"Confirm password", its own `secureToggle`) sits below it. Submit first checks `password !== confirm` → sets the error line to `account.errors.passwordMismatch` and does NOT call the API; the check runs before `setBusy`. Everything else (trim, error mapping, default household name) unchanged.
3. **Sign-in** (`frontend/app/account/sign-in.tsx`): the password field gets `secureToggle` — same component prop, consistency for free. No confirm field.
4. **Rename input** (`frontend/components/settings/AccountSection.tsx`): becomes `tone="cream"` + `autoFocus`. No other rename behavior changes.
5. **Editing-state reset:** the existing `useEffect` keyed on `[signedIn, session.householdId]` additionally resets ALL transient editing state at the start of every run: `renaming → false`, `renameValue → ''`, `revealCreate → false`, `revealJoin → false`, `createName → ''`, `joinCode → ''`. This covers both the sign-out branch and every household change (join/leave/switch/rename-driven refetches keep `householdId` stable except switch/leave/join, which are exactly the transitions that must clear state). The rename-success path already closes the editor itself.
6. **Strings** (both `nb.json` and `en.json`; key-parity test enforces):

   | Key (`account.`) | nb | en |
   |---|---|---|
   | `confirmPassword` | "Bekreft passord" | "Confirm password" |
   | `showPassword` | "Vis passord" | "Show password" |
   | `hidePassword` | "Skjul passord" | "Hide password" |
   | `errors.passwordMismatch` | "Passordene er ikke like." | "Passwords don't match." |

## Components

- `frontend/components/ui/Input.tsx` (three props).
- `frontend/app/account/register.tsx` (confirm field + mismatch check + toggles).
- `frontend/app/account/sign-in.tsx` (toggle).
- `frontend/components/settings/AccountSection.tsx` (rename input tone/autoFocus; state reset in the fetch effect).
- `frontend/lib/i18n/nb.json` / `en.json` (table above).

## Error handling

Mismatch is purely client-side and clears on the next submit attempt like the screen's other errors. The eye toggle has no failure modes. Reset-on-transition throws nothing — it's synchronous state clearing.

## Testing

- `Input`: eye toggle flips the rendered `secureTextEntry` prop and its accessibility label both ways; `tone="cream"` reflected in the TextInput's classes; plain `secureTextEntry` without `secureToggle` renders no icon (existing call sites unaffected).
- Register screen: mismatched passwords → error text shown, `register` NOT called; matching passwords → called as today (existing 4-arg assertion). Confirm field present with its label.
- AccountSection: rename input carries `autoFocus` and the cream tone; NEW kill-proof reset test — start a rename, then simulate a household switch (change the mocked session's `householdId` and re-render), assert the rename input is no longer rendered and `renameHousehold` was never called; create/join reveal stay OPEN on failure (rejected promise) — closing the deferred coverage gap.
- i18n parity test covers the new keys.
- Manual (TESTING.md "Beta polish" section gains three lines): eye shows/hides the password on register and sign-in; mismatch blocks with the Norwegian error; rename opens keyboard with cursor at end and the field is visibly distinct.

## Rollout

Feature branch `feature/beta-polish-2` off `develop`, subagent-driven. After merge: `publish:beta` only (JS-only — both phones pick it up OTA; remember the Android double cold-start).
