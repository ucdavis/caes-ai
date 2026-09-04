using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace UCDavis.CaesAi.AppSdk.Tests;

public sealed class CaesAiCallbackTokenValidatorTests
{
    [Fact]
    public async Task ValidatesSignatureStandardClaimsAndRequestBinding()
    {
        using var key = SigningKey.Create("key-1");
        var request = CreateRequest();
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonSerializerOptions.Web);
        var server = new JwksHandler(key.PublicJwk);
        var validator = CreateValidator(server);

        var valid = await validator.ValidateAsync(
            IssueToken(key, request, body),
            body,
            request,
            CancellationToken.None);

        Assert.True(valid);
        Assert.Equal(1, server.RequestCount);
    }

    [Fact]
    public async Task RejectsModifiedSignatureExpiredTokenAndWrongTrustClaims()
    {
        using var key = SigningKey.Create("key-1");
        var request = CreateRequest();
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonSerializerOptions.Web);
        var server = new JwksHandler(key.PublicJwk);
        var validator = CreateValidator(server);

        var token = IssueToken(key, request, body);
        var parts = token.Split('.');
        parts[2] = (parts[2][0] == 'a' ? 'b' : 'a') + parts[2][1..];
        Assert.False(await validator.ValidateAsync(
            string.Join('.', parts), body, request, CancellationToken.None));
        Assert.False(await validator.ValidateAsync(
            IssueToken(key, request, body, expiresAt: DateTime.UtcNow.AddMinutes(-1)),
            body,
            request,
            CancellationToken.None));
        Assert.False(await validator.ValidateAsync(
            IssueToken(key, request, body, audience: "caes-ai-app:other-app"),
            body,
            request,
            CancellationToken.None));
        Assert.False(await validator.ValidateAsync(
            IssueToken(key, request, body, issuer: "https://impostor.test"),
            body,
            request,
            CancellationToken.None));
        Assert.False(await validator.ValidateAsync(
            IssueToken(key, request, body, tokenType: "JWT"),
            body,
            request,
            CancellationToken.None));
    }

    [Fact]
    public async Task RejectsAValidTokenWhenTheBodyOrToolClaimsChange()
    {
        using var key = SigningKey.Create("key-1");
        var request = CreateRequest();
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonSerializerOptions.Web);
        var validator = CreateValidator(new JwksHandler(key.PublicJwk));
        var token = IssueToken(key, request, body);
        var changedBody = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(body) + " ");
        var changedRequest = request with { ToolName = "other_tool" };

        Assert.False(await validator.ValidateAsync(
            token, changedBody, request, CancellationToken.None));
        Assert.False(await validator.ValidateAsync(
            token, body, changedRequest, CancellationToken.None));
    }

    [Fact]
    public async Task RefreshesForANewKidRetainsOverlapKeysAndFallsBackToLastKnownGood()
    {
        using var oldKey = SigningKey.Create("old-key");
        using var newKey = SigningKey.Create("new-key");
        var request = CreateRequest();
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonSerializerOptions.Web);
        var server = new JwksHandler(oldKey.PublicJwk);
        var time = new AdjustableTimeProvider(DateTimeOffset.UtcNow);
        var validator = CreateValidator(server, time, TimeSpan.FromMinutes(1));

        Assert.True(await validator.ValidateAsync(
            IssueToken(oldKey, request, body), body, request, CancellationToken.None));

        server.SetKeys(oldKey.PublicJwk, newKey.PublicJwk);
        Assert.True(await validator.ValidateAsync(
            IssueToken(newKey, request, body), body, request, CancellationToken.None));
        Assert.Equal(2, server.RequestCount);

        time.Advance(TimeSpan.FromMinutes(2));
        server.FailRequests = true;
        Assert.True(await validator.ValidateAsync(
            IssueToken(oldKey, request, body), body, request, CancellationToken.None));
        Assert.Equal(3, server.RequestCount);
    }

    private static CaesAiCallbackTokenValidator CreateValidator(
        JwksHandler handler,
        TimeProvider? timeProvider = null,
        TimeSpan? refreshInterval = null) =>
        new(
            new TestHttpClientFactory(handler),
            Options.Create(new CaesAiAppOptions
            {
                ServerUrl = "https://caes-ai.test",
                ApplicationId = "todo-app",
                ApplicationApiKey = "application-key-long-enough",
                ContextSigningKey = "context-signing-key-at-least-32-characters",
                CallbackTokenClockSkew = TimeSpan.Zero,
                JwksRefreshInterval = refreshInterval ?? TimeSpan.FromMinutes(15)
            }),
            timeProvider ?? TimeProvider.System,
            NullLogger<CaesAiCallbackTokenValidator>.Instance);

    [Fact]
    public async Task SharesSlowRefreshWithoutBlockingKnownKeysAndBacksOffAfterFailure()
    {
        using var key = SigningKey.Create("known");
        var time = new AdjustableTimeProvider(DateTimeOffset.UtcNow);
        var server = new JwksHandler(key.PublicJwk);
        var validator = CreateValidator(server, time, TimeSpan.FromMinutes(1));
        var request = CreateRequest();
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonSerializerOptions.Web);
        var token = IssueToken(key, request, body);
        Assert.True(await validator.ValidateAsync(token, body, request, CancellationToken.None));
        time.Advance(TimeSpan.FromMinutes(2));
        server.Gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        server.FailRequests = true;
        var validations = Enumerable.Range(0, 20).Select(_ => validator.ValidateAsync(token, body, request, CancellationToken.None));
        Assert.All(await Task.WhenAll(validations).WaitAsync(TimeSpan.FromSeconds(1)), Assert.True);
        Assert.Equal(2, server.RequestCount);
        server.Gate.SetResult();
        // Wait for the shared failed refresh using an uncached key, then check the cooldown.
        using var unknown = SigningKey.Create("unknown");
        Assert.False(await validator.ValidateAsync(IssueToken(unknown, request, body), body, request, CancellationToken.None));
        for (var i = 0; i < 10; i++) Assert.True(await validator.ValidateAsync(token, body, request, CancellationToken.None));
        Assert.Equal(2, server.RequestCount);
        time.Advance(TimeSpan.FromHours(2));
        Assert.False(await validator.ValidateAsync(token, body, request, CancellationToken.None));
        Assert.Equal(3, server.RequestCount);
    }

    [Fact]
    public async Task BoundsUnknownKeyRefreshesAndRemovesRetiredKeys()
    {
        using var oldKey = SigningKey.Create("old");
        using var newKey = SigningKey.Create("new");
        using var unknown = SigningKey.Create("unknown");
        var time = new AdjustableTimeProvider(DateTimeOffset.UtcNow);
        var server = new JwksHandler(oldKey.PublicJwk);
        var validator = CreateValidator(server, time, TimeSpan.FromMinutes(1));
        var request = CreateRequest();
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonSerializerOptions.Web);
        Assert.True(await validator.ValidateAsync(IssueToken(oldKey, request, body), body, request, CancellationToken.None));
        server.SetKeys(newKey.PublicJwk);
        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ =>
            validator.ValidateAsync(IssueToken(unknown, request, body), body, request, CancellationToken.None)));
        Assert.All(results, Assert.False);
        Assert.Equal(2, server.RequestCount);
        Assert.False(await validator.ValidateAsync(IssueToken(oldKey, request, body), body, request, CancellationToken.None));
        Assert.True(await validator.ValidateAsync(IssueToken(newKey, request, body), body, request, CancellationToken.None));
        Assert.Equal(2, server.RequestCount);
    }

    [Fact]
    public async Task CallerCancellationDoesNotCancelTheSharedRefresh()
    {
        using var key = SigningKey.Create("known");
        var server = new JwksHandler(key.PublicJwk) { Gate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        var validator = CreateValidator(server);
        var request = CreateRequest();
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonSerializerOptions.Web);
        var token = IssueToken(key, request, body);
        using var cancellation = new CancellationTokenSource();
        var first = validator.ValidateAsync(token, body, request, cancellation.Token);
        var second = validator.ValidateAsync(token, body, request, CancellationToken.None);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        server.Gate.SetResult();
        Assert.True(await second);
        Assert.Equal(1, server.RequestCount);
    }

    [Fact]
    public async Task RejectsDuplicateKeysWithoutDiscardingThePreviousGoodSet()
    {
        using var key = SigningKey.Create("known");
        var time = new AdjustableTimeProvider(DateTimeOffset.UtcNow);
        var server = new JwksHandler(key.PublicJwk);
        var validator = CreateValidator(server, time, TimeSpan.FromMinutes(1));
        var request = CreateRequest();
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonSerializerOptions.Web);
        var token = IssueToken(key, request, body);
        Assert.True(await validator.ValidateAsync(token, body, request, CancellationToken.None));
        time.Advance(TimeSpan.FromMinutes(2));
        server.SetKeys(key.PublicJwk, key.PublicJwk);
        Assert.True(await validator.ValidateAsync(token, body, request, CancellationToken.None));
        Assert.True(await validator.ValidateAsync(token, body, request, CancellationToken.None));
        Assert.Equal(2, server.RequestCount);
    }

    private static ToolExecutionRequest CreateRequest()
    {
        using var arguments = JsonDocument.Parse("{\"status\":\"active\"}");
        return new ToolExecutionRequest(
            CaesAiProtocol.CurrentVersion,
            Guid.Parse("08ab127b-2fd4-4f4c-9348-034f66365d49"),
            "call-123",
            "list_todos",
            new string('a', 64),
            arguments.RootElement.Clone(),
            "signed-context-token");
    }

    private static string IssueToken(
        SigningKey key,
        ToolExecutionRequest request,
        byte[] body,
        string issuer = "https://caes-ai.test",
        string audience = "caes-ai-app:todo-app",
        string tokenType = CaesAiCallbackTokenValidator.TokenType,
        DateTime? expiresAt = null)
    {
        var now = DateTime.UtcNow;
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Subject = new System.Security.Claims.ClaimsIdentity([
                new("sub", CaesAiCallbackTokenValidator.TokenSubject),
                new("jti", Guid.NewGuid().ToString()),
                new("sessionId", request.SessionId.ToString()),
                new("toolCallId", request.ToolCallId),
                new("toolName", request.ToolName),
                new("toolManifestHash", request.ToolManifestHash),
                new("requestHash", WebEncoders.Base64UrlEncode(SHA256.HashData(body)))
            ]),
            IssuedAt = now.AddSeconds(-1),
            NotBefore = now.AddSeconds(-1),
            Expires = expiresAt ?? now.AddMinutes(1),
            SigningCredentials = new SigningCredentials(key.PrivateKey, SecurityAlgorithms.EcdsaSha256),
            TokenType = tokenType
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    private sealed class SigningKey : IDisposable
    {
        private readonly ECDsa _ecdsa;

        private SigningKey(string kid, ECDsa ecdsa)
        {
            _ecdsa = ecdsa;
            PrivateKey = new ECDsaSecurityKey(ecdsa) { KeyId = kid };
            var parameters = ecdsa.ExportParameters(false);
            PublicJwk = new
            {
                kty = "EC",
                crv = "P-256",
                x = WebEncoders.Base64UrlEncode(parameters.Q.X!),
                y = WebEncoders.Base64UrlEncode(parameters.Q.Y!),
                use = "sig",
                alg = SecurityAlgorithms.EcdsaSha256,
                kid
            };
        }

        public ECDsaSecurityKey PrivateKey { get; }
        public object PublicJwk { get; }

        public static SigningKey Create(string kid) =>
            new(kid, ECDsa.Create(ECCurve.NamedCurves.nistP256));

        public void Dispose() => _ecdsa.Dispose();
    }

    private sealed class JwksHandler(params object[] keys) : HttpMessageHandler
    {
        private object[] _keys = keys;

        public int RequestCount { get; private set; }
        public bool FailRequests { get; set; }
        public TaskCompletionSource? Gate { get; set; }

        public void SetKeys(params object[] updatedKeys) => _keys = updatedKeys;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            if (Gate is not null) await Gate.Task.WaitAsync(cancellationToken);
            if (FailRequests)
            {
                throw new HttpRequestException("JWKS unavailable");
            }

            Assert.Equal("/.well-known/jwks.json", request.RequestUri!.AbsolutePath);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(new { keys = _keys }),
                    Encoding.UTF8,
                    "application/json")
            };
        }
    }

    private sealed class TestHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name)
        {
            Assert.Equal(CaesAiCallbackTokenValidator.HttpClientName, name);
            return new HttpClient(handler, disposeHandler: false)
            {
                BaseAddress = new Uri("https://caes-ai.test")
            };
        }
    }

    private sealed class AdjustableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;

        public void Advance(TimeSpan duration) => now += duration;
    }
}
