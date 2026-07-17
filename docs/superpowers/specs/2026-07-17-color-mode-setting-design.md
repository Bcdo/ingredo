# Colour Mode Setting — Design Spec

**Date:** 2026-07-17
**Slice:** Post-MVP frontend feature on top of the runtime light/dark theme infrastructure (`c9156f6`). Lands on `develop`; the four `design/*` theme branches rebase onto it afterwards.
**Scope:** A user-facing appearance preference — Light / Dark / System — persisted locally and applied app-wide, housed in the app's first (minimal) settings screen.
**Builds on:** theme infrastructure (`lib/theme.js` palettes, `usePalette`, root-layout `vars()` injection); `settings` key-value table and its `unit_system` repository pattern.

## Goals

- The user chooses the app's colour mode independently of the device: force light, force dark, or follow the system (`DESIGN_SYSTEM.md` warmth/practicality: no digging through OS settings).
- Give future settings (units, week start, household bits from Phase 4) an obvious home without building them now.
- Immediate payoff for theme evaluation: flip modes in-app while comparing the `design/*` experiment branches.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Syncing the preference | Never — colour mode is a device-local setting; when Phase 4/5 sync exists, the `color_mode` key is excluded |
| Theme (palette) selection UI | Theme experiments stay on `design/*` branches; a winner merges into the default palettes |
| Moving unit system / week start into settings | When they earn it; the unit picker stays on recipe detail |
| Scheduled/auto dark (sunset etc.) | Not planned — "System" already inherits OS scheduling |

## Key decisions

1. **RN `Appearance.setColorScheme()` is the override mechanism.** `'light'`/`'dark'` force a scheme; `'system'` maps to `null` (follow OS). Everything downstream — `useColorScheme()`, `usePalette()`, the root-layout `vars()` injection — already listens to it, so no theme-infrastructure code changes on any branch.
2. **Stored in the existing `settings` table** under a new `color_mode` key, mirroring the `unit_system` pattern exactly. Type `ColorMode = 'light' | 'dark' | 'system'`; default and unknown-value fallback: `'system'`. No schema change.
3. **Applied when the DB becomes ready.** The settings table only exists after migrations, so the root layout applies the stored override when migration state resolves to `ready`, before the main `Stack` renders. The startup spinner may briefly render in the system scheme — accepted (it is a plain surface, visible for milliseconds).
4. **First settings screen, deliberately minimal.** New modal route `app/settings.tsx` — the same presentation as the other secondary screens — containing a header row (title + close, `RecipeForm` header pattern) and one section: an "Appearance" label above a three-segment `SegmentedControl` (generic over `'light' | 'dark' | 'system'`, reused as-is). Selecting writes the DB, calls `Appearance.setColorScheme()`, and updates local state; the app restyles live behind the modal.
5. **Entry point: gear icon on the Today tab header** (`headerRight` in the Tabs navigator options, `settings-outline` Ionicon, accessibility label, `router.push('/settings')`). Today is the launch tab; a rarely-used control belongs in its header, not in daily-use screen space.
6. **On `develop` the Light/Dark options are visually inert** (dark mirrors light there) until a theme with a real dark palette merges. Accepted rather than gating the feature; on every `design/*` branch the control is immediately meaningful.

## Components

### `lib/db/settings.ts` (modified)

- `export type ColorMode = 'light' | 'dark' | 'system'`.
- `getColorMode(db): ColorMode` — read `color_mode` key; anything but `'light'`/`'dark'` returns `'system'`.
- `setColorMode(db, mode): void` — upsert, same `onConflictDoUpdate` shape as `setUnitSystem`.

### `lib/colorMode.ts` (new, tiny)

- `applyColorMode(mode: ColorMode): void` — `Appearance.setColorScheme(mode === 'system' ? null : mode)`. One place owns the mode→scheme mapping so the root layout and the settings screen cannot drift.

### `app/_layout.tsx` (modified)

- When migration state becomes `ready`, read `getColorMode(db)` and call `applyColorMode` (effect keyed on readiness, before the main UI mounts).
- Register `settings` in the root `Stack` with `presentation: 'modal'`, `headerShown: false` — same as the other modal routes.

### `app/(tabs)/_layout.tsx` (modified)

- Today screen (`name="index"`) gains `headerRight`: a `Pressable` with `settings-outline` Ionicon (`palette.ink`), `accessibilityLabel: t('settings.open')`, pushing `/settings`.

### `app/settings.tsx` (new)

- Header row: display-font title `t('settings.title')` + close button (Ionicon `close`, `router.back()`), matching the `RecipeForm` modal header.
- Body: `t('settings.appearance')` section label; `SegmentedControl` with segments Light / Dark / System.
- State: `useState(() => getColorMode(db))`; `onSelect` → `setColorMode(db, mode)`, `applyColorMode(mode)`, update state.

### i18n (`en.json` / `nb.json`)

- `settings.title`: "Settings" / "Innstillinger"
- `settings.open`: "Open settings" / "Åpne innstillinger"
- `settings.close`: "Close settings" / "Lukk innstillinger"
- `settings.appearance`: "Appearance" / "Utseende"
- `settings.modeLight`: "Light" / "Lys"
- `settings.modeDark`: "Dark" / "Mørk"
- `settings.modeSystem`: "System" / "System"

## Error handling

Repository writes are synchronous SQLite like everything else; failures throw (RedBox in dev), matching the existing settings pattern. `applyColorMode` cannot fail meaningfully.

## Testing

- Repository tests (`settings-repository.test.ts`): default is `'system'`; light/dark round-trip; garbage stored value falls back to `'system'`.
- `lib/colorMode.ts`: mapping test — `'system'` → `setColorScheme(null)`, `'dark'` → `setColorScheme('dark')` (spy on `Appearance`).
- Settings-screen test (new): three options render with correct labels; tapping Dark calls `setColorMode` and applies the override; stored mode preselects its segment.
- Gear icon: lives in the Tabs navigator options, and unit tests render screen components, never the navigator — covered by the manual checklist instead.
- Root layout: applies the stored mode once migrations are ready (covered indirectly via the `applyColorMode` unit test plus manual pass; the root layout has no test file today and this spec doesn't add one).
- i18n parity test covers the new keys automatically.
- Full pass: suite, lint zero warnings, `tsc`, android bundle export; manual checklist appended to `docs/TESTING.md` (mode forces/follows correctly, persists across relaunch, live-restyles behind the modal, Norwegian labels).

## Rollout

Implement on `develop` (feature branch `feature/color-mode-setting`, merged per the usual flow), then rebase `design/nord-theme`, `design/kveldsmat`, `design/rosemaling`, `design/rabarbra` onto the updated `develop` so every experiment branch gains the in-app switch.
