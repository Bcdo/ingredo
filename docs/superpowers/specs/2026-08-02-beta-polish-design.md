# Beta Polish — Design Spec

**Date:** 2026-08-02
**Slice:** beta-polish — first beta-feedback batch: real app icon, settings-screen restructure + household naming, keyboard covering the notes field.
**Context:** Feedback from the first day of real beta use (Android APK against production). Three independent fixes, one slice. No schema changes; backend change is one optional DTO field. Everything must stay Expo Go-compatible (no new native modules) — the iPhone runs in Expo Go until the Apple-program milestone.

## Goals

- The app has its own icon (and splash) instead of the Expo placeholders, derived from the app's palette and typography.
- The settings screen names the user once, not three times; the first household is called "Hjem"/"Home", not the user's name; households can be renamed in-app.
- Typing in the recipe form's notes field (bottom of the form) is visible above the keyboard.

## Non-goals

- No icon variants per theme yet — the poll candidates are preserved as SVGs, wired in only if a future theme lands.
- No changes to sync, session, or household membership semantics.
- No `react-native-keyboard-controller` or other native keyboard libs (breaks Expo Go).

## Key decisions

1. **Icon = lettermark A2**: clay (`#C96B45`) Fraunces lowercase dotless "ı" on cream (`#FBF7F1`), dotted by a tilted sage (`#7D9474`) leaf with a deep-sage (`#50664A`) vein stroke. Three candidate SVGs land in `design/icons/`: `ingredo-lettermark-cream.svg` (A2 — shipped), `ingredo-lettermark-clay.svg` (A1 — cream "ı" + leaf on clay), `ingredo-list.svg` (D — clay/sage/butter checklist rows on ink `#3A322B`). A1 and D are poll material for the theme vote; regenerating assets from a different SVG is the whole re-skin path.
2. **Generated assets** (from the A2 SVG, 1024×1024): `frontend/assets/icon.png` (full-bleed cream ground); `frontend/assets/adaptive-icon.png` (mark on transparent, scaled so the whole mark fits inside the central 66% safe zone — Android crops adaptive icons to circles/squircles) with `android.adaptiveIcon.backgroundColor: '#FBF7F1'` in `app.config.ts`; `frontend/assets/splash.png` (mark centered, generous margins) with `splash.backgroundColor: '#FBF7F1'` (was `#ffffff`). `frontend/assets/favicon.png` is deleted (web platform was dropped in the deployment slice; nothing references it). Rasterization is a committed one-shot script, `frontend/scripts/generate-icons.mjs`, run manually when an SVG changes (`node scripts/generate-icons.mjs`); it uses `@resvg/resvg-js` (devDependency) with the Fraunces SemiBold TTF from the already-bundled `@expo-google-fonts/fraunces` package passed as a font file, so no system font is involved. The PNGs are committed — nothing runs at app build time.
3. **`android.versionCode` bumps 1 → 2** (new native asset ⇒ new APK). Rollout: `publish:beta` ships the JS fixes to both phones immediately; the icon appears on Android after one `build:beta` + reinstall. Expo Go on iOS always shows Expo Go's icon — ours shows up there only post-beta.
4. **First household name**: `RegisterRequest` gains optional `HouseholdName` (nullable string, trimmed; validator requires non-whitespace and ≤200 chars when present, mirroring the rename validator). Registration uses it when non-empty, else falls back to today's behavior (`DisplayName`) so older clients are unaffected. The app sends `t('account.defaultHouseholdName')` — "Hjem" (nb) / "Home" (en) — resolved from the device locale at registration time. Backend stays language-neutral.
5. **Rename uses the existing endpoint**: `PUT /api/v1/household` (`RenameRequest { Name }`, renames the ACTIVE household, any member may call it, validation already present). No new backend endpoint. Frontend gains `renameHousehold(name)` in `lib/api/auth.ts` following the existing function idiom, and refreshes the household list on success.
6. **Settings restructure (chosen mockup A — one list, active row expands)**. The signed-in `AccountSection` becomes:
   - Line 1: user email (bold) with a "Logg ut" text-link on the right (sign-out flow unchanged). The "Logget inn som" label is deleted.
   - Line 2: sync status + "Synk nå" link (unchanged content, unchanged keys).
   - **Husholdninger** section — one list, every membership is a row:
     - Non-active row: name + `memberCount` subtitle; tap switches (existing behavior, existing per-action error mapping).
     - Active row: highlighted (linen surface, clay border), expanded in place with: name + `activeBadge`; code line `codeLine` ("Kode: %{code}") + `shareCode` share-link (existing `Share.share`); members' display names joined with ", " on one line; a rename pencil (✎, `accessibilityLabel: t('account.rename')`) that swaps the name for an inline input pre-filled with the current name plus save ("Lagre") / cancel (existing `account.cancel`) — save calls `renameHousehold`, empty input shows `errors.createInvalid`, server errors reuse the existing per-action error line; and the `leave` ghost button (existing confirm dialog).
   - Below the list, two ghost buttons that each reveal an inline input + confirm button when tapped (collapsed by default, collapse again on success): "+ Ny husholdning" (`createReveal`; input reuses `createPlaceholder`, confirm reuses `createButton`, existing create flow/errors) and "Bli med med kode" (`joinReveal`; input reuses `joinPlaceholder`, confirm reuses `joinButton`, existing join flow/errors).
   - The dev-build server override field stays at the bottom, unchanged. The signed-out branch of the screen is unchanged.
7. **String changes** (both `nb.json` and `en.json`, key-parity test guards):

   | Key (`account.`) | Action | nb | en |
   |---|---|---|---|
   | `signedInAs` | delete | — | — |
   | `household` | delete (block removed) | — | — |
   | `createTitle` | delete (replaced by reveal button) | — | — |
   | `joinTitle` | delete (replaced by reveal button) | — | — |
   | `members` | delete (names shown without label) | — | — |
   | `joinCode` | delete (replaced by `codeLine`) | — | — |
   | `householdsTitle` | change | "Husholdninger" | "Households" |
   | `createReveal` | new | "+ Ny husholdning" | "+ New household" |
   | `joinReveal` | new | "Bli med med kode" | "Join with code" |
   | `codeLine` | new | "Kode: %{code}" | "Code: %{code}" |
   | `rename` | new | "Endre navn" | "Rename" |
   | `renameSave` | new | "Lagre" | "Save" |
   | `defaultHouseholdName` | new | "Hjem" | "Home" |

   All other `account.*` keys keep their current values. Deleted keys are removed from BOTH files.
8. **Keyboard fix**: `RecipeForm.tsx` and the settings screen's scroll container are wrapped in React Native's built-in `KeyboardAvoidingView` (`className="flex-1"`, `behavior="padding"` on both platforms — SDK 54's enforced Android edge-to-edge disables the old window-resize behavior, so Android needs explicit avoidance too). No other screens change: the shopping quantity editor already has its own `KeyboardAvoidingView`, and remaining inputs (sign-in/register) sit in the top half of the screen.

## Components

- `design/icons/ingredo-lettermark-cream.svg`, `ingredo-lettermark-clay.svg`, `ingredo-list.svg` (new).
- `frontend/assets/icon.png`, `adaptive-icon.png`, `splash.png` (regenerated); `favicon.png` (deleted); generation script location per plan.
- `frontend/app.config.ts` (adaptiveIcon backgroundColor, splash backgroundColor, versionCode 2).
- `backend/Ingredo.Api/Auth/AuthDtos.cs` + `AuthService.cs` + `AuthValidators.cs` (optional `HouseholdName`).
- `frontend/lib/api/auth.ts` (+`renameHousehold`), `lib/api/types.ts` if the response type needs it (existing `HouseholdResponse` shape is reused).
- `frontend/components/settings/AccountSection.tsx` (restructure), registration screen (sends `householdName`).
- `frontend/lib/i18n/nb.json` / `en.json` (table above).
- `frontend/components/RecipeForm.tsx` + settings screen file (KeyboardAvoidingView).

## Error handling

Nothing new: rename/create/join/leave/switch all surface through the existing single error line with the existing per-action mappers; rename maps validation failure to `errors.createInvalid` client-side before calling the API. Icon generation is build-time only.

## Testing

- Backend: register with `HouseholdName` → household carries it; register without → falls back to display name (existing tests keep passing); validator rejects a whitespace-only provided name.
- Frontend components: active-row expansion renders code line, members line, rename pencil; rename flow — pencil→input prefilled→save calls `PUT` and refreshes; empty save shows `createInvalid` without a request; reveal buttons render collapsed by default, reveal on tap, collapse after successful create/join; existing switch/leave/create/join tests adapted to the new structure with their kill-proven mutation assertions preserved.
- i18n: key-parity test enforces the string table lands in both locales.
- `app-config.test.ts`: extended to pin `android.versionCode` 2, adaptiveIcon backgroundColor, splash backgroundColor.
- Icon PNGs: presence + dimensions asserted by a lightweight test reading PNG headers (no pixel assertions).
- Manual (TESTING.md): notes field stays visible while typing on the recipe form (Android APK + iPhone Expo Go); icon visible after APK reinstall.

## Rollout

Feature branch `feature/beta-polish` off `develop`, subagent-driven. After merge: `publish:beta` (settings + keyboard + naming reach both phones as an OTA update), then `build:beta` → reinstall APK on Android for the icon. Existing "Bjørnar"-named households: the user renames them in-app via the new pencil — no operator surgery.
