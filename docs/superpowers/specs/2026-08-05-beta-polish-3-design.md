# Beta Polish Round 3 — Design

**Date:** 2026-08-05
**Source:** Beta testing feedback round 2 (tester items 1–5).

## Scope

Four in-app changes plus one roadmap decision:

1. Version line at the bottom of the Settings screen.
2. Auto-hyphen formatting for all `ABC-DEF` code inputs.
3. Visual hierarchy for Settings sections (account vs. households vs. the rest).
4. Shopping-list snapshot card on the Today screen.
5. Home-screen shopping-list widget: **deferred to post-beta** (out of scope here).

## 1. Version line in Settings

### Versioning scheme

- `version` in `frontend/app.config.ts` changes from `'1.0.0'` to `'0.1.0'`.
  Semantic versioning: `0.x.y` signals pre-launch; bump the minor for each
  meaningful beta release, go to `1.0.0` at launch. No `-beta` suffix — iOS
  bundle versions must be plain `X.Y.Z` once native builds happen, and a `0`
  major already says "beta".
- `android.versionCode` is unrelated (native build counter) and stays as is.

### Build info snapshot

`app.config.ts` adds to `extra`:

```ts
build: {
  gitHash: <short git hash or null>,
}
```

- Computed at config-evaluation time via `child_process.execSync('git rev-parse --short HEAD')`,
  wrapped in try/catch → `null` if git is unavailable. Because `eas update`
  (the `publish:beta` script) evaluates `app.config.ts` at publish time, every
  published update snapshots the hash of the commit it was published from. In
  local dev it reflects the current checkout.
- No date/timestamp — the hash is the ground truth for "which update is this
  tester running".

### Display

At the very bottom of the Settings `ScrollView` (after the Habits link), a
single centered line in small muted text (`font-body text-xs text-ink opacity-50`
or similar):

> `Ingredo 0.1.0 · 4f2a9c1`

- Version read from `Constants.expoConfig.version` (expo-constants, already a
  dependency); hash from `Constants.expoConfig.extra.build.gitHash`.
- When the hash is `null`, show just `Ingredo 0.1.0`.
- The word "Ingredo" needs no translation; the line has no label, so no new
  i18n strings are required here.

## 2. Auto-hyphen code input

New component `frontend/components/ui/CodeInput.tsx`, a thin wrapper around
the existing `Input`, replacing the plain `Input` in the three `ABC-DEF`
entry points:

- Join-household input in `components/settings/AccountSection.tsx`
- Invite-code input in `app/account/register.tsx`
- Reset-code input in `app/account/reset.tsx`

### Behavior

Formatting is a pure function `formatCode(next: string, previous: string): string`:

- Uppercase; strip every character that is not `A–Z` or `2–9` (mirrors the
  backend alphabet loosely — exact alphabet membership is NOT enforced
  client-side; the server remains the validator).
- Truncate to 6 significant characters; render as `XXX-YYY` (hyphen inserted
  after the 3rd character), max rendered length 7.
- **Typing forward:** after the 3rd character the hyphen appears automatically
  (`ABC` + `d` → `ABC-D`; typing exactly 3 chars shows `ABC-` so the user can
  continue straight into the second triplet).
- **Deleting:** when the new raw value is shorter than the previous rendered
  value, never auto-append a trailing hyphen — `ABC-` →(backspace)→ `ABC`
  →(backspace)→ `AB`. No hyphen fighting.
- **Paste:** any format normalizes (`abcdef`, `ABC-DEF`, `abc def` → `ABC-DEF`).

The component keeps `Input`'s API (label, testID, className, etc.), forces
`autoCapitalize="characters"`, `autoCorrect={false}`, `maxLength={7}`.
Parents keep holding the rendered value in state; submission paths are
unchanged — the backend's `JoinCodeGenerator.Canonicalize` already strips
hyphens and spaces, so no API changes.

## 3. Settings screen hierarchy

Problem: `AccountSection` runs account info and households together in one
block; "Households" is styled like body text; sections sit too close.

### Changes

- New `frontend/components/ui/SectionHeader.tsx`: uppercase, `text-xs`,
  wide letter-spacing, muted ink (e.g. `font-body-bold text-xs uppercase
  tracking-wider text-ink opacity-60`). One consistent header level for all
  Settings sections.
- Sections on the Settings screen, each introduced by a `SectionHeader`:
  **Account**, **Households**, **Appearance**, **Language**, plus the Habits
  link row (header optional there — the row is its own affordance; decision:
  no header, but it gets the same section spacing).
- The households UI moves out of `AccountSection` into a new
  `components/settings/HouseholdsSection.tsx` (household list, share code,
  rename, leave, create/join and their state/handlers), leaving
  `AccountSection` with email, sign out, and sync status/now. Pure
  reorganization — no behavior change.
- Spacing: consistent gap between sections of roughly double the current one
  (`pt-8` instead of `pt-6`/`pt-2` mid-list), so groups read as groups.
- The version line from §1 sits below everything, visually a footer rather
  than a section.
- Existing i18n keys `account.title` / `account.householdsTitle` are reused
  for the two new headers (values may need case tweaks since headers render
  uppercase via styling, not via translated strings).

## 4. Today screen: shopping-list card

Below the Tonight/Tomorrow groups on `app/(tabs)/index.tsx`, one pressable
card:

```
┌──────────────────────────────┐
│ Shopping list             ›  │
│ 5 items to buy               │
│ Milk, bread, tomatoes…       │
└──────────────────────────────┘
```

- **Data:** live query over `shoppingItems` where `status = 'active'`,
  not deleted, in the active household (same predicate helpers as the other
  tabs). Count = number of such rows; preview = first 3 names in the Shop
  tab's display order, joined with `", "`, ellipsis when more than 3 remain.
- **Interaction:** whole card navigates to `/(tabs)/shop`. Chevron icon on
  the title row signals tappability.
- **Empty state:** when the count is 0, the card renders nothing at all — the
  Today screen stays calm when there is nothing to buy.
- **Styling:** existing `Card` component; title in the same `font-display`
  style as Tonight/Tomorrow section titles; count as body text; preview line
  muted (`opacity-70`), single line, ellipsized.
- **i18n:** new keys (Norwegian + English) for the card title and the count
  line with proper pluralization ("1 item to buy" / "5 items to buy" and the
  Norwegian equivalents). Item names come from user data and are shown as-is.

## 5. Widget — deferred (roadmap note)

Home-screen widgets are native extensions (WidgetKit / Android AppWidget) and
cannot run inside Expo Go, which is how iOS beta testers get the app today.
Shipping one requires EAS native builds, an Apple Developer account ($99/yr),
TestFlight distribution, a native widget module, and a data bridge to the
shopping list. Decision: post-beta roadmap item; the Today-screen card (§4)
covers part of the wish in-app now. Message to tester: planned, but gated on
moving to app-store distribution.

## Error handling

- Git-hash lookup failure at config time → `null` → version line without hash.
  Never throws at publish or app start.
- Code input performs no validation beyond formatting; server errors surface
  through the existing per-screen error paths.
- Shopping card renders nothing when the household has no active items or the
  query returns nothing; no error state of its own (local SQLite queries).

## Testing

- **formatCode:** unit tests — typing progression (3rd char adds hyphen),
  deletion (no hyphen re-append), paste normalization, junk stripping,
  truncation.
- **CodeInput:** component test — typing `abcdef` renders `ABC-DEF`;
  backspace sequence works.
- **Settings:** existing tests updated for the split sections/headers; new
  assertion that the version line renders with mocked Constants.
- **Today card:** component tests — count + preview with seeded rows; hidden
  at zero active items; purchased/deleted items excluded; navigation target.
- Full existing Jest suite stays green.

## Out of scope

- Widget implementation and any distribution changes.
- Version bump automation (bumping stays manual, by design).
- Any backend changes.
