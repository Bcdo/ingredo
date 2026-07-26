# Backend Multi-Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user belongs to N households; each device picks its active one (carried on the refresh-token family); join adds, leave sheds one, create/list/switch endpoints exist — with every existing request path keeping its meaning.

**Architecture:** `RefreshTokens` gains `HouseholdId` so refresh mints the family's active household; the guard's predicate tightens from household-exists to membership-exists; `JoinAsync` loses the re-home/shell-delete machinery (additive membership only); `LeaveAsync` sheds the active membership with the safety clause; a new plural `HouseholdsController` hosts create/list/switch. The frontend stays untouched and compatible.

**Tech Stack:** existing backend stack (.NET 10, EF Core + Npgsql, Testcontainers). No new packages.

**Spec:** `docs/superpowers/specs/2026-07-27-multi-membership-design.md` (incl. the leave safety clause) + umbrella `2026-07-27-multi-household-architecture.md`

## Global Constraints

- Membership: the raw-SQL `DEFERRABLE INITIALLY DEFERRED UNIQUE ("UserId")` constraint (added in migration `20260721164226_AddMealPlanAndShopping`, find its exact constraint name there) is DROPPED; the existing `(UserId, HouseholdId)` unique index becomes the only uniqueness rule. A user always ends every operation with ≥ 1 membership.
- Active household: `RefreshTokens.HouseholdId Guid NOT NULL` (backfilled from each token's user's single membership); refresh mints the claim from the STORED token's `HouseholdId` and rotation copies it; login/register mint from the user's OLDEST membership (`CreatedAt` then `Id` ordering); `IssueTokensAsync(userId, householdId, ct)` (interface change) mints for an explicit household.
- Guard: predicate becomes "a `HouseholdMembers` row exists for (claim household, token `sub`)" — left-household tokens die like dead-household tokens; the anonymous refresh escape hatch is untouched.
- Join: additive — membership row added (`Member` role), NOTHING re-homed, NOTHING deleted; already-a-member → `Conflict` (a concurrent double-join resolves via the unique index → catch → `Conflict`); returns `AuthResponse` with the JOINED household active; notifies the target household.
- Leave (safety clause included): remove active membership; owner promotion as today; if the user was the last member → delete the household ONLY when the user has another membership to land on, else `Conflict` (today's sole-member behavior); next active = oldest remaining membership, else a fresh personal household (created before minting).
- New endpoints under `api/v1/households` (plural): `POST ""` create `{name}` (validated like rename) → creator Owner, returns `AuthResponse` with it ACTIVE; `GET ""` list `[{id, name, joinCode (display-formatted), memberCount, role (lowercase), isActive}]`; `POST "switch"` `{householdId}` → 404 when not a member, else `AuthResponse`. The singular `api/v1/household` surface keeps acting on the claim household.
- Test replacements are DISCLOSED behavior-change updates, not silent deletions: the sole-member join-merge tests (HouseholdApiTests), the join-re-home SyncSeq proof (SyncApiTests), and both dead-household setups (HouseholdGuardTests escape-hatch setup keeps working; RealtimeTests' dead-token test) are replaced by their new-invariant counterparts named in the tasks.
- House rules: zero warnings, csproj pins untouched, `[Collection("Api")]`, committed EF migration via the tool manifest, drift check clean, run from `/home/mrb/Work/Programming/ingredo/backend`, Docker running. Baseline: 129 tests.

## File Structure

- Modify: `Domain/RefreshToken.cs`, `Data/AppDbContext.cs` (+ migration `MultiMembership` with hand-added SQL), `Auth/IAuthService.cs`, `Auth/AuthService.cs`, `Common/HouseholdGuardMiddleware.cs`, `Households/HouseholdService.cs`, `Households/IHouseholdService.cs`, `Households/HouseholdDtos.cs`, `Households/HouseholdValidators.cs` (or the file housing `RenameRequestValidator`), `Program.cs` (DI unchanged; controller auto-discovered), `backend/README.md`, root `docs/TESTING.md`
- Create: `Households/HouseholdsController.cs`; `Ingredo.Api.Tests/Integration/MultiMembershipTests.cs`
- Test updates: `Integration/HouseholdApiTests.cs`, `Integration/HouseholdGuardTests.cs`, `Integration/SyncApiTests.cs`, `Integration/RealtimeTests.cs`

---

### Task 1: Token-family household, mint paths, membership guard

**Files:**
- Modify: `Domain/RefreshToken.cs`, `Data/AppDbContext.cs` (+ generate migration `MultiMembership`), `Auth/IAuthService.cs`, `Auth/AuthService.cs`, `Households/HouseholdService.cs` (only the two `IssueTokensAsync` call sites gain the household argument), `Common/HouseholdGuardMiddleware.cs`
- Test: `Ingredo.Api.Tests/Integration/HouseholdGuardTests.cs` (one new test; existing tests untouched)

**Interfaces:**
- Produces (used by Tasks 2–3): `IAuthService.IssueTokensAsync(Guid userId, Guid householdId, CancellationToken ct)`; refresh preserves the family's household; guard = membership predicate.

- [ ] **Step 0: Branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/multi-membership
cd backend
```

- [ ] **Step 1: Domain + context + migration**

`Domain/RefreshToken.cs`: add

```csharp
    // The device's active household: refresh mints the access-token claim
    // from this, so two devices (families) on one account can sit in
    // different households. Rotation copies it; switch rotates the family.
    public Guid HouseholdId { get; set; }
```

`Data/AppDbContext.cs`, inside the `RefreshToken` entity block: nothing needed beyond the property (no index required — lookups stay by hash/family).

Generate + hand-extend the migration:

```bash
dotnet tool restore
dotnet tool run dotnet-ef -- migrations add MultiMembership --project Ingredo.Api --output-dir Data/Migrations
```

The generated `Up` adds the non-null `HouseholdId` column with a default — replace that with a nullable add + backfill + tighten, and drop the deferrable single-membership constraint. First read `Data/Migrations/20260721164226_AddMealPlanAndShopping.cs` around its `UNIQUE ("UserId") DEFERRABLE INITIALLY DEFERRED` SQL to get the exact constraint name (it appears in the `ALTER TABLE ... ADD CONSTRAINT <name> ...` statement). Then make `Up`:

```csharp
            migrationBuilder.AddColumn<Guid>(
                name: "HouseholdId",
                table: "RefreshTokens",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "RefreshTokens" rt
                SET "HouseholdId" = m."HouseholdId"
                FROM "HouseholdMembers" m
                WHERE m."UserId" = rt."UserId";
                DELETE FROM "RefreshTokens" WHERE "HouseholdId" IS NULL;
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "HouseholdId",
                table: "RefreshTokens",
                type: "uuid",
                nullable: false);

            migrationBuilder.Sql("""
                ALTER TABLE "HouseholdMembers" DROP CONSTRAINT <the-exact-name-you-found>;
                """);
```

(The `DELETE ... IS NULL` guards a token whose user somehow lacks membership — impossible today, but the tighten must not fail.) `Down`: re-add the deferrable constraint with the same SQL the old migration used, drop the column. Then verify drift:

```bash
dotnet build && dotnet tool run dotnet-ef -- migrations has-pending-model-changes --project Ingredo.Api
```

Expected: 0 warnings, drift clean.

- [ ] **Step 2: Mint paths**

`Auth/IAuthService.cs`: change

```csharp
    Task<AuthResponse> IssueTokensAsync(Guid userId, Guid householdId, CancellationToken cancellationToken);
```

`Auth/AuthService.cs`:
1. `IssueRefreshToken` gains a `Guid householdId` parameter and sets `HouseholdId = householdId` on the new row. Update ALL its call sites accordingly (register: the just-created personal household id; login: the resolved household's id; refresh rotation: `stored.HouseholdId`; IssueTokensAsync: the argument).
2. `HouseholdOf(userId)` becomes deterministic-oldest:

```csharp
    private async Task<Household> OldestHouseholdOf(Guid userId, CancellationToken cancellationToken) =>
        await db.HouseholdMembers
            .Where(m => m.UserId == userId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .Join(db.Households, m => m.HouseholdId, h => h.Id, (m, h) => h)
            .FirstAsync(cancellationToken);
```

Rename the call sites (`LoginAsync`, `MeAsync`). `MeAsync` note: it reports the OLDEST household today for lack of request context — change it to resolve the CLAIM household instead? No: `MeAsync` receives only userId. Leave `MeAsync` on oldest for this slice and add a `// slice-④ note:` comment (the frontend's Account section uses `getHousehold()` — the singular claim-scoped endpoint — for display, so nothing user-visible depends on `MeAsync`'s household).
3. `RefreshAsync`: resolve the household from the STORED token —

```csharp
        var household = await db.Households.SingleAsync(
            h => h.Id == stored.HouseholdId, cancellationToken);
```

replacing its `HouseholdOf` call, and the rotation call becomes `IssueRefreshToken(user.Id, stored.FamilyId, stored.HouseholdId, now)` (adjust to the real parameter order you chose). If the household was deleted since (left+deleted), `SingleAsync` would throw — use `FirstOrDefaultAsync` and return the same invalid-token `ServiceResult` the method uses for revoked tokens (a family whose household died cannot refresh; the client re-logins and lands on the oldest membership).
4. `IssueTokensAsync(userId, householdId, ct)`: resolve THAT household (`SingleAsync(h => h.Id == householdId)`), mint a fresh family with it.
5. `Households/HouseholdService.cs`: the two existing calls become `auth.IssueTokensAsync(userId, target.Id, cancellationToken)` (join) and `auth.IssueTokensAsync(userId, personal.Id, cancellationToken)` (leave) — semantics unchanged this task (full rewrites are Task 2; here only the compile-required argument).

- [ ] **Step 3: Guard membership predicate**

`Common/HouseholdGuardMiddleware.cs`: the check becomes

```csharp
            var claim = context.User.FindFirst(TokenService.HouseholdClaim)?.Value;
            var sub = context.User.FindFirst("sub")?.Value;
            if (!Guid.TryParse(claim, out var householdId)
                || !Guid.TryParse(sub, out var userId)
                || !await db.HouseholdMembers.AnyAsync(
                    m => m.HouseholdId == householdId && m.UserId == userId,
                    context.RequestAborted))
```

and the file's header comment updates: a token can also outlive its MEMBERSHIP (you left; others remain — the household exists but the token must die).

- [ ] **Step 4: The new guard test**

Append to `HouseholdGuardTests` (adapting to its helpers):

```csharp
    [Fact]
    public async Task Tokens_for_a_household_you_left_fail_with_401()
    {
        // B joins A's household (old token now claims B's vacated personal
        // household — under the OLD join that household is deleted; under
        // either semantic B is no longer a member, which is what the guard
        // now checks).
        var (hostClient, hostAuth) = await factory.RegisterUserAsync();
        var (joinerClient, joinerAuth) = await factory.RegisterUserAsync();
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var join = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        join.EnsureSuccessStatusCode();

        var stale = factory.CreateClient();
        stale.UseTokens(joinerAuth);
        var response = await stale.GetAsync("/api/v1/recipes");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
```

- [ ] **Step 5: Verify + commit**

Run: `dotnet build && dotnet test`
Expected: 0 warnings; 130/130 (129 + 1 — every existing test passes: single-membership users satisfy both old and new predicates, and mint paths produce identical claims for them).

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: carry the active household on the refresh-token family"
```

---

### Task 2: Additive join, leave-one

**Files:**
- Modify: `Households/HouseholdService.cs` (JoinAsync + LeaveAsync rewrites)
- Test: `Integration/HouseholdApiTests.cs` (merge tests replaced), `Integration/SyncApiTests.cs` (re-home test replaced), `Integration/RealtimeTests.cs` (dead-token setup replaced, join-notify kept)

**Interfaces:**
- Consumes: Task 1 `IssueTokensAsync(userId, householdId, ct)`.
- Produces: the new join/leave semantics Tasks 3–4 and the frontend rely on.

- [ ] **Step 1: Write the failing/replacement tests**

In `HouseholdApiTests.cs`: locate the sole-member join-merge tests (they assert re-homed recipes and shell deletion) and REPLACE them with (adapt names/helpers):

```csharp
    [Fact]
    public async Task Join_is_additive_both_households_keep_their_content()
    {
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        await CreateRecipeNamed(hostClient, "Vertens taco");
        await CreateRecipeNamed(joinerClient, "Egen suppe");
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");

        var join = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        var auth = await join.Content.ReadFromJsonAsync<AuthResponse>();
        joinerClient.UseTokens(auth!);

        // Active is now the joined household: host content visible, own not.
        var joined = await joinerClient.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.Contains(joined!, r => r.Title == "Vertens taco");
        Assert.DoesNotContain(joined!, r => r.Title == "Egen suppe");
        // The personal household still exists with its content: switch back
        // by refreshing the OLD family? No — Task 3 adds switch; here prove
        // persistence via the members list of the joined household and the
        // guard-alive OLD token being... (old token is dead by design).
        // Persistence proof: the joiner's list endpoint arrives in Task 3;
        // at this task's level assert via the database through a second
        // login (login lands on the OLDEST membership = the personal one).
        var relogin = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/login",
            new { email = JoinerEmail, password = JoinerPassword });
        var personalAuth = await relogin.Content.ReadFromJsonAsync<AuthResponse>();
        var personalClient = factory.CreateClient();
        personalClient.UseTokens(personalAuth!);
        var personal = await personalClient.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.Contains(personal!, r => r.Title == "Egen suppe");
    }

    [Fact]
    public async Task Joining_a_household_you_already_belong_to_conflicts()
    {
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var first = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        var auth = await first.Content.ReadFromJsonAsync<AuthResponse>();
        joinerClient.UseTokens(auth!);

        var second = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household.JoinCode });

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Leave_lands_on_the_oldest_remaining_membership()
    {
        // Joiner has personal (oldest) + host household; leaving the host
        // household lands back on personal, and the host household keeps
        // its members and content.
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        await CreateRecipeNamed(joinerClient, "Egen suppe");
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var join = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        joinerClient.UseTokens((await join.Content.ReadFromJsonAsync<AuthResponse>())!);

        var leave = await joinerClient.PostAsJsonAsync("/api/v1/household/leave", new { });
        var auth = await leave.Content.ReadFromJsonAsync<AuthResponse>();
        joinerClient.UseTokens(auth!);

        var recipes = await joinerClient.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.Contains(recipes!, r => r.Title == "Egen suppe");
        var hostView = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        Assert.Single(hostView!.Members);
    }

    [Fact]
    public async Task Sole_member_with_no_other_membership_cannot_leave()
    {
        var (client, _) = await factory.RegisterUserAsync();

        var leave = await client.PostAsJsonAsync("/api/v1/household/leave", new { });

        Assert.Equal(HttpStatusCode.Conflict, leave.StatusCode);
    }

    [Fact]
    public async Task Last_member_leaving_a_shared_household_deletes_it()
    {
        // A creates content in own household, joins B's household, then the
        // OLD personal household (A was sole member, A has another
        // membership) is deleted when A leaves it. Requires switching back
        // to it — via login (oldest membership IS the personal one).
        var (hostClient, _) = await factory.RegisterUserAsync();
        var (roamerClient, _) = await factory.RegisterUserAsync();
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var join = await roamerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        join.EnsureSuccessStatusCode();

        var relogin = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/login", new { email = RoamerEmail, password = RoamerPassword });
        var personalClient = factory.CreateClient();
        personalClient.UseTokens((await relogin.Content.ReadFromJsonAsync<AuthResponse>())!);

        var leave = await personalClient.PostAsJsonAsync("/api/v1/household/leave", new { });
        var auth = await leave.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(household.Id, auth!.User.HouseholdId); // landed on the shared one
    }
```

Adapt `RegisterUserAsync` to expose the email/password it registered (extend the helper's return or register explicit credentials inline — smallest disclosed change; the existing helper may already generate knowable credentials — read it). `CreateRecipeNamed` = the file's existing recipe-creation helper or a local one.

In `SyncApiTests.cs`: REPLACE `Join_rehome_rows_surface_in_the_target_households_next_incremental_pull` with:

```csharp
    [Fact]
    public async Task Join_moves_nothing_across_households()
    {
        // Additive join: B's recipe stays in B's household — A's pull never
        // sees it, and B's row keeps its identity (no re-home, no SyncSeq
        // churn from membership changes).
        var (bClient, _) = await factory.RegisterUserAsync("B");
        var bRecipeResponse = await bClient.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, "B sin oppskrift", null, 2, null,
                [new IngredientRequest(null, "Salt", null, null, "fixed", 0)],
                [new InstructionRequest(null, "Ta med.", 0)]));
        bRecipeResponse.EnsureSuccessStatusCode();

        await CreateRecipe("A sin egen oppskrift");
        var preJoinCursor = (await Pull()).Cursor;

        var household = await _client.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        var join = await bClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        join.EnsureSuccessStatusCode();

        var incremental = await Pull(preJoinCursor);
        Assert.DoesNotContain(incremental.Recipes, r => r.Title == "B sin oppskrift");
    }
```

In `RealtimeTests.cs`: the `Dead_household_token_is_rejected` setup (join deleting the shell) no longer produces a dead household — rename/replace with a LEFT-household setup: host+joiner share a household (joiner joins), joiner then LEAVES it (`POST /api/v1/household/leave` with the joined-household tokens), and the pre-leave token is used to connect → rejected. Keep `Join_notifies_the_target_household` (still valid — join still notifies).

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test --filter "HouseholdApiTests|SyncApiTests|RealtimeTests"`
Expected: the new/replaced tests FAIL against the old join/leave semantics (re-home still happens; sole-member leave conflicts remain but the multi-membership landings don't exist). RED.

- [ ] **Step 3: Rewrite JoinAsync**

Replace `HouseholdService.JoinAsync` with:

```csharp
    public async Task<ServiceResult<AuthResponse>> JoinAsync(
        Guid userId, Guid currentHouseholdId, string code, CancellationToken cancellationToken)
    {
        var canonical = JoinCodeGenerator.Canonicalize(code);
        if (canonical is null) return ServiceResult<AuthResponse>.NotFound();

        var target = await db.Households.FirstOrDefaultAsync(
            h => h.JoinCode == canonical, cancellationToken);
        if (target is null) return ServiceResult<AuthResponse>.NotFound();

        var alreadyMember = await db.HouseholdMembers.AnyAsync(
            m => m.UserId == userId && m.HouseholdId == target.Id, cancellationToken);
        if (alreadyMember) return ServiceResult<AuthResponse>.Conflict();

        db.HouseholdMembers.Add(new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            HouseholdId = target.Id,
            Role = HouseholdRole.Member,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Concurrent double-join: the (UserId, HouseholdId) unique index
            // is the arbiter.
            return ServiceResult<AuthResponse>.Conflict();
        }

        await notifier.NotifyHouseholdChangedAsync(target.Id, cancellationToken);
        return ServiceResult<AuthResponse>.Ok(
            await auth.IssueTokensAsync(userId, target.Id, cancellationToken));
    }
```

(The `currentHouseholdId` parameter becomes unused by the logic but stays in the signature this slice — the controller passes it and slice-③/④ may drop it; suppress any unused-parameter warning by keeping it referenced via the interface contract. The FOR-UPDATE lock block, sole-membership snapshot, re-home, and shell-delete are deleted.)

- [ ] **Step 4: Rewrite LeaveAsync**

```csharp
    public async Task<ServiceResult<AuthResponse>> LeaveAsync(
        Guid userId, Guid currentHouseholdId, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM "Households" WHERE "Id" = {currentHouseholdId} FOR UPDATE""",
            cancellationToken);

        var membership = await db.HouseholdMembers.SingleAsync(
            m => m.UserId == userId && m.HouseholdId == currentHouseholdId, cancellationToken);
        var others = await db.HouseholdMembers
            .Where(m => m.HouseholdId == currentHouseholdId && m.UserId != userId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);
        var otherMemberships = await db.HouseholdMembers
            .Where(m => m.UserId == userId && m.HouseholdId != currentHouseholdId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);

        if (others.Count == 0 && otherMemberships.Count == 0)
        {
            // Sole member, nowhere to land: leaving would destroy content
            // just to mint an identical empty household — and the client's
            // leave dialog promises content survives.
            return ServiceResult<AuthResponse>.Conflict();
        }

        if (others.Count > 0 && membership.Role == HouseholdRole.Owner)
        {
            others[0].Role = HouseholdRole.Owner;
        }
        db.HouseholdMembers.Remove(membership);
        await db.SaveChangesAsync(cancellationToken);

        if (others.Count == 0)
        {
            // Last member out: the household and its content go with them.
            await db.Households
                .Where(h => h.Id == currentHouseholdId)
                .ExecuteDeleteAsync(cancellationToken);
        }

        Guid nextHouseholdId;
        if (otherMemberships.Count > 0)
        {
            nextHouseholdId = otherMemberships[0].HouseholdId;
        }
        else
        {
            var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
            var now = DateTimeOffset.UtcNow;
            var personal = new Household
            {
                Id = Guid.NewGuid(),
                Name = user.DisplayName,
                JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken),
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Households.Add(personal);
            db.HouseholdMembers.Add(new HouseholdMember
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                HouseholdId = personal.Id,
                Role = HouseholdRole.Owner,
                CreatedAt = now,
            });
            await db.SaveChangesAsync(cancellationToken);
            nextHouseholdId = personal.Id;
        }

        await transaction.CommitAsync(cancellationToken);
        return ServiceResult<AuthResponse>.Ok(
            await auth.IssueTokensAsync(userId, nextHouseholdId, cancellationToken));
    }
```

- [ ] **Step 5: Verify + commit**

Run: `dotnet build && dotnet test`
Expected: 0 warnings; count = 130 − (replaced) + (replacements) — report the exact number; all green. The full suite proves the old-semantics tests are fully replaced and nothing else depended on re-home.

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: make join additive and leave shed one membership"
```

---

### Task 3: Create, list, switch

**Files:**
- Modify: `Households/IHouseholdService.cs`, `Households/HouseholdService.cs`, `Households/HouseholdDtos.cs`, the validators file housing `RenameRequestValidator`
- Create: `Households/HouseholdsController.cs`, `Ingredo.Api.Tests/Integration/MultiMembershipTests.cs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `POST/GET api/v1/households`, `POST api/v1/households/switch`; `HouseholdSummaryResponse(Guid Id, string Name, string JoinCode, int MemberCount, string Role, bool IsActive)`, `CreateHouseholdRequest(string Name)`, `SwitchHouseholdRequest(Guid HouseholdId)`.

- [ ] **Step 1: Write the failing tests**

Create `Integration/MultiMembershipTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Ingredo.Api.Auth;
using Ingredo.Api.Households;
using Ingredo.Api.Recipes;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class MultiMembershipTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<RecipeResponse> CreateRecipeNamed(HttpClient client, string title)
    {
        var response = await client.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, title, null, 2, null,
                [new IngredientRequest(null, "Salt", null, null, "fixed", 0)],
                [new InstructionRequest(null, "Rør.", 0)]));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<RecipeResponse>())!;
    }

    [Fact]
    public async Task Create_returns_the_new_household_active_and_owned()
    {
        var (client, first) = await factory.RegisterUserAsync();

        var create = await client.PostAsJsonAsync("/api/v1/households", new { name = "Tur" });
        var auth = await create.Content.ReadFromJsonAsync<AuthResponse>();

        Assert.NotEqual(first.User.HouseholdId, auth!.User.HouseholdId);
        Assert.Equal("Tur", auth.User.HouseholdName);
        client.UseTokens(auth);
        var household = await client.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");
        Assert.Equal("owner", household!.Members.Single().Role);
    }

    [Fact]
    public async Task List_shows_every_membership_with_the_active_marker()
    {
        var (client, first) = await factory.RegisterUserAsync();
        var create = await client.PostAsJsonAsync("/api/v1/households", new { name = "Tur" });
        var auth = await create.Content.ReadFromJsonAsync<AuthResponse>();
        client.UseTokens(auth!);

        var list = await client.GetFromJsonAsync<List<HouseholdSummaryResponse>>("/api/v1/households");

        Assert.Equal(2, list!.Count);
        var active = Assert.Single(list, h => h.IsActive);
        Assert.Equal(auth!.User.HouseholdId, active.Id);
        var personal = Assert.Single(list, h => h.Id == first.User.HouseholdId);
        Assert.False(personal.IsActive);
        Assert.Equal(1, personal.MemberCount);
        Assert.Matches("^[A-Z2-9]{3}-[A-Z2-9]{3}$", personal.JoinCode);
    }

    [Fact]
    public async Task Switch_changes_the_active_household_and_content_scope()
    {
        var (client, first) = await factory.RegisterUserAsync();
        await CreateRecipeNamed(client, "Hjemme-taco");
        var create = await client.PostAsJsonAsync("/api/v1/households", new { name = "Tur" });
        client.UseTokens((await create.Content.ReadFromJsonAsync<AuthResponse>())!);
        await CreateRecipeNamed(client, "Tur-suppe");

        var back = await client.PostAsJsonAsync(
            "/api/v1/households/switch", new { householdId = first.User.HouseholdId });
        var auth = await back.Content.ReadFromJsonAsync<AuthResponse>();
        client.UseTokens(auth!);

        Assert.Equal(first.User.HouseholdId, auth!.User.HouseholdId);
        var recipes = await client.GetFromJsonAsync<List<RecipeSummaryResponse>>("/api/v1/recipes");
        Assert.Contains(recipes!, r => r.Title == "Hjemme-taco");
        Assert.DoesNotContain(recipes!, r => r.Title == "Tur-suppe");
    }

    [Fact]
    public async Task Switch_to_a_household_you_do_not_belong_to_is_404()
    {
        var (client, _) = await factory.RegisterUserAsync();
        var (otherClient, otherAuth) = await factory.RegisterUserAsync();
        _ = otherClient;

        var response = await client.PostAsJsonAsync(
            "/api/v1/households/switch", new { householdId = otherAuth.User.HouseholdId });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Two_families_hold_different_active_households_simultaneously()
    {
        var (deviceA, first) = await factory.RegisterUserAsync();
        var create = await deviceA.PostAsJsonAsync("/api/v1/households", new { name = "Tur" });
        var tripAuth = await create.Content.ReadFromJsonAsync<AuthResponse>();
        deviceA.UseTokens(tripAuth!);

        // Device B: fresh login → oldest membership (the personal one).
        var login = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/login", new { email = RegisteredEmail(first), password = RegisteredPassword });
        var deviceBAuth = await login.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(first.User.HouseholdId, deviceBAuth!.User.HouseholdId);

        // Each family refreshes into ITS household.
        var refreshA = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = tripAuth!.RefreshToken });
        var refreshedA = await refreshA.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(tripAuth.User.HouseholdId, refreshedA!.User.HouseholdId);

        var refreshB = await factory.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = deviceBAuth.RefreshToken });
        var refreshedB = await refreshB.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(first.User.HouseholdId, refreshedB!.User.HouseholdId);
    }

    [Fact]
    public async Task Create_with_a_blank_name_is_400()
    {
        var (client, _) = await factory.RegisterUserAsync();

        var response = await client.PostAsJsonAsync("/api/v1/households", new { name = "  " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
```

Credentials note: `RegisteredEmail`/`RegisteredPassword` stand for however `RegisterUserAsync` makes credentials retrievable — read `ApiClientExtensions.cs`; if the helper doesn't expose them, extend it minimally (disclosed) or register inline with explicit credentials in the two tests that need re-login.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test --filter MultiMembershipTests`
Expected: FAIL — 404s on the plural endpoints. RED.

- [ ] **Step 3: Implement**

`Households/HouseholdDtos.cs` — append:

```csharp
public sealed record HouseholdSummaryResponse(
    Guid Id,
    string Name,
    string JoinCode,
    int MemberCount,
    string Role,
    bool IsActive);

public sealed record CreateHouseholdRequest(string Name);

public sealed record SwitchHouseholdRequest(Guid HouseholdId);
```

Validators (same file as `RenameRequestValidator`; mirror its rules exactly):

```csharp
public sealed class CreateHouseholdRequestValidator : AbstractValidator<CreateHouseholdRequest>
{
    public CreateHouseholdRequestValidator()
    {
        RuleFor(r => r.Name).NotEmpty().MaximumLength(100);
    }
}
```

(Adjust the max length to whatever `RenameRequestValidator` actually uses; also add a `Must(n => !string.IsNullOrWhiteSpace(n))`-equivalent if the rename validator has one — mirror, don't invent.)

`Households/IHouseholdService.cs` — add:

```csharp
    Task<AuthResponse> CreateAsync(Guid userId, string name, CancellationToken cancellationToken);
    Task<List<HouseholdSummaryResponse>> ListAsync(Guid userId, Guid activeHouseholdId, CancellationToken cancellationToken);
    Task<ServiceResult<AuthResponse>> SwitchAsync(Guid userId, Guid householdId, CancellationToken cancellationToken);
```

`Households/HouseholdService.cs` — append:

```csharp
    public async Task<AuthResponse> CreateAsync(
        Guid userId, string name, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var household = new Household
        {
            Id = Guid.NewGuid(),
            Name = name.Trim(),
            JoinCode = await joinCodes.NewUniqueCodeAsync(cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Households.Add(household);
        db.HouseholdMembers.Add(new HouseholdMember
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            HouseholdId = household.Id,
            Role = HouseholdRole.Owner,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        return await auth.IssueTokensAsync(userId, household.Id, cancellationToken);
    }

    public async Task<List<HouseholdSummaryResponse>> ListAsync(
        Guid userId, Guid activeHouseholdId, CancellationToken cancellationToken)
    {
        var memberships = await db.HouseholdMembers
            .Where(m => m.UserId == userId)
            .Join(
                db.Households,
                m => m.HouseholdId,
                h => h.Id,
                (m, h) => new { h.Id, h.Name, h.JoinCode, m.Role, m.CreatedAt })
            .OrderBy(x => x.CreatedAt)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        var counts = await db.HouseholdMembers
            .Where(m => memberships.Select(x => x.Id).Contains(m.HouseholdId))
            .GroupBy(m => m.HouseholdId)
            .Select(g => new { HouseholdId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var countById = counts.ToDictionary(c => c.HouseholdId, c => c.Count);

        return memberships
            .Select(x => new HouseholdSummaryResponse(
                x.Id,
                x.Name,
                JoinCodeGenerator.FormatForDisplay(x.JoinCode),
                countById.GetValueOrDefault(x.Id, 1),
                x.Role.ToString().ToLowerInvariant(),
                x.Id == activeHouseholdId))
            .ToList();
    }

    public async Task<ServiceResult<AuthResponse>> SwitchAsync(
        Guid userId, Guid householdId, CancellationToken cancellationToken)
    {
        var isMember = await db.HouseholdMembers.AnyAsync(
            m => m.UserId == userId && m.HouseholdId == householdId, cancellationToken);
        if (!isMember) return ServiceResult<AuthResponse>.NotFound();
        return ServiceResult<AuthResponse>.Ok(
            await auth.IssueTokensAsync(userId, householdId, cancellationToken));
    }
```

Create `Households/HouseholdsController.cs`:

```csharp
using System.Security.Claims;
using FluentValidation;
using Ingredo.Api.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ingredo.Api.Households;

// The PLURAL surface: a user's memberships. The singular api/v1/household
// keeps acting on the token's active household.
[ApiController]
[Route("api/v1/households")]
[Authorize]
public sealed class HouseholdsController(
    IHouseholdService service,
    IValidator<CreateHouseholdRequest> createValidator) : ControllerBase
{
    private Guid HouseholdId => Guid.Parse(User.FindFirstValue(TokenService.HouseholdClaim)!);
    private Guid UserId => Guid.Parse(User.FindFirstValue("sub")!);

    [HttpPost]
    public async Task<IActionResult> Create(
        CreateHouseholdRequest request, CancellationToken cancellationToken)
    {
        var validation = await createValidator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            validation.Errors.ForEach(e => ModelState.AddModelError(e.PropertyName, e.ErrorMessage));
            return ValidationProblem(ModelState);
        }
        return Ok(await service.CreateAsync(UserId, request.Name, cancellationToken));
    }

    [HttpGet]
    public async Task<List<HouseholdSummaryResponse>> List(CancellationToken cancellationToken) =>
        await service.ListAsync(UserId, HouseholdId, cancellationToken);

    [HttpPost("switch")]
    public async Task<IActionResult> Switch(
        SwitchHouseholdRequest request, CancellationToken cancellationToken)
    {
        var result = await service.SwitchAsync(UserId, request.HouseholdId, cancellationToken);
        return result.Status == Common.ServiceStatus.NotFound ? NotFound() : Ok(result.Value);
    }
}
```

(Validators register via the existing assembly scan; no Program.cs change.)

- [ ] **Step 4: Verify + commit**

Run: `dotnet build && dotnet test`
Expected: 0 warnings; previous count + 7, all green.

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add household create, list and switch"
```

---

### Task 4: Docs, compose smoke, finish

**Files:**
- Modify: `backend/README.md`, root `docs/TESTING.md`

- [ ] **Step 1: Full pass + compose smoke**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet build && dotnet test
docker compose up -d --build
for i in $(seq 1 30); do curl -sf http://localhost:8080/health >/dev/null && break; sleep 1; done
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"multi@test.local","password":"passord123","displayName":"Multi"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
NEWTOKEN=$(curl -s -X POST http://localhost:8080/api/v1/households -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Tur"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s http://localhost:8080/api/v1/households -H "Authorization: Bearer $NEWTOKEN" | grep -o '"isActive":true' | head -1 && echo SMOKE-OK
docker compose down
```

Expected: `SMOKE-OK` (the in-place migration applied — note: NOT a fresh volume; that is the point, existing data migrates).

- [ ] **Step 2: Docs**

`backend/README.md`, extend the households section (adapt to its current text):

```markdown
- Users can belong to several households. `POST /api/v1/households` creates
  one (you become owner and switch to it), `GET /api/v1/households` lists
  your memberships, `POST /api/v1/households/switch` picks the active one.
  The active household rides on the refresh-token family, so each device
  remembers its own choice. Join adds a membership (nothing moves); leave
  sheds one (the last member out deletes the household).
```

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Multi-membership backend (manual pass)

Via Scalar (or curl) against the compose stack — the app UI arrives in a later slice.

- Create a second household: POST /api/v1/households {"name":"Tur"} → response tokens are scoped to it; GET /api/v1/household shows "Tur" with you as owner.
- GET /api/v1/households lists both, with isActive on the new one.
- Switch back: POST /api/v1/households/switch {"householdId": <personal id>} → recipes list shows your old content again; the trip household keeps its own.
- Join is additive: a second user joining your code keeps their personal household (their re-login lands back in it).
- Leave: leaving the shared household lands you in your oldest other membership; leaving your ONLY household is rejected (409).
- Old tokens for a household you left get 401 everywhere; refresh recovers.
- The CURRENT app still works signed into one household throughout (create/switch only via API for now).
```

- [ ] **Step 3: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/README.md docs/TESTING.md
git commit -m "docs: document multi-membership endpoints"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (constraint swap → T1 migration; composite index already exists), 2 (family household, oldest-membership login, refresh-from-stored, IssueTokensAsync(householdId) → T1), 3 (membership guard + left-household test → T1), 4 (additive join + conflict-on-member + unique-index race arbiter → T2), 5 (leave with safety clause, promotion, last-member delete, landing rules → T2), 6 (create/list/switch + DTOs/validators → T3), 7 (no code needed — verified by existing sync/realtime tests continuing to pass + the replaced RealtimeTests setup), 8 (migration with backfill + deferrable drop → T1), 9 (test matrix incl. named replacements → T1–T3; the two-families test is decision 2's headline proof).
- **Judgment calls:** `MeAsync` stays oldest-membership with a slice-④ note (nothing user-visible reads its household — the app uses claim-scoped `GET /household`). Refresh for a deleted household returns the invalid-token result (client re-logins). Join keeps its (now-unused) `currentHouseholdId` parameter to avoid an interface churn mid-slice. `ListAsync` does two queries + in-memory join (memberships are single-digit; no N+1). Credentials retrievability in tests is left to the implementer to solve minimally against the real helper (read it first), disclosed.
- **Type consistency check:** `IssueTokensAsync(Guid userId, Guid householdId, CancellationToken)` consistent across T1 definition and T2/T3 call sites; `HouseholdSummaryResponse` field order matches the list test's assertions; `SwitchHouseholdRequest.HouseholdId` matches the controller binding and test payloads (`householdId` camelCase); ServiceStatus usage mirrors the existing singular controller.
- **Placeholder scan:** the migration's `<the-exact-name-you-found>` is a deliberate read-the-file instruction (the name exists only in that migration's SQL), not an unknown — the implementer is told exactly where to find it. Everything else is complete code.
