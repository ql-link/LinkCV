using LinkResume.App;
using LinkResume.Core.Session;
using Xunit;

namespace LinkResume.Platform.Tests;

public class CredentialLockerTests
{
    public static bool Enabled => OperatingSystem.IsWindows() && Environment.GetEnvironmentVariable("RUN_DESKTOP_CREDENTIAL_TESTS") == "1";

    [Fact(SkipUnless = nameof(Enabled))]
    public void RealCredentialLockerRoundTripRotationAndScopeIsolation()
    {
        var store = new CredentialLockerTokenStore();
        var scope = $"LinkResume:fixture:{Guid.NewGuid()}";
        var other = $"LinkResume:fixture:{Guid.NewGuid()}";
        try
        {
            Assert.Null(store.Load(scope));
            var journal = new RefreshJournal(Guid.NewGuid().ToString(), "fixture-refresh", DateTimeOffset.UtcNow);
            var original = new DesktopCredentialRecord("1", "fixture-refresh", Guid.NewGuid(), journal);
            store.Save(scope, original);
            Assert.Equal(original, store.Load(scope));
            Assert.Null(store.Load(other));
            var rotated = original with { RefreshToken = "fixture-rotated", Pending = null };
            store.Save(scope, rotated);
            Assert.Equal(rotated, store.Load(scope));
            store.Clear(scope);
            store.Clear(scope);
            Assert.Null(store.Load(scope));
        }
        finally { store.Clear(scope); store.Clear(other); }
    }
}
