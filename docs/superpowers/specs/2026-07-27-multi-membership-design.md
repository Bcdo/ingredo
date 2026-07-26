# Backend Multi-Membership — Design Spec

**Date:** 2026-07-27
**Slice:** multi-household slice ① (see `2026-07-27-multi-household-architecture.md`). The backend half: a user can belong to many households, pick which one a device acts on, and create/join/leave them independently — while every existing request path keeps its meaning.
**Scope:** membership constraint change, additive join, leave-one semantics, create/list/switch endpoints, membership-checking guard, per-token-family active household. No content or sync changes.
**Builds on:** the household domain (join codes, owner promotion, deferrable unique membership), the token scheme (15-min access with `household` claim, rotating refresh families), the fail-closed `HouseholdGuardMiddleware`, the `ServiceResult` + validator house patterns, the `IChangeNotifier` seam.

## Goals

- A user holds N memberships; each device independently chooses its active household; all existing endpoints (content, sync, hub) keep operating on the token's household claim unchanged.
- Join adds — nothing re-homes, nothing is deleted. Leave sheds one membership. The trip flow is: create household → it becomes active → use it → switch back.
- Existing single-household users and flows (incl. leave-then-rejoin) behave identically until a second membership exists.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Frontend partitioning / per-household sync / switcher UI | Slices ②–④ |
| Recipe copying | Slice ④ (uses plain content endpoints) |
| Merging households, ownership-transfer UI | Not planned (owner promotion on leave stays automatic) |
| Retiring the re-home machinery's frontend counterpart (remint on switch) | Slice ③ |
| Background sync of non-active households | Umbrella non-goal |

## Key decisions

1. **Membership becomes many-to-many.** The deferrable unique constraint on `HouseholdMembers.UserId` is replaced by unique `(UserId, HouseholdId)`. `Role` semantics unchanged (owner promotion on any departure). A user always has ≥ 1 membership (registration's personal household; enforced by leave semantics below).
2. **The active household lives on the refresh-token family.** `RefreshTokens` gains `HouseholdId` (backfilled from each user's current single membership). Refresh mints the access token's `household` claim from the family; login uses the user's OLDEST membership (deterministic — in practice the personal household); switch/create/join/leave rotate the family to the new active household and return a fresh `AuthResponse`. Two devices = two families = independent active households.
3. **Guard checks membership, not existence.** `HouseholdGuardMiddleware`'s query becomes "does a membership row (claim household, token sub) exist" — a token for a household you left is dead everywhere except the anonymous refresh escape hatch, exactly like today's dead-household tokens. Existing guard tests keep passing (single-membership setups satisfy both predicates); new tests cover the left-household case.
4. **Join is additive.** `JoinAsync` adds a membership (409 on already-a-member, 404 on bad code as today) and returns an `AuthResponse` with the JOINED household active. The sole-member content merge, `ExecuteUpdate` re-home, and shell-delete machinery are REMOVED — your other households simply persist. (Server content of the vacated-personal-household era no longer moves; slice ③/④ owns any content movement via explicit copying.)
5. **Leave sheds one membership — the ACTIVE one.** `LeaveAsync`: remove the membership named by the token claim; owner promotion for the remaining members as today; the household itself is deleted only when it has NO members left (replacing the sole-member shell delete — same outcome for the personal-household case). Response: `AuthResponse` with the user's oldest REMAINING membership active; if none remain, a fresh personal household is created first (today's behavior). Conflict cases (last owner with members present) keep today's rules.
6. **New endpoints** (house patterns: controller → service → `ServiceResult`, FluentValidation, notify seam untouched):
   - `POST /api/v1/households` — create; body `{name}` (validated like rename); creator becomes owner; returns `AuthResponse` with the new household ACTIVE (the trip flow's first half).
   - `GET /api/v1/households` — list my memberships: `[{id, name, joinCode, memberCount, role, isActive}]`. `joinCode` stays visible to every member (any member can already share it today via `GET /household`); `isActive` = matches the token claim.
   - `POST /api/v1/households/switch` — body `{householdId}`; 404 when not a member; returns `AuthResponse` with that household active.
   The singular `/api/v1/household` surface (get/rename/regenerate-code/join/leave) keeps acting on the ACTIVE household.
7. **Sync/realtime interplay (already correct by construction):** sync endpoints scope by the claim; the hub joins the claim's group; a switch rotates tokens → the client reconnects into the new group. The frontend engine (slice ③) will stop treating switches as adoption; until then the CURRENT frontend still works: its switch-as-adoption path handles active-household changes exactly as it handles join/leave today (re-mint convergence), just wastefully — acceptable for the interim since nothing user-facing switches until slice ④.
8. **Migration:** EF migration drops the old unique index, adds `(UserId, HouseholdId)` unique, adds `RefreshTokens.HouseholdId` (non-null, backfilled via SQL from each token's user's single membership; new families always set it). Compose volumes migrate in place.
9. **Testing:** integration on the existing rig — multi-membership CRUD isolation (same user, two households, content scoped per claim); join-is-additive (both households retain content; old sole-member merge tests updated to the new semantics — the REMOVED re-home behavior's tests are replaced, not deleted silently); leave-active with remaining membership / with none (fresh personal); switch happy + not-a-member 404; login-oldest-membership; refresh-preserves-family-household across rotation; guard rejects left-household tokens incl. via the sync endpoints and hub connect; create-returns-active. The slice-② realtime test (join re-home SyncSeq proof) is retired WITH a replacement asserting the new invariant: join moves nothing (SyncSeq/content unchanged in both households).

## Components

- `Domain/RefreshToken.cs` (+HouseholdId), `Data/AppDbContext.cs` + migration `MultiMembership`.
- `Households/`: `HouseholdService` (join/leave rewrites, create/list/switch), `HouseholdsController` (new plural endpoints), DTOs (`HouseholdSummaryResponse`, `CreateHouseholdRequest`, `SwitchHouseholdRequest`) + validators.
- `Auth/`: `TokenService`/`AuthService` — family household on mint/refresh/login.
- `Common/HouseholdGuardMiddleware.cs` — membership predicate.
- Tests: `Integration/MultiMembershipTests.cs` + surgical updates to `HouseholdApiTests`/`HouseholdGuardTests`/`RealtimeTests`.
- Docs: README households section; TESTING.md manual pass.

## Error handling

House pattern. Switch/create/leave failures map onto existing `ServiceResult` statuses; no new error shapes.

## Testing

Per decision 9. Headline invariants: a claim without a membership is dead everywhere; join moves nothing; two families on one account hold different active households simultaneously.

## Rollout

Feature branch `feature/multi-membership` off `develop`. Compose migrates in place (`down -v` NOT required). Frontend untouched and fully compatible (it exercises only the singular surface until slice ④).
