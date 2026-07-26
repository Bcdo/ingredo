# Multi-Household — Architecture

**Date:** 2026-07-27
**Role:** Umbrella document for the multi-household project (beta feedback: "one of us leaves on a trip and wants their own list for a while — switching beats leave-and-rejoin"). Not a slice spec — the four slices below each get their own spec → plan → execution. This doc pins the decisions every slice depends on, so they are made once.
**Builds on:** the complete Phase 1–7 app: single-membership households (`HouseholdMembers.UserId` unique, deferrable), the `household` JWT claim + fail-closed guard, join-with-re-home/leave semantics, the state-based sync engine (per-device cursor, adoption via household-switch reset, conflict re-minting), the realtime hub's `household:<id>` groups, local-first SQLite with no household column.

## Decisions

1. **Active household is a per-device choice carried in the access token.** The `household` claim keeps meaning "the household this request acts on"; a new *switch* endpoint mints a fresh `AuthResponse` for any household the user belongs to (the same rotate-tokens pattern join/leave already use). The backend request path — guard, content scoping, sync endpoints, hub groups — is untouched by multi-membership beyond the guard's check tightening from "household exists" to "user is a MEMBER of the claimed household". Refresh mints for the token family's household (stored per refresh-token family), so two devices on one account can sit in different active households.
2. **Membership becomes many-to-many; join becomes additive.** The unique constraint on `HouseholdMembers.UserId` drops. Join adds a membership and re-homes NOTHING (the sole-member merge + shell-delete machinery retires); leave sheds one membership (owner promotion stays; a fresh personal household is created only when the last membership is shed). New endpoints: create household, list my households (id, name, member count, role), switch. A user always has ≥ 1 membership.
3. **The device holds ALL the user's households' data** (user decision). The three content tables gain a `household_id` column locally; `NULL` is the signed-out/local bucket. Every repository read/write and screen query scopes to the active household id (or the NULL bucket when never signed in). Signed out after use: the last-active household's rows stay visible and editable, local-first as today.
4. **Sync is per-household.** Cursor and bookkeeping key on household id (`sync_cursor.<id>`); collect gathers dirty rows OF the active household (plus the adoption of NULL-bucket rows INTO the active household on first sync); apply writes rows tagged with the pulled household. The engine syncs the ACTIVE household; switching triggers a sync of the newly-active one; background households go stale until visited (accepted — the trip case switches while online at home). **Household switch stops masquerading as adoption**: no mark-all-dirty on switch, no re-mint churn — the re-mint machinery shrinks back to true cross-household id conflicts, which additive join makes rarer still.
5. **Recipes stay household-owned; copying is explicit** (user decision). A "copy to <household>" action on a recipe creates a re-minted local copy (fresh ids for recipe + children, per the established re-mint pattern) tagged for the target household, dirty — it syncs like any new recipe. No implicit sharing across households.
6. **Migration story:** existing local rows all belong to the one household the device has synced with (`sync_household_id`) — the schema migration backfills `household_id` from it (NULL when never synced). Server-side needs no data migration (rows already carry `HouseholdId`); only the membership constraint and join semantics change.
7. **Realtime:** unchanged mechanics — the socket joins the active household's group (token claim); a switch reconnects (token rotation already triggers this via the session `householdId` change).

## The four slices

| # | Slice | Scope | Depends on |
|---|---|---|---|
| ① | Backend multi-membership | Constraint drop, additive join, leave-one, create/list/switch endpoints, membership-checking guard, per-family refresh household | — |
| ② | Frontend partitioning | `household_id` column + backfill migration, every query/repo scoped to the active household, NULL-bucket semantics | — (testable locally before ①) |
| ③ | Per-household sync | Cursor-per-household, scoped collect/adoption, tagged apply, switch-triggers-sync, retired switch-as-adoption | ①② |
| ④ | Switcher UI + recipe copy | Household list/switch/create/join-additive/leave-one in Account section, copy-recipe action | ①②③ |

Slices ① and ② are independent and can interleave; ③ is where the risk concentrates; ④ makes it visible.

## Non-goals

Syncing non-active households in the background (revisit on demand); per-household notification preferences; sharing recipes by reference (copies only); merging two households; transferring household ownership UI (owner promotion on leave stays automatic); settings remain device-local.

## Compatibility

Single-membership users see no change until they create/join a second household. The old leave-then-rejoin flow keeps working. Existing devices upgrade via the local backfill migration; existing tokens keep their claim meaning.
