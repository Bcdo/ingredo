namespace Ingredo.Api.Tests.Integration;

// HealthTests and RecipesApiTests each boot their own WebApplicationFactory<Program>
// host (one Postgres Testcontainer per class, per ApiFactory's IClassFixture design).
// Program.cs assigns Serilog's static Log.Logger during startup and later freezes it
// via UseSerilog; xUnit runs test classes in different collections in parallel by
// default, so two hosts booting concurrently race on that shared static field and the
// host that loses throws "The logger is already frozen." Grouping both classes into
// one named collection serializes them relative to each other while leaving unrelated
// test classes (e.g. the validator tests) free to run in parallel.
[CollectionDefinition("Api")]
public sealed class ApiTestCollection;
