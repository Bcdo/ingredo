# Language Setting — Design Spec

**Date:** 2026-07-18
**Slice:** Small frontend feature; second row of the settings modal, sibling to the colour-mode setting (spec `2026-07-17-color-mode-setting-design.md`, whose patterns this mirrors deliberately).
**Scope:** A user-facing language preference — Norsk / English / System — persisted locally and applied instantly via a root remount, housed in the existing settings screen.
**Builds on:** settings key-value table + repository patterns (`unit_system`, `color_mode`); `lib/i18n` (`i18n-js` instance, `t`, `currentLocale`); the settings modal (`app/settings.tsx`, `SegmentedControl`); the root layout's migrations-ready apply effect.

## Goals

- Choose the app language independently of the device: force Norwegian, force English, or follow the system (bilingual requirement; a Norwegian phone owner may still want the app in English and vice versa).
- The switch applies instantly and completely — every visible string, quantity format, and date label — with no restart.
- Structure that accepts a third language later without redesign (add a locale file + one segment).

## Non-goals (deferred)

| Deferred item | Why / comes with |
|---|---|
| Syncing the preference | Never — device-local like `color_mode`; future sync must exclude the `language` key |
| Seamless in-place switch (no navigation reset) | Rejected in brainstorm: touches every screen for a twice-ever action; the remount is the accepted trade-off |
| Translating user content (recipe titles, notes) | User data is user data |
| Third language | Structure-ready, not built |

## Key decisions

1. **Stored under a `language` key** in the settings table: `LanguageMode = 'nb' | 'en' | 'system'`, default and unknown-value fallback `'system'`. Repository functions mirror `getColorMode`/`setColorMode` exactly. Device-local; commented as sync-excluded.
2. **`lib/locale.ts` owns application.** `applyLanguageMode(mode)` resolves the effective locale — `'system'` → device (`getLocales()[0]?.languageCode`, `nb*` → `'nb'`, else `'en'`); `'nb'`/`'en'` pass through — assigns `i18n.locale`, and bumps a version counter in a module-level subscribable store (listener set + `useSyncExternalStore`-compatible `subscribe`/`getSnapshot`). `useLocaleVersion()` hook exported for the root layout. Only this module mutates `i18n.locale` post-startup; `lib/i18n`'s startup initialization stays as the pre-DB default.
3. **Instant apply = root remount.** The root layout reads `useLocaleVersion()` and keys the themed content `<View key={localeVersion}>` that wraps the `<Stack>`. A bump remounts the navigation tree: every screen re-renders in the new language, navigation resets to the initial route (Today), and the settings modal closes — the accepted UX for a language switch. Colour-mode vars injection is unaffected (same View, re-created with the same style).
4. **Startup apply on migrations-ready,** in the same effect that applies the stored colour mode: `applyLanguageMode(getLanguageMode(db))`. At startup the bump remounts a tree the user hasn't meaningfully seen yet; the pre-DB frames use the device locale, which is also the default preference, so a visible startup language flip only occurs when an override is stored on a differently-configured device — brief and correct.
5. **Settings UI: a Language section under Appearance.** Section label `t('settings.language')`; `SegmentedControl<LanguageMode>` with segments **Norsk · English · System**. Language names are intentionally untranslated (identical values in both locale files — you must be able to find your language while the UI is in the wrong one); the System label reuses the translated word via its own key. `onSelect`: `setLanguageMode(db, mode)` then `applyLanguageMode(mode)` — no local state needed beyond the initial `useState(() => getLanguageMode(db))`, since the remount rebuilds the screen anyway if it's ever reopened.
6. **Locale-dependent formatting follows automatically.** `currentLocale()` reads `i18n.locale`, so decimal-comma quantity formatting and date labels pick up the override with zero changes — asserted by test.

## Components

### `lib/db/settings.ts` (modified)

- `export type LanguageMode = 'nb' | 'en' | 'system'`.
- `getLanguageMode(db): LanguageMode` — `'nb'`/`'en'` pass through, anything else → `'system'`.
- `setLanguageMode(db, mode): void` — upsert, same shape as `setColorMode`.

### `lib/locale.ts` (new)

- `applyLanguageMode(mode: LanguageMode): void` — decision 2.
- `useLocaleVersion(): number` — `useSyncExternalStore` over the module store.
- (Internal: `subscribe`, version counter; nothing else exported.)

### `app/_layout.tsx` (modified)

- Migrations-ready effect additionally calls `applyLanguageMode(getLanguageMode(db))`.
- `const localeVersion = useLocaleVersion();` and `key={localeVersion}` on the themed content `<View>` wrapping the `<Stack>`. (The error/loading branches don't need the key.)

### `app/settings.tsx` (modified)

- Language section under Appearance per decision 5.

### i18n (`en.json` / `nb.json`)

- `settings.language`: "Language" / "Språk"
- `settings.languageNorwegian`: "Norsk" / "Norsk"
- `settings.languageEnglish`: "English" / "English"
- `settings.languageSystem`: "System" / "System"

## Error handling

Synchronous SQLite writes throw per app pattern; `applyLanguageMode` cannot fail meaningfully (unknown device locale falls back to `'en'` via the existing resolution).

## Testing

- Repository: default `'system'`; nb/en round-trip; garbage stored value → `'system'`.
- `lib/locale.ts`: `applyLanguageMode('nb')` sets `i18n.locale` to `'nb'` and `currentLocale()` agrees; `'system'` resolves the (mocked) device locale; each apply bumps the version (subscribe/getSnapshot exercised directly, no component needed).
- Settings screen: Language section renders all three options with the stored mode selected; selecting writes the DB and calls `applyLanguageMode`. (Existing appearance tests unaffected.)
- Root layout remount wiring: manual checklist (no root-layout test file exists — same precedent as colour mode).
- i18n parity covers the new keys automatically.
- Full pass: suite, lint zero warnings, `tsc`, android bundle export; manual checklist appended to `docs/TESTING.md` (switch nb ↔ en ↔ system live, modal closes and Today shows the new language, decimal comma follows, persists across relaunch, system follows device setting).

## Rollout

Feature branch `feature/language-setting` off `develop`, merged per the usual flow. Theme branches unaffected (no rebase needed).
