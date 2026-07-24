# Realtime Sync — Design Spec

**Date:** 2026-07-24
**Slice:** Phase 6 (roadmap: realtime). One slice, both sides: a SignalR change-notification channel that makes household changes appear on other devices within a couple of seconds — by triggering the Phase 5 engine's `syncNow()`, never by moving data itself.
**Scope:** backend `Realtime/` feature (hub, notifier, JWT-over-WebSocket auth wiring, notify calls in the content services), frontend `lib/sync/realtime.ts` (foreground-only connection lifecycle, changed → `syncNow()`), tests both sides.
**Builds on:** Phase 5 complete — the sync engine (`syncNow()` is a serialized, coalescing-safe entry point; extra triggers are free), the fail-closed household guard, HS256 access tokens with the `household` claim, the `ApiFactory` Testcontainers rig, the `lib/api/session` store and `AppState` trigger wiring.

## Goals

- Two signed-in devices in one household see each other's changes within ~1–2 s while both apps are foregrounded (the shared-grocery-run case), without touching the sync mechanism.
- Realtime is an accelerator, never a dependency: with the socket down or the library failing entirely, everything still syncs via the existing triggers.
- Signed out (or backgrounded), no socket exists — zero connections, zero battery cost, the signed-out invariant untouched.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Background push notifications (app closed) | Not planned this phase — needs FCM/APNs, a different animal |
| Payload-carrying messages (sending rows over the socket) | Never — the engine pulls; the socket only nudges (umbrella decision 8) |
| Presence/typing indicators | No use case |
| Scale-out backplane (Redis) for multiple API instances | Single-instance deployment; revisit with hosting |
| Rate limiting on hub connections | Standing pre-public-exposure item, with the rest |

## Key decisions

1. **SignalR, empty-surface hub.** `Realtime/SyncHub.cs` with `[Authorize]` and NO client-invokable methods — clients only listen. `OnConnectedAsync` parses the `household` claim (`TokenService.HouseholdClaim`) and adds the connection to group `household:<guid>`. Server → client wire contract is ONE message name, `changed`, with no arguments. No client → server surface means no new input validation surface. SignalR is built into ASP.NET Core — zero new backend packages; `app.MapHub<SyncHub>("/hubs/sync")`.
2. **JWT over WebSocket via the standard query-token pattern.** WebSockets cannot carry an Authorization header from JS clients; the existing JWT bearer setup gains an `OnMessageReceived` handler that reads `access_token` from the query string ONLY when the request path starts with `/hubs/` — the REST surface is unaffected. The fail-closed `HouseholdGuardMiddleware` applies to the hub's HTTP handshake like any endpoint (the hub carries `IAuthorizeData` metadata, not `IAllowAnonymous`): dead-household tokens cannot connect.
3. **`IChangeNotifier` with one method** — `Task NotifyHouseholdChangedAsync(Guid householdId)` — implemented by `SignalRChangeNotifier` (`IHubContext<SyncHub>`, sends `changed` to group `household:<id>`), registered in DI. Called AFTER the write is durable: at the end of successful mutating operations in `RecipeService`, `MealPlanService`, `ShoppingService` (create/update/delete paths; reads never notify) and after `SyncService.PushAsync`'s transaction commit when the batch applied at least one row. Household join additionally notifies the TARGET household (re-homed content appeared). Notification failures are swallowed (log-only): a notify must never fail the write that triggered it. The pusher receives its own notification — deliberate; the client engine's mutex/coalescing absorbs the resulting near-empty cycle, which is cheaper than connection-exclusion plumbing.
4. **Frontend module `lib/sync/realtime.ts`**, new dependency `@microsoft/signalr`. Lifecycle mirrors the existing trigger gating: a connection exists exactly when `session.status === 'signedIn'` AND `AppState` is `active`. Wiring: `initRealtime()` called from the root layout's ready-effect (alongside `initSyncTriggers()`), subscribing to session changes and AppState transitions; sign-out or backgrounding stops the connection; sign-in or foregrounding (re)starts it. On the `changed` message: `void syncNow()` — nothing else. Transport: WebSockets with `skipNegotiation` (React Native has no SSE; skipping negotiation avoids a wasted round-trip), `accessTokenFactory` returns the in-memory access token, refreshing first via the existing `refreshSession()` when none is held; `withAutomaticReconnect` with the default backoff. A `session.householdId` change (join/leave rotates tokens) restarts the connection so the socket lands in the new household's group.
5. **Failure semantics: silence.** Connection errors, reconnect exhaustion, or the library failing to load change nothing user-visible — no status UI, no toasts (`__DEV__` console logging only). The engine's foreground/debounce/manual triggers remain the correctness path; realtime only shortens the latency between them. No realtime state is persisted.
6. **Testing.** Backend, on the existing rig: real `HubConnection` clients against the test server (LongPolling transport over `factory.Server.CreateHandler()` — WebSockets don't run over TestServer): valid-token connect succeeds and receives `changed` when a housemate writes via CRUD and via sync push; a connection from another household receives nothing; anonymous connect and dead-household-token connect are rejected. Frontend: jest with `@microsoft/signalr` mocked — connect on signedIn+active, disconnect on background and on sign-out, reconnect configuration present, `changed` handler calls `syncNow()`, householdId change restarts. Manual: two devices foregrounded, a change on one appears on the other within a couple of seconds without touching it; killing the backend mid-session degrades gracefully to the existing triggers.

## Components

- `backend/Ingredo.Api/Realtime/SyncHub.cs` — the hub (group join on connect).
- `backend/Ingredo.Api/Realtime/IChangeNotifier.cs`, `SignalRChangeNotifier.cs` — the notify seam.
- `backend/Ingredo.Api/Program.cs` — SignalR registration, hub mapping, DI; `Auth/AuthSetupExtensions.cs` (or equivalent) — the `OnMessageReceived` query-token handler.
- `Recipes/RecipeService.cs`, `MealPlan/MealPlanService.cs`, `Shopping/ShoppingService.cs`, `Sync/SyncService.cs`, `Households/HouseholdService.cs` (join) — notify calls after durable writes.
- `frontend/lib/sync/realtime.ts` — connection lifecycle + changed→syncNow.
- `frontend/app/_layout.tsx` — `initRealtime()` in the ready-effect.
- Tests: `backend/Ingredo.Api.Tests/Integration/RealtimeTests.cs`; `frontend/__tests__/sync-realtime.test.ts`.

## Error handling

Per decisions 3 and 5: notify-after-commit failures are logged and swallowed server-side; all client-side connection failures are silent, dev-logged, and non-blocking.

## Testing

Per decision 6. The headline assertions: notification reaches the household group (both write paths), never crosses households, and auth is enforced at the handshake. Frontend lifecycle matrix: (signedIn × active) drives connection existence.

## Rollout

Feature branch `feature/realtime-sync` off `develop`. New frontend dependency: `@microsoft/signalr`. Compose unchanged (same port; WebSocket upgrade over the existing Kestrel endpoint). Docs: README endpoints section + TESTING.md manual pass. Phase 7 (smart features) is untouched by this slice.
