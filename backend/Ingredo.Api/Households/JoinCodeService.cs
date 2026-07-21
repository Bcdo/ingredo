using Ingredo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Ingredo.Api.Households;

public interface IJoinCodeService
{
    Task<string> NewUniqueCodeAsync(CancellationToken cancellationToken);
}

public sealed class JoinCodeService(AppDbContext db) : IJoinCodeService
{
    public async Task<string> NewUniqueCodeAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var code = JoinCodeGenerator.NewCode();
            var taken = await db.Households.AnyAsync(h => h.JoinCode == code, cancellationToken);
            if (!taken) return code;
        }
        throw new InvalidOperationException("Could not generate a unique join code.");
    }
}
