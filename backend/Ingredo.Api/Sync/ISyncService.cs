namespace Ingredo.Api.Sync;

public interface ISyncService
{
    Task<SyncPullResponse> PullAsync(Guid householdId, long since, CancellationToken cancellationToken);
    Task<SyncPushResponse> PushAsync(Guid householdId, SyncPushRequest request, CancellationToken cancellationToken);
}
