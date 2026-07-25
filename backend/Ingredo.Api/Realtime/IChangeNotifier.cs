namespace Ingredo.Api.Realtime;

public interface IChangeNotifier
{
    Task NotifyHouseholdChangedAsync(Guid householdId, CancellationToken cancellationToken = default);
}
