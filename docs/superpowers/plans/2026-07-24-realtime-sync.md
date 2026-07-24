# Realtime Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SignalR change-notification channel: household writes broadcast an argument-less `changed` message that foregrounded, signed-in devices answer with `syncNow()` — realtime as an accelerator on top of Phase 5, never a new sync mechanism.

**Architecture:** Backend: an empty-surface `[Authorize]` hub joining each connection to `household:<id>` from the JWT claim; a `IChangeNotifier` seam called after durable writes; the standard `access_token`-query JWT pattern scoped to `/hubs/`. Frontend: one module owning the connection lifecycle (exists iff signedIn AND app active), `changed` → `syncNow()`, silent on every failure.

**Tech Stack:** ASP.NET Core built-in SignalR (zero new backend runtime packages; `Microsoft.AspNetCore.SignalR.Client` added to the TEST project only), `@microsoft/signalr` on the frontend (the one new dependency).

**Spec:** `docs/superpowers/specs/2026-07-24-realtime-sync-design.md`

## Global Constraints

- Wire contract: exactly ONE server→client message, name `changed`, no arguments. No client-invokable hub methods.
- Query-string token accepted ONLY for paths starting with `/hubs/`; the REST surface's auth is untouched. The fail-closed household guard applies to hub requests (hub carries `[Authorize]`; no `[AllowAnonymous]` anywhere new).
- Notify AFTER the write is durable (after `SaveChangesAsync`, and after `CommitAsync` where a transaction exists), only on SUCCESS paths, reads never notify; push notifies only when ≥1 row came back `applied`; join notifies the TARGET household. Notifier failures are logged and swallowed — a notification must never fail its write.
- Frontend connection exists exactly when `session.status === 'signedIn'` AND AppState is `active`; sign-out/backgrounding stops it; a `session.householdId` change restarts it. All failures silent (`__DEV__` logging only). No new UI. Signed-out invariant: zero connections, zero fetches.
- Backend bar: zero warnings, keep csproj pins, `[Collection("Api")]`, run from `/home/mrb/Work/Programming/ingredo/backend`, Docker running; baseline 123 tests. Frontend bar: `npx jest` + `npx eslint . --max-warnings 0` + `npx tsc --noEmit` from `/home/mrb/Work/Programming/ingredo/frontend`; baseline 342 tests; mock-prefix rule; existing tests untouched except disclosed compile-forced additions.

## File Structure

- Create: `backend/Ingredo.Api/Realtime/SyncHub.cs`, `Realtime/IChangeNotifier.cs`, `Realtime/SignalRChangeNotifier.cs`; `backend/Ingredo.Api.Tests/Integration/RealtimeTests.cs`; `frontend/lib/sync/realtime.ts`; `frontend/__tests__/sync-realtime.test.ts`
- Modify: `backend/Ingredo.Api/Program.cs`, `Auth/AuthSetupExtensions.cs`, `Recipes/RecipeService.cs`, `MealPlan/MealPlanService.cs`, `Shopping/ShoppingService.cs`, `Sync/SyncService.cs`, `Households/HouseholdService.cs`, `backend/Ingredo.Api.Tests/Ingredo.Api.Tests.csproj`; `frontend/lib/api/session.ts` (one export), `frontend/app/_layout.tsx`, `frontend/package.json`; `backend/README.md`, root `docs/TESTING.md`

---

### Task 1: Hub, hub auth, and connection gating

**Files:**
- Create: `backend/Ingredo.Api/Realtime/SyncHub.cs`
- Modify: `backend/Ingredo.Api/Auth/AuthSetupExtensions.cs`, `backend/Ingredo.Api/Program.cs`, `backend/Ingredo.Api.Tests/Ingredo.Api.Tests.csproj`
- Test: `backend/Ingredo.Api.Tests/Integration/RealtimeTests.cs` (first half)

**Interfaces:**
- Produces (used by Task 2): `SyncHub` with `public static string GroupName(Guid householdId)` returning `$"household:{householdId}"`; hub mapped at `/hubs/sync`; test helper `ConnectAsync(string accessToken)` in `RealtimeTests`.

- [ ] **Step 0: Branch + test package**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/realtime-sync
cd backend
dotnet add Ingredo.Api.Tests package Microsoft.AspNetCore.SignalR.Client
dotnet build
```

Expected: build succeeds with 0 warnings (the package version resolves to the current 10.x line; if the build reports a vulnerability/pin warning, pin the newest 10.x patch explicitly like the csproj's existing pins).

- [ ] **Step 1: Write the failing tests**

Create `backend/Ingredo.Api.Tests/Integration/RealtimeTests.cs`:

```csharp
using Ingredo.Api.Auth;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace Ingredo.Api.Tests.Integration;

[Collection("Api")]
public class RealtimeTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    // LongPolling because WebSockets don't run over TestServer; the token
    // rides the query string — the exact pattern React Native clients use.
    private HubConnection BuildConnection(string accessToken)
    {
        return new HubConnectionBuilder()
            .WithUrl(
                $"{factory.Server.BaseAddress}hubs/sync?access_token={Uri.EscapeDataString(accessToken)}",
                options =>
                {
                    options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();
    }

    private async Task<HubConnection> ConnectAsync(string accessToken)
    {
        var connection = BuildConnection(accessToken);
        await connection.StartAsync();
        return connection;
    }

    [Fact]
    public async Task Authenticated_member_can_connect()
    {
        var (_, auth) = await factory.RegisterUserAsync();

        await using var connection = await ConnectAsync(auth.AccessToken);

        Assert.Equal(HubConnectionState.Connected, connection.State);
    }

    [Fact]
    public async Task Anonymous_connection_is_rejected()
    {
        var connection = BuildConnection(string.Empty);

        await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
    }

    [Fact]
    public async Task Dead_household_token_is_rejected()
    {
        // B's original token references a household that stops existing the
        // moment sole-member B joins A (shell delete) — the guard's job.
        var (_, hostAuth) = await factory.RegisterUserAsync();
        var (joinerClient, joinerAuth) = await factory.RegisterUserAsync();
        var host = factory.CreateClient();
        host.UseTokens(hostAuth);
        var household = await host.GetFromJsonAsync<Households.HouseholdResponse>("/api/v1/household");
        var joinResponse = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        joinResponse.EnsureSuccessStatusCode();

        var connection = BuildConnection(joinerAuth.AccessToken);

        await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
    }
}
```

Adapt to the actual helper shapes in `ApiClientExtensions.cs` (e.g. if `RegisterUserAsync` returns the client you should reuse instead of `CreateClient` + `UseTokens`, and the `HouseholdResponse` namespace/import) — assertions are the contract; disclose adaptations.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test --filter RealtimeTests`
Expected: FAIL — 404 on `/hubs/sync` (no hub mapped). RED.

- [ ] **Step 3: Implement**

Create `backend/Ingredo.Api/Realtime/SyncHub.cs`:

```csharp
using Ingredo.Api.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Ingredo.Api.Realtime;

// Empty surface: clients only listen. The entire wire contract is the
// argument-less "changed" message sent to a household group.
[Authorize]
public sealed class SyncHub : Hub
{
    public static string GroupName(Guid householdId) => $"household:{householdId}";

    public override async Task OnConnectedAsync()
    {
        var claim = Context.User?.FindFirst(TokenService.HouseholdClaim)?.Value;
        if (Guid.TryParse(claim, out var householdId))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(householdId));
        }
        await base.OnConnectedAsync();
    }
}
```

In `Auth/AuthSetupExtensions.cs`, inside `AddJwtBearer(options => { ... })` after the `TokenValidationParameters` assignment:

```csharp
                // WebSocket clients cannot send an Authorization header; the
                // standard SignalR pattern is the access token in the query
                // string — accepted ONLY for hub paths.
                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        var accessToken = context.Request.Query["access_token"];
                        if (!string.IsNullOrEmpty(accessToken)
                            && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                        {
                            context.Token = accessToken;
                        }
                        return Task.CompletedTask;
                    },
                };
```

In `Program.cs`: add `using Ingredo.Api.Realtime;`; add `builder.Services.AddSignalR();` next to `AddControllers()`; add `app.MapHub<SyncHub>("/hubs/sync");` next to `app.MapControllers();`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet build && dotnet test`
Expected: 0 warnings; 126/126 (123 + 3).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: add authenticated sync hub with household groups"
```

---

### Task 2: Change notifier and notify-after-write

**Files:**
- Create: `backend/Ingredo.Api/Realtime/IChangeNotifier.cs`, `Realtime/SignalRChangeNotifier.cs`
- Modify: `backend/Ingredo.Api/Program.cs`, `Recipes/RecipeService.cs`, `MealPlan/MealPlanService.cs`, `Shopping/ShoppingService.cs`, `Sync/SyncService.cs`, `Households/HouseholdService.cs`
- Test: `backend/Ingredo.Api.Tests/Integration/RealtimeTests.cs` (second half)

**Interfaces:**
- Consumes: Task 1's `SyncHub.GroupName`, `ConnectAsync` test helper.
- Produces: `IChangeNotifier { Task NotifyHouseholdChangedAsync(Guid householdId, CancellationToken cancellationToken = default); }` in DI.

- [ ] **Step 1: Write the failing tests**

Append to `RealtimeTests` (helper + scenarios; adapt request DTO shapes to the real records as in every prior slice):

```csharp
    private static Task<bool> Signal(HubConnection connection)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On("changed", () => tcs.TrySetResult(true));
        return tcs.Task;
    }

    private static async Task<bool> Arrived(Task<bool> signal) =>
        await Task.WhenAny(signal, Task.Delay(TimeSpan.FromSeconds(10))) == signal && signal.Result;

    [Fact]
    public async Task Crud_write_notifies_the_household_and_only_the_household()
    {
        var (memberClient, memberAuth) = await factory.RegisterUserAsync();
        var (outsiderClient, outsiderAuth) = await factory.RegisterUserAsync();
        _ = outsiderClient;
        await using var memberConnection = await ConnectAsync(memberAuth.AccessToken);
        await using var outsiderConnection = await ConnectAsync(outsiderAuth.AccessToken);
        var memberSignal = Signal(memberConnection);
        var outsiderSignal = Signal(outsiderConnection);

        var response = await memberClient.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, "Varslet taco", null, 4, null,
                [new IngredientRequest(null, "Mel", 400, "g", "linear", 0)],
                [new InstructionRequest(null, "Bland.", 0)]));
        response.EnsureSuccessStatusCode();

        Assert.True(await Arrived(memberSignal));
        // The outsider's silence is asserted with a short grace window: the
        // member's signal already proves delivery latency is far below it.
        await Task.Delay(500);
        Assert.False(outsiderSignal.IsCompleted);
    }

    [Fact]
    public async Task Sync_push_notifies_when_rows_apply()
    {
        var (client, auth) = await factory.RegisterUserAsync();
        await using var connection = await ConnectAsync(auth.AccessToken);
        var signal = Signal(connection);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var push = await client.PostAsJsonAsync("/api/v1/sync/push", new
        {
            recipes = new[]
            {
                new
                {
                    id = Guid.NewGuid(),
                    title = "Synk-varslet",
                    description = (string?)null,
                    servings = 4,
                    notes = (string?)null,
                    createdAt = now,
                    updatedAt = now,
                    deletedAt = (long?)null,
                    ingredients = Array.Empty<object>(),
                    instructions = Array.Empty<object>(),
                }
            },
            mealPlanEntries = (object?)null,
            shoppingItems = (object?)null,
        });
        push.EnsureSuccessStatusCode();

        Assert.True(await Arrived(signal));
    }

    [Fact]
    public async Task Join_notifies_the_target_household()
    {
        var (hostClient, hostAuth) = await factory.RegisterUserAsync();
        var (joinerClient, _) = await factory.RegisterUserAsync();
        await using var hostConnection = await ConnectAsync(hostAuth.AccessToken);
        var hostSignal = Signal(hostConnection);
        var household = await hostClient.GetFromJsonAsync<HouseholdResponse>("/api/v1/household");

        // Joiner has content so the join re-homes rows into the host household.
        var created = await joinerClient.PostAsJsonAsync(
            "/api/v1/recipes",
            new RecipeRequest(null, "Medgift", null, 2, null,
                [new IngredientRequest(null, "Salt", null, null, "fixed", 0)],
                [new InstructionRequest(null, "Ta med.", 0)]));
        created.EnsureSuccessStatusCode();
        var join = await joinerClient.PostAsJsonAsync(
            "/api/v1/household/join", new { code = household!.JoinCode });
        join.EnsureSuccessStatusCode();

        Assert.True(await Arrived(hostSignal));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test --filter RealtimeTests`
Expected: Task 1's tests green; the three new ones FAIL (no notifications sent). RED.

- [ ] **Step 3: Implement**

Create `backend/Ingredo.Api/Realtime/IChangeNotifier.cs`:

```csharp
namespace Ingredo.Api.Realtime;

public interface IChangeNotifier
{
    Task NotifyHouseholdChangedAsync(Guid householdId, CancellationToken cancellationToken = default);
}
```

Create `backend/Ingredo.Api/Realtime/SignalRChangeNotifier.cs`:

```csharp
using Microsoft.AspNetCore.SignalR;

namespace Ingredo.Api.Realtime;

public sealed class SignalRChangeNotifier(
    IHubContext<SyncHub> hub,
    ILogger<SignalRChangeNotifier> logger) : IChangeNotifier
{
    public async Task NotifyHouseholdChangedAsync(
        Guid householdId, CancellationToken cancellationToken = default)
    {
        try
        {
            await hub.Clients
                .Group(SyncHub.GroupName(householdId))
                .SendAsync("changed", cancellationToken);
        }
        catch (Exception exception)
        {
            // A notification must never fail the write that triggered it.
            logger.LogWarning(
                exception, "Change notification failed for household {HouseholdId}", householdId);
        }
    }
}
```

In `Program.cs`: `builder.Services.AddScoped<IChangeNotifier, SignalRChangeNotifier>();` with the other scoped registrations.

Notify calls — each service gains an `IChangeNotifier notifier` primary-constructor parameter and `using Ingredo.Api.Realtime;`:
- `RecipeService`, `MealPlanService`, `ShoppingService`: in `CreateAsync`/`UpdateAsync`/`DeleteAsync` ONLY, directly after the successful `await db.SaveChangesAsync(cancellationToken);` (never on NotFound/early-return paths, never in reads): `await notifier.NotifyHouseholdChangedAsync(householdId, cancellationToken);` (parameter name per method — it is `householdId` throughout).
- `SyncService.PushAsync`: after `await transaction.CommitAsync(cancellationToken);` add
  ```csharp
  if (results.Values.Contains(Applied))
  {
      await notifier.NotifyHouseholdChangedAsync(householdId, cancellationToken);
  }
  ```
  (the `Applied` constant already exists in the file).
- `HouseholdService.JoinAsync`: after its `transaction.CommitAsync`, notify the TARGET household id (the household the user joined — use the local variable holding it at that point; read the method to pick the right one).

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet build && dotnet test`
Expected: 0 warnings; 129/129 (126 + 3). The full suite also proves the constructor changes broke no existing service tests.

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add backend/
git commit -m "feat: broadcast household change notifications after durable writes"
```

---

### Task 3: Frontend realtime module

**Files:**
- Modify: `frontend/lib/api/session.ts` (one export), `frontend/package.json` (dependency)
- Create: `frontend/lib/sync/realtime.ts`
- Test: `frontend/__tests__/sync-realtime.test.ts`

**Interfaces:**
- Consumes: `getSession`/`getAccessToken` + the new `subscribeSession` from `lib/api/session.ts`; `refreshSession` from `lib/api/client.ts`; `getApiBaseUrl` from `lib/api/config.ts`; `syncNow` from `lib/sync/engine.ts`.
- Produces (used by Task 4): `initRealtime(): () => void`, `resetRealtimeForTests(): void`.

- [ ] **Step 0: Dependency**

```bash
cd /home/mrb/Work/Programming/ingredo/frontend
npx expo install @microsoft/signalr
```

(If `expo install` has no pinned mapping for it, `npm install @microsoft/signalr` is equivalent — it is a pure-JS package.)

- [ ] **Step 1: session export**

In `frontend/lib/api/session.ts`, below `useSession`:

```ts
// Non-React subscription for module-level listeners (the realtime
// connection reconciles on every session change).
export function subscribeSession(listener: () => void): () => void {
  return subscribe(listener);
}
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/__tests__/sync-realtime.test.ts`:

```ts
import { AppState } from 'react-native';

import { getSession, subscribeSession } from '../lib/api/session';
import { syncNow } from '../lib/sync/engine';
import { initRealtime, resetRealtimeForTests } from '../lib/sync/realtime';

const mockConnection = {
  on: jest.fn(),
  start: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
};

jest.mock('@microsoft/signalr', () => ({
  HubConnectionBuilder: jest.fn(() => ({
    withUrl: jest.fn().mockReturnThis(),
    withAutomaticReconnect: jest.fn().mockReturnThis(),
    configureLogging: jest.fn().mockReturnThis(),
    build: jest.fn(() => mockConnection),
  })),
  HttpTransportType: { WebSockets: 1 },
  LogLevel: { Warning: 2, None: 6 },
}));

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/api/config', () => ({ getApiBaseUrl: () => 'http://api.test' }));
jest.mock('../lib/api/client', () => ({ refreshSession: jest.fn(async () => true) }));
jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
  getAccessToken: jest.fn(() => 'access-1'),
  subscribeSession: jest.fn(() => () => {}),
}));
jest.mock('../lib/sync/engine', () => ({ syncNow: jest.fn(async () => 'synced') }));

const getSessionMock = getSession as jest.Mock;
const subscribeSessionMock = subscribeSession as jest.Mock;
const syncNowMock = syncNow as jest.Mock;

const signedIn = {
  status: 'signedIn',
  user: { id: 'u', email: 'e', displayName: 'd' },
  householdId: 'household-1',
  householdName: 'Hjemme',
};
const signedOut = { status: 'signedOut', user: null, householdId: null, householdName: null };

type AppStateListener = (state: string) => void;
let appStateListener: AppStateListener = () => {};
const removeMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  resetRealtimeForTests();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: AppStateListener
  ) => {
    appStateListener = listener;
    return { remove: removeMock };
  }) as never);
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('initRealtime', () => {
  it('connects when signed in and active', async () => {
    getSessionMock.mockReturnValue(signedIn);

    initRealtime();
    await flush();

    expect(mockConnection.start).toHaveBeenCalledTimes(1);
    expect(mockConnection.on).toHaveBeenCalledWith('changed', expect.any(Function));
  });

  it('does not connect signed out', async () => {
    getSessionMock.mockReturnValue(signedOut);

    initRealtime();
    await flush();

    expect(mockConnection.start).not.toHaveBeenCalled();
  });

  it('the changed handler triggers a sync', async () => {
    getSessionMock.mockReturnValue(signedIn);
    initRealtime();
    await flush();

    const handler = mockConnection.on.mock.calls.find((call) => call[0] === 'changed')![1];
    handler();
    await flush();

    expect(syncNowMock).toHaveBeenCalled();
  });

  it('backgrounding stops the connection', async () => {
    getSessionMock.mockReturnValue(signedIn);
    initRealtime();
    await flush();

    appStateListener('background');
    await flush();

    expect(mockConnection.stop).toHaveBeenCalled();
  });

  it('sign-out stops the connection via the session subscription', async () => {
    getSessionMock.mockReturnValue(signedIn);
    initRealtime();
    await flush();
    const sessionListener = subscribeSessionMock.mock.calls[0][0] as () => void;

    getSessionMock.mockReturnValue(signedOut);
    sessionListener();
    await flush();

    expect(mockConnection.stop).toHaveBeenCalled();
  });

  it('a household change restarts the connection', async () => {
    getSessionMock.mockReturnValue(signedIn);
    initRealtime();
    await flush();
    const sessionListener = subscribeSessionMock.mock.calls[0][0] as () => void;

    getSessionMock.mockReturnValue({ ...signedIn, householdId: 'household-2' });
    sessionListener();
    await flush();
    await flush();

    expect(mockConnection.stop).toHaveBeenCalledTimes(1);
    expect(mockConnection.start).toHaveBeenCalledTimes(2);
  });

  it('teardown unsubscribes and stops', async () => {
    getSessionMock.mockReturnValue(signedIn);
    const teardown = initRealtime();
    await flush();

    teardown();
    await flush();

    expect(removeMock).toHaveBeenCalled();
    expect(mockConnection.stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/sync-realtime.test.ts`
Expected: FAIL — cannot find module `../lib/sync/realtime`.

- [ ] **Step 4: Implement**

Create `frontend/lib/sync/realtime.ts`:

```ts
import {
  HttpTransportType,
  HubConnectionBuilder,
  LogLevel,
  type HubConnection,
} from '@microsoft/signalr';
import { AppState, type AppStateStatus } from 'react-native';

import { refreshSession } from '../api/client';
import { getApiBaseUrl } from '../api/config';
import { getAccessToken, getSession, subscribeSession } from '../api/session';
import { db } from '../db/client';
import { syncNow } from './engine';

// Realtime is an accelerator, never a dependency: a connection exists
// exactly when the user is signed in AND the app is foregrounded, every
// failure is silent, and the only thing a message does is nudge syncNow()
// — the engine's other triggers remain the correctness path.
let connection: HubConnection | null = null;
let connectedHouseholdId: string | null = null;
let appActive = AppState.currentState === 'active';

function shouldConnect(): boolean {
  return appActive && getSession().status === 'signedIn';
}

async function start(): Promise<void> {
  if (connection) return;
  connectedHouseholdId = getSession().householdId;
  const target = new HubConnectionBuilder()
    .withUrl(`${getApiBaseUrl(db)}/hubs/sync`, {
      transport: HttpTransportType.WebSockets,
      skipNegotiation: true,
      accessTokenFactory: async () => {
        if (!getAccessToken()) await refreshSession();
        return getAccessToken() ?? '';
      },
    })
    .withAutomaticReconnect()
    .configureLogging(__DEV__ ? LogLevel.Warning : LogLevel.None)
    .build();
  target.on('changed', () => {
    void syncNow();
  });
  connection = target;
  try {
    await target.start();
  } catch {
    // Silent: the next reconcile (foreground/session change) retries.
    if (connection === target) {
      connection = null;
      connectedHouseholdId = null;
    }
  }
}

async function stop(): Promise<void> {
  const current = connection;
  connection = null;
  connectedHouseholdId = null;
  if (current) {
    try {
      await current.stop();
    } catch {
      // Silent.
    }
  }
}

function reconcile(): void {
  if (!shouldConnect()) {
    void stop();
    return;
  }
  if (connection && connectedHouseholdId !== getSession().householdId) {
    // Join/leave/account switch rotated the household claim: reconnect so
    // the socket lands in the new household's group.
    void stop().then(() => {
      if (shouldConnect()) void start();
    });
    return;
  }
  if (!connection) void start();
}

export function initRealtime(): () => void {
  const unsubscribeSession = subscribeSession(reconcile);
  const appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    appActive = state === 'active';
    reconcile();
  });
  reconcile();
  return () => {
    unsubscribeSession();
    appStateSubscription.remove();
    void stop();
  };
}

export function resetRealtimeForTests(): void {
  connection = null;
  connectedHouseholdId = null;
  appActive = true;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/sync-realtime.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 7/7; full suite green (342 + 7 = 349).

- [ ] **Step 6: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add realtime connection triggering sync on change messages"
```

---

### Task 4: Wiring, docs, full verification

**Files:**
- Modify: `frontend/app/_layout.tsx`, `backend/README.md`, root `docs/TESTING.md`

**Interfaces:**
- Consumes: Task 3 `initRealtime`.

- [ ] **Step 1: Wire the root layout**

In `frontend/app/_layout.tsx`: add `import { initRealtime } from '../lib/sync/realtime';` and change the ready-effect's tail from `return initSyncTriggers();` to:

```tsx
      const teardownTriggers = initSyncTriggers();
      const teardownRealtime = initRealtime();
      return () => {
        teardownTriggers();
        teardownRealtime();
      };
```

Run the frontend gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit && npx expo export --platform android --output-dir /tmp/claude-1000/export-check`
Expected: 349/349 (no new tests; if any existing screen test breaks on compilation, add ONLY the minimal `jest.mock('../lib/sync/realtime', ...)` entries compile-forced, disclosed).

- [ ] **Step 2: Backend smoke (negotiate round-trip through compose)**

```bash
cd /home/mrb/Work/Programming/ingredo/backend
dotnet build && dotnet test
docker compose up -d --build
for i in $(seq 1 30); do curl -sf http://localhost:8080/health >/dev/null && break; sleep 1; done
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"realtime@test.local","password":"passord123","displayName":"Realtime"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST "http://localhost:8080/hubs/sync/negotiate?negotiateVersion=1&access_token=$TOKEN" | grep -o '"connectionId"' && echo NEGOTIATE-OK
curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:8080/hubs/sync/negotiate?negotiateVersion=1"
docker compose down
```

Expected: `NEGOTIATE-OK` with a connection id; the anonymous negotiate prints `401`.

- [ ] **Step 3: Docs**

`backend/README.md`, after the Sync section:

```markdown
## Realtime

- `/hubs/sync` — SignalR hub, `[Authorize]`d, WebSocket clients pass the
  access token as `?access_token=` (accepted only on hub paths). Clients
  never invoke anything; the server sends one message, `changed`, to the
  `household:<id>` group after every durable content write. Clients answer
  by pulling — the socket carries no data.
```

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Realtime sync (manual pass)

Backend running, two devices signed into the same household, BOTH apps foregrounded.

- Check off a shopping item on device A → it updates on device B within a couple of seconds, untouched.
- Add/edit/delete a recipe or plan entry on A → appears on B similarly fast.
- Background B, make changes on A, foreground B → changes arrive via the ordinary foreground sync (realtime reconnects too).
- Stop the backend mid-session: nothing breaks or alerts; edits queue as dirty. Start it again → next trigger (foreground/edit/Sync now) delivers, and realtime quietly reconnects.
- Sign out on one device: its socket closes (no reconnect spam in the backend logs); the other device is unaffected.
```

- [ ] **Step 4: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/ backend/README.md docs/TESTING.md
git commit -m "feat: wire realtime into startup; document the hub"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (empty-surface hub, group join, one message → T1/T2), 2 (query-token scoped to /hubs + guard applies → T1, incl. dead-household rejection test), 3 (notifier seam, after-durable-write, success-only, push-applied condition, join-target, swallow-failures → T2), 4 (lifecycle gating, accessTokenFactory with refresh, reconnect, householdId restart → T3), 5 (silence → T3 code + T4 manual checklist line), 6 (both test suites + manual → T1–T4). Goals' accelerator-not-dependency: the stopped-backend checklist line + the module's catch-and-null.
- **Judgment calls:** outsider-silence asserted with a 500 ms grace window after the member's signal proves sub-window latency — the standard practical negative-assertion trade. `IChangeNotifier` is Scoped (hub context is singleton-safe; scoped keeps it uniform with the services consuming it). The frontend module imports the engine statically — realtime.ts is only ever imported by `_layout` (repo-land never touches it), so the trigger.ts laziness rule doesn't apply. `resetRealtimeForTests` sets `appActive = true` so tests don't depend on jest's AppState default. Push notification condition uses the existing `Applied` constant; `superseded`-only batches notify nothing (no server change happened).
- **Type consistency check:** `SyncHub.GroupName(Guid)` matches notifier usage; `NotifyHouseholdChangedAsync(Guid, CancellationToken)` matches every call site; `initRealtime(): () => void` matches the layout composition; `subscribeSession` name matches T3's import and the session.ts addition; mock shapes match the builder-chain API actually used in realtime.ts.
- **Mock-prefix rule:** `mockConnection` is the only outer variable referenced inside the `jest.mock` factory — prefixed. AppState is spied, not module-mocked.
