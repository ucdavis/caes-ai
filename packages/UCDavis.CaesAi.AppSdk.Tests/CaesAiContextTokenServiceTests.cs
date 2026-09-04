using Microsoft.Extensions.Options;

namespace UCDavis.CaesAi.AppSdk.Tests;

public sealed class CaesAiContextTokenServiceTests
{
    private readonly AdjustableTimeProvider _time = new(
        new DateTimeOffset(2026, 9, 1, 12, 0, 0, TimeSpan.Zero));
    private readonly CaesAiAppOptions _options = new()
    {
        ContextSigningKey = "a-test-signing-key-that-is-at-least-thirty-two-bytes"
    };

    [Fact]
    public void ValidTokenReturnsItsUserReference()
    {
        var service = CreateService();

        var token = service.Create("demo-user-1");

        Assert.True(service.TryValidate(token, out var userReference));
        Assert.Equal("demo-user-1", userReference);
    }

    [Fact]
    public void ModifiedSignatureFails()
    {
        var service = CreateService();
        var token = service.Create("demo-user-1");
        var modified = $"{token[..^1]}{(token[^1] == 'a' ? 'b' : 'a')}";

        Assert.False(service.TryValidate(modified, out _));
    }

    [Fact]
    public void ConfiguredLifetimeControlsExpiration()
    {
        _options.ContextTokenLifetime = TimeSpan.FromMinutes(5);
        var service = CreateService();
        var token = service.Create("demo-user-1");

        _time.Advance(TimeSpan.FromMinutes(6));

        Assert.False(service.TryValidate(token, out _));
    }

    private CaesAiContextTokenService CreateService() =>
        new(Options.Create(_options), _time);

    private sealed class AdjustableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan duration) => _now = _now.Add(duration);
    }
}
