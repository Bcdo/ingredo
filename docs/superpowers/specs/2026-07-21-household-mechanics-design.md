# Household Mechanics — Design Spec

**Date:** 2026-07-21
**Slice:** Phase 4 opener (roadmap: Households, shared content). Backend-only; this slice delivers the household *mechanics* — joining, members, leaving, codes — proven on the existing recipes surface. Meal-plan/shopping endpoints arrive in later slices already household-shaped.
**Scope:** Persistent 6-character join codes, join-with-content-merge for personal households, self-service leave with owner promotion, rename/regenerate open to all members, fresh token pair on membership change.
**Builds on:** authentication slice (`2026-07-19-authentication-design.md`): User/Household/HouseholdMember/HouseholdRole, the single `household` JWT claim, `AuthResponse`, household-scoped recipes; `design/DESIGN.md` §household ("joining survives a kitchen conversation", "one pool, no permissions", no pending states).

## Goals

- Two people share a kitchen in one evening: read a code off a partner's screen, join, and both pools are one pool — recipes genuinely shared through the existing scoped API with zero changes to it.
- The moment of joining works instantly (fresh tokens returned), and the couple's pre-existing recipes are all there (merge-on-join).
- No administration: no invites, approvals, kicks, or permission matrix — the design doc's "ambient, not administrative" stance, mechanically.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Meal-plan / shopping-list endpoints (shared or otherwise) | Next backend slices, household-shaped from birth |
| Kick/remove members, invite approval flows | Not planned unless real households demand moderation; leave is self-service only |
| Multi-household membership | Rejected in brainstorm — breaks the single `household` claim and "one pool" |
| Activity feed, presence, live updates | Phases 5–6 (sync, SignalR) |
| QR joining | Frontend slice later; the QR simply encodes the same join code |
| Shared household preferences (units, week start) | With their content endpoints |
| Per-member content attribution ("who added this") | Phase 5+ (sync metadata) |

## Key decisions

1. **Persistent, regeneratable join code.** `Household.JoinCode`: 6 characters from the unambiguous alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (I/L/O/0/1 excluded), stored canonically (no hyphen, uppercase), unique index, generated with a collision-retry loop. Displayed/documented as `XXX-XXX`; input accepted case-insensitively, hyphen optional. Registration mints one for the personal household. Any member may regenerate (invalidates the old code immediately). Codes gate *joining only* — never authentication.
2. **Join = membership move; content transfers only from single-member households.** `POST /household/join { code }`: the caller's membership moves to the target household. If the caller was the **sole member** of their current household, all its content (today: recipes) is re-homed to the target and the emptied household row is deleted — the couple-merging-kitchens case. If other members remain, content stays with the household (content belongs to households, not people; without per-user attribution, "their" content is only well-defined for personal households). Joining one's own household → 409. Unknown code → 404. The operation is one explicit DB transaction (mixed tracked writes + `ExecuteUpdate` re-homing).
3. **Leave = fresh personal household; content stays.** `POST /household/leave`: removes the membership, creates a new personal household (named after the caller's display name, with a fresh join code) with an `Owner` membership. Content never follows a leaver. Sole-member leave → 409 (meaningless no-op). If the leaver was the household's owner, the longest-standing remaining member (earliest `CreatedAt`, id as tiebreak) is promoted to `Owner` (the same promotion applies when an owner departs via *join* — any departure from a shared household, not only explicit leave) — the entirety of role *enforcement* this slice; role otherwise remains display data.
4. **Membership changes return a fresh token pair.** Join and leave respond with the same `AuthResponse` shape as login (new access token carrying the new `household` claim + a new refresh-token family). The requesting client is correct instantly; a user's other devices self-correct within the 15-minute access-token lifetime (accepted staleness, unchanged from the auth spec's claim reasoning). Old refresh tokens remain valid (they are user-bound, not household-bound).
5. **Rename and regenerate are any-member actions.** `PUT /household { name }` and `POST /household/regenerate-code` require membership, nothing more — "anyone edits anything." Validation: name non-blank ≤ 200.
6. **Endpoints (`/api/v1/household`, all `[Authorize]`, "the caller's household"):**
   - `GET /household` → `{ id, name, joinCode, members: [{ userId, displayName, role, joinedAt }] }` (members ordered by joinedAt).
   - `PUT /household` `{ name }` → 200 updated view; 400 validation.
   - `POST /household/regenerate-code` → 200 updated view (new code).
   - `POST /household/join` `{ code }` → 200 `AuthResponse`; 404 unknown code; 409 own household.
   - `POST /household/leave` → 200 `AuthResponse`; 409 sole member.
7. **The recipes API is untouched.** Sharing emerges purely from scoping: after a join, both members' tokens carry the same `household` claim and the existing queries do the rest. Integration tests prove it end-to-end (Kari's pre-join recipe visible to Ola; Ola's to Kari; a leaver loses access; remaining members keep it).
8. **House patterns throughout.** `HouseholdController` + `IHouseholdService`/`HouseholdService` returning `ServiceResult`; FluentValidation in the controller; ProblemDetails untouched; zero-warning/green-suite bar; Testcontainers integration tests plus a code-generator unit-test file (alphabet, length, canonicalization, collision retry).

## Components

### `backend/Ingredo.Api/Domain/` (modified)

- `Household` gains `required string JoinCode` (canonical 6 chars).

### `backend/Ingredo.Api/Data/`

- `AppDbContext`: `JoinCode` max length 6, unique index; migration `AddJoinCodes` (disposable dev data — `down -v` path documented, as before).

### `backend/Ingredo.Api/Households/` (new feature folder)

- `HouseholdController`, `IHouseholdService`/`HouseholdService` (view/rename/regenerate/join/leave; owns the transfer transaction and owner promotion), `JoinCodeGenerator` (alphabet, canonicalize, generate-with-retry), DTOs (`HouseholdResponse`, `MemberResponse`, `RenameRequest`, `JoinRequest`), validators.
- `AuthService.RegisterAsync` gains join-code minting (via `JoinCodeGenerator`); join/leave reuse its token-issuing path (small refactor: extract the token-pair issuance used by login so household moves can call it).

### `backend/Ingredo.Api.Tests/`

- `Integration/HouseholdApiTests.cs` (the scenario suite from decision 8 / goals), `Households/JoinCodeGeneratorTests.cs`; no changes to existing auth tests were needed.

### Infra / docs

- README household section; `docs/TESTING.md` manual checklist (two-user join/merge walk via Scalar).

## Error handling

House pattern: expected outcomes as `ServiceResult` (`NotFound` → 404 unknown code, `Conflict` → 409 own-household/sole-member), validation 400s, everything else the global middleware. No information leak: an unknown join code is indistinguishable from a nonexistent one (both 404; codes are not practically enumerable — 31⁶ ≈ 9×10⁸ space (31-character alphabet), and the join endpoint sits behind authentication).

## Testing

Integration (Testcontainers, `[Collection("Api")]`): merge-on-join both directions; sole-member household deleted after join; join from a shared household leaves content behind; own-code 409; unknown code 404; leave creates a working personal household and strips access to the old pool; sole-member leave 409; owner-leave promotes the longest-standing member; rename and regenerated code visible to the other member; regenerated code kills the old one; join/leave token pairs work immediately (used for a follow-up request in-test). Unit: `JoinCodeGenerator` matrix. Full pass incl. compose smoke.

## Rollout

Feature branch `feature/household-mechanics` off `develop`, merged per the usual flow. Existing compose volumes need the documented `down -v` reset (new non-null `JoinCode`).
