# Household Switcher & Recipe Copy — Design Spec

**Date:** 2026-07-28
**Slice:** multi-household slice ④ (see `2026-07-27-multi-household-architecture.md`). The visible slice, and the last of the umbrella: the Account section becomes the household switcher, and recipes gain an explicit copy-to-household action.
**Scope:** API-layer functions for slice ①'s plural endpoints, switcher UI in the Account section, copy-recipe action + repo function, new bilingual strings, TESTING.md rewrite. No backend changes; no sync-engine changes.
**Builds on:** slice ① (`GET/POST /api/v1/households`, `POST /api/v1/households/switch` — create/switch return an `AuthResponse` with the target household active; leave lands on the oldest other membership, else a fresh personal household; sole-member-no-other-membership leave → 409), slice ② (partitioned local data, active-household store follows the session), slice ③ (per-household cursors; a household change triggers a prompt sync; switch moves nothing), the house UI patterns (`AccountSection` layout, `Alert.alert` confirms, `t()` i18n with nb/en key-parity test, `ApiError` status mapping).

## Goals

- A user switches, creates, joins, and leaves households from the Account section; the active household is visibly marked; all data reactions (partition swap, sync, realtime) come from the existing `applyAuthResponse` chain.
- A recipe can be explicitly copied into another household the user belongs to — a re-minted local copy that syncs when that household is next active. No implicit sharing.
- Every new string ships in Norwegian and English; stale single-household copy (leave dialog, leave-409 message) is corrected.

## Non-goals (deferred/decided)

| Item | Status |
|---|---|
| Copying plans/shopping items across households | Not planned (recipes only, umbrella decision 5) |
| Local cache of the membership list (offline switcher) | Deferred — the picker needs the network; the copy itself is local |
| Rename/regenerate-code UI, ownership transfer | Not planned (unchanged from today) |
| Backlog M1 (cold-start double pull), M2 (transactional adoption) | Stay backlog — slice ③ internals |

## Key decisions

1. **API layer in `lib/api/auth.ts`** (house pattern — one auth/household API module): `HouseholdSummaryDto = { id, name, joinCode, memberCount, role, isActive }` in `types.ts`; `listHouseholds(): Promise<HouseholdSummaryDto[]>` (`GET /api/v1/households`); `createHousehold(name: string)` (`POST /api/v1/households`, applies the `AuthResponse` — the new household becomes active); `switchHousehold(householdId: string)` (`POST /api/v1/households/switch`, applies the `AuthResponse`). No client-side membership cache: the Account section fetches on mount/household-change (as `getHousehold` does today), the copy picker fetches on press.
2. **Switcher UI in `AccountSection`**, above the existing active-household detail block: a "Your households" list — each row: name, member-count line, active marker on the active row; pressing a non-active row calls `switchHousehold` (no confirm — switching is cheap and reversible). Below the list: a create row (name `Input` + button) calling `createHousehold`; blank input disables/no-ops (the backend would 400). The existing join-by-code, share-code, members list, leave, and sign-out blocks stay; the detail block continues to show the ACTIVE household. Errors reuse the section's single error line and `ApiError` mapping. The list refetches on `session.householdId` change (same effect dependency as `getHousehold` today) — a switch/create/join/leave thus refreshes both blocks.
3. **Leave copy corrections** (same component): `account.leaveConfirmBody` rewritten to the slice ① semantics — you land in your oldest other household, or a fresh personal one when there is none; device content stays. A leave 409 gets its own message (`account.errors.leaveLastHousehold`) instead of the join-conflict text: the backend refuses only when you are the household's sole member AND have no other membership. Error mapping becomes per-action (leave uses its own mapper; join keeps today's).
4. **Recipe copy action on the detail screen** (`app/recipe/[id]/index.tsx`), alongside the existing actions: "Copy to another household…". On press: `listHouseholds()` → filter out the recipe's own partition (the screen's active `householdId`) → zero targets: show a quiet notice (`detail.copyNoTargets`); one-or-more: native `Alert.alert` picker (one button per household, plus cancel — house confirm pattern). Picking a target runs `copyRecipeToHousehold` and shows a transient confirmation (`detail.copiedTo` with the household name), same inline-feedback style as the screen's existing add-to-shopping-list feedback. Network failure surfaces the standard network error copy.
5. **`copyRecipeToHousehold(db, householdId, targetHouseholdId, recipeId): string | null`** in `lib/db/recipes.ts` (param order: partition after `db`; returns the fresh id, `null` when the source recipe is not in the caller's partition or tombstoned). One transaction, the established re-mint shape: read recipe + children scoped by `inHousehold(recipes, householdId)` + `notDeleted`; insert a copy with fresh ids for recipe and every child, `householdId: targetHouseholdId`, `createdAt/updatedAt = now`, `dirty: 1`. No `scheduleSync()` call — the copy is out-of-partition for the CURRENT cycle by design and uploads when the target household is next active (slice ③ scoped collect). The target id is NOT validated locally (memberships are server state); a bogus target would simply push-conflict later — unreachable via the UI, which only offers fetched memberships.
6. **New strings** — exact copy, both locales (key-parity test enforces the sets match):

   `en.json`:
   - `account.householdsTitle`: "Your households"
   - `account.activeBadge`: "Active"
   - `account.memberCount`: "%{count} members" (flat `%{count}` string — the house count idiom, e.g. `detail.servingsCount`; no pluralization objects exist in the codebase)
   - `account.createTitle`: "New household"
   - `account.createPlaceholder`: "Household name"
   - `account.createButton`: "Create"
   - `account.leaveConfirmBody` (rewrite): "You land in your oldest other household — or a fresh personal one if you have none. Nothing is deleted from this device."
   - `account.errors.leaveLastHousehold`: "You can't leave your only household."
   - `account.errors.createInvalid`: "Give the household a name."
   - `detail.copyToHousehold`: "Copy to another household…"
   - `detail.copyPickerTitle`: "Copy to which household?"
   - `detail.copyNoTargets`: "You're only in one household."
   - `detail.copiedTo`: "Copied to %{name}"

   `nb.json`:
   - `account.householdsTitle`: "Dine husholdninger"
   - `account.activeBadge`: "Aktiv"
   - `account.memberCount`: "%{count} medlemmer" (flat string, matching en)
   - `account.createTitle`: "Ny husholdning"
   - `account.createPlaceholder`: "Navn på husholdningen"
   - `account.createButton`: "Opprett"
   - `account.leaveConfirmBody` (rewrite): "Du havner i din eldste andre husholdning — eller en ny personlig hvis du ikke har noen. Ingenting slettes fra denne enheten."
   - `account.errors.leaveLastHousehold`: "Du kan ikke forlate din eneste husholdning."
   - `account.errors.createInvalid`: "Gi husholdningen et navn."
   - `detail.copyToHousehold`: "Kopier til en annen husholdning …"
   - `detail.copyPickerTitle`: "Kopier til hvilken husholdning?"
   - `detail.copyNoTargets`: "Du er bare i én husholdning."
   - `detail.copiedTo`: "Kopiert til %{name}"
7. **TESTING.md rewrite:** the interim join/leave-duplication note (obsolete — slice ③ retired adoption churn) is REPLACED by the multi-household manual pass: create a second household from the app, switch between them and verify content separation + incremental sync (no re-download), copy a recipe across and verify it appears after switching (and syncs), leave flows (landing household, sole-membership 409 message), two-device realtime in the same household.

## Components

- `lib/api/types.ts` (+`HouseholdSummaryDto`), `lib/api/auth.ts` (+3 functions).
- `components/settings/AccountSection.tsx` (switcher list, create row, leave copy/mapping).
- `app/recipe/[id]/index.tsx` (copy action + picker + feedback), `lib/db/recipes.ts` (+`copyRecipeToHousehold`).
- `lib/i18n/{en,nb}.json`.
- `docs/TESTING.md`.
- Tests: auth API additions (mocked fetch), AccountSection switcher/create/leave-mapping (RNTL, house mock rig), copy repo function (real db: re-mint shape, partition guard, children copied, dirty, no source mutation), detail-screen copy action (picker filtering incl. zero-target path, mocked `listHouseholds`), i18n parity (existing test enforces the new keys).

## Error handling

House pattern throughout: `ApiError` status → `t()` message on the section's error line (leave 409 gets the new mapping; create 400 → `createInvalid`; everything else falls back to network/generic). The copy picker surfaces list-fetch failures with the standard network message and does nothing destructive; `copyRecipeToHousehold` returning `null` (stale screen: recipe deleted mid-view) shows the generic error.

## Testing

Per components above. Headline flows: switch-row press applies the auth response and the visible active marker moves; create makes-and-activates; the copy action never offers the recipe's own household and the copy lands re-minted + dirty in the target partition with the source untouched.

## Rollout

Feature branch `feature/household-switcher` off `develop`. Frontend-only. Completes the multi-household umbrella — after merge, the beta trip flow is: Account → create/switch, cook, switch back. TESTING.md manual pass gates the beta announcement.
