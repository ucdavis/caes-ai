using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace UCDavis.CaesAi.AppSdk;

public interface ICaesAiCallbackTokenValidator
{
    Task<bool> ValidateAsync(
        string token,
        ReadOnlyMemory<byte> requestBody,
        ToolExecutionRequest request,
        CancellationToken cancellationToken);
}

/// <summary>
/// Validates a short-lived CAES AI callback token and binds it to the exact request body.
/// </summary>
public sealed class CaesAiCallbackTokenValidator : ICaesAiCallbackTokenValidator
{
    public const string HttpClientName = "CaesAi.CallbackJwks";
    public const string TokenType = "caes-ai-tool-callback+jwt";
    public const string TokenSubject = "caes-ai-tool-service";

    private const string Algorithm = SecurityAlgorithms.EcdsaSha256;
    private const string JwksPath = "/.well-known/jwks.json";
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly CaesAiAppOptions _options;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<CaesAiCallbackTokenValidator> _logger;
    private readonly object _refreshGate = new();
    private IReadOnlyDictionary<string, SecurityKey> _signingKeys =
        new Dictionary<string, SecurityKey>(StringComparer.Ordinal);
    private DateTimeOffset _loadedAt = DateTimeOffset.MinValue;
    private DateTimeOffset _retryAfter = DateTimeOffset.MinValue;
    private DateTimeOffset _unknownRefreshAfter = DateTimeOffset.MinValue;
    private Task? _refreshTask;

    public CaesAiCallbackTokenValidator(
        IHttpClientFactory httpClientFactory,
        IOptions<CaesAiAppOptions> options,
        TimeProvider timeProvider,
        ILogger<CaesAiCallbackTokenValidator> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public async Task<bool> ValidateAsync(
        string token,
        ReadOnlyMemory<byte> requestBody,
        ToolExecutionRequest request,
        CancellationToken cancellationToken)
    {
        JsonWebToken untrustedToken;
        try
        {
            untrustedToken = new JsonWebToken(token);
        }
        catch (ArgumentException)
        {
            return false;
        }

        if (!string.Equals(untrustedToken.Alg, Algorithm, StringComparison.Ordinal) ||
            !string.Equals(untrustedToken.Typ, TokenType, StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(untrustedToken.Kid))
        {
            return false;
        }

        var signingKey = await ResolveSigningKeyAsync(untrustedToken.Kid, cancellationToken);
        if (signingKey is null)
        {
            return false;
        }

        var issuer = (_options.CallbackIssuer ?? _options.ServerUrl).TrimEnd('/');
        var validation = await new JsonWebTokenHandler().ValidateTokenAsync(
            token,
            new TokenValidationParameters
            {
                ValidAlgorithms = [Algorithm],
                ValidAudience = $"caes-ai-app:{_options.ApplicationId}",
                ValidIssuer = issuer,
                ValidTypes = [TokenType],
                IssuerSigningKey = signingKey,
                ValidateAudience = true,
                ValidateIssuer = true,
                ValidateIssuerSigningKey = true,
                ValidateLifetime = true,
                RequireExpirationTime = true,
                RequireSignedTokens = true,
                ClockSkew = _options.CallbackTokenClockSkew
            });

        if (!validation.IsValid || validation.SecurityToken is not JsonWebToken verifiedToken)
        {
            return false;
        }

        return ClaimMatches(verifiedToken, "sub", TokenSubject) &&
            HasClaim(verifiedToken, "jti") &&
            HasClaim(verifiedToken, "iat") &&
            HasClaim(verifiedToken, "nbf") &&
            ClaimMatches(verifiedToken, "sessionId", request.SessionId.ToString()) &&
            ClaimMatches(verifiedToken, "toolCallId", request.ToolCallId) &&
            ClaimMatches(verifiedToken, "toolName", request.ToolName) &&
            ClaimMatches(verifiedToken, "toolManifestHash", request.ToolManifestHash) &&
            ClaimMatches(verifiedToken, "requestHash", HashBody(requestBody.Span));
    }

    private async Task<SecurityKey?> ResolveSigningKeyAsync(
        string kid,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Task? refresh;
        lock (_refreshGate)
        {
            var now = _timeProvider.GetUtcNow();
            var cached = CachedKey(kid, now);
            if (cached is not null && now < _loadedAt + _options.JwksRefreshInterval)
            {
                return cached;
            }

            // One refresh serves all callers. Unknown IDs get a bounded refresh opportunity.
            refresh = _refreshTask is { IsCompleted: false } ? _refreshTask : null;
            if (refresh is null && now >= _retryAfter &&
                (cached is not null || now >= _unknownRefreshAfter))
            {
                if (cached is null && _signingKeys.Count > 0)
                {
                    _unknownRefreshAfter = now + _options.JwksRetryInterval;
                }
                refresh = _refreshTask = RefreshKeysAsync();
            }
            // A slow JWKS endpoint must not hold callbacks with a still-trusted key hostage.
            if (cached is not null) return CachedKey(kid, _timeProvider.GetUtcNow());
        }

        if (refresh is not null) await refresh.WaitAsync(cancellationToken);
        lock (_refreshGate)
        {
            return CachedKey(kid, _timeProvider.GetUtcNow());
        }
    }

    // Call only under _refreshGate; stale trust is measured from the last successful fetch.
    private SecurityKey? CachedKey(string kid, DateTimeOffset now) =>
        now < _loadedAt + _options.JwksMaximumKeyAge
            ? _signingKeys.GetValueOrDefault(kid)
            : null;

    private async Task RefreshKeysAsync()
    {
        try
        {
            // Refresh lifetime belongs to the cache, not to whichever callback triggered it.
            using var timeout = new CancellationTokenSource(_options.JwksRequestTimeout);
            var client = _httpClientFactory.CreateClient(HttpClientName);
            var json = await client.GetStringAsync(JwksPath, timeout.Token);
            var keySet = new JsonWebKeySet(json);
            var supported = keySet.Keys.Where(IsSupportedSigningKey).ToArray();
            if (supported.Length == 0 || supported.GroupBy(key => key.Kid).Any(group => group.Count() != 1))
            {
                throw new InvalidOperationException("CAES AI published an invalid signing key set.");
            }
            var refreshed = supported.ToDictionary(key => key.Kid, key => (SecurityKey)key, StringComparer.Ordinal);
            lock (_refreshGate)
            {
                // A successful refresh replaces the whole set, including retired keys.
                _signingKeys = refreshed;
                _loadedAt = _timeProvider.GetUtcNow();
                _retryAfter = DateTimeOffset.MinValue;
            }
        }
        catch (Exception exception) when (
            exception is HttpRequestException or OperationCanceledException or
                ArgumentException or InvalidOperationException)
        {
            lock (_refreshGate)
            {
                _retryAfter = _timeProvider.GetUtcNow() + _options.JwksRetryInterval;
            }
            _logger.LogWarning("CAES AI JWKS refresh failed; cached keys remain usable only within their maximum age.");
        }
    }

    private static bool IsSupportedSigningKey(JsonWebKey key) =>
        !string.IsNullOrWhiteSpace(key.Kid) &&
        string.Equals(key.Kty, "EC", StringComparison.Ordinal) &&
        string.Equals(key.Crv, "P-256", StringComparison.Ordinal) &&
        string.Equals(key.Alg, Algorithm, StringComparison.Ordinal) &&
        string.Equals(key.Use, "sig", StringComparison.Ordinal);

    private static bool ClaimMatches(JsonWebToken token, string name, string expected) =>
        token.TryGetClaim(name, out var claim) &&
        string.Equals(claim.Value, expected, StringComparison.Ordinal);

    private static bool HasClaim(JsonWebToken token, string name) =>
        token.TryGetClaim(name, out var claim) && !string.IsNullOrWhiteSpace(claim.Value);

    private static string HashBody(ReadOnlySpan<byte> body) =>
        WebEncoders.Base64UrlEncode(SHA256.HashData(body));
}
