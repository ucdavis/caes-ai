using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace UCDavis.CaesAi.AppSdk.Tests;

public sealed class CaesAiSessionServiceTests
{
    [Fact]
    public async Task CreatesSignedCentralRequestAndReturnsBrowserSafeSession()
    {
        var tool = new ApplicationToolManifest(
            "get_projects",
            "Gets projects.",
            CaesAiToolExecution.Server,
            CaesAiToolRisk.Read,
            false,
            CaesAiJsonSchema.Object(new JsonObject()),
            CaesAiJsonSchema.Object(new JsonObject()));
        var acceptedTool = tool with { Description = "Gets validated projects." };
        var centralResponse = new CreateCaesAiSessionResponse(
            CaesAiProtocol.CurrentVersion,
            Guid.NewGuid(),
            "browser-token",
            new DateTimeOffset(2026, 9, 1, 12, 30, 0, TimeSpan.Zero),
            "https://caes-ai.test/v1/sessions/id/chat",
            new EffectiveModelPolicy("test-model", "low", "medium", ["low", "medium"]),
            new string('a', 64),
            [acceptedTool]);
        var client = new RecordingCaesAiClient(centralResponse);
        var service = new CaesAiSessionService(
            client,
            new StubContextTokenService("signed-context"),
            Options.Create(new CaesAiAppOptions
            {
                Model = "requested-model",
                DefaultReasoningEffort = "low",
                MaximumReasoningEffort = "medium",
                AllowPerTurnReasoningOverride = true
            }));

        var result = await service.CreateSessionAsync(
            new CaesAiSessionDefinition("user-123", "Use project tools.", [tool]),
            CancellationToken.None);

        var request = Assert.IsType<CreateCaesAiSessionRequest>(client.LastRequest);
        Assert.Equal(CaesAiProtocol.CurrentVersion, request.ProtocolVersion);
        Assert.Equal("user-123", request.UserReference);
        Assert.Equal("signed-context", request.ContextToken);
        Assert.Equal("Use project tools.", request.Instructions);
        Assert.Equal("requested-model", request.ModelPolicy.RequestedModel);
        Assert.Equal("low", request.ModelPolicy.DefaultReasoningEffort);
        Assert.Equal("medium", request.ModelPolicy.MaximumReasoningEffort);
        Assert.True(request.ModelPolicy.AllowPerTurnOverride);
        Assert.Same(tool, Assert.Single(request.Tools));
        Assert.Equal(centralResponse.SessionId, result.SessionId);
        Assert.Equal("browser-token", result.AccessToken);
        Assert.Same(acceptedTool, Assert.Single(result.Tools));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OmitsMcpServersWhenNullOrEmpty(bool empty)
    {
        var client = await CreateSessionAsync(empty ? [] : null);

        using var document = JsonDocument.Parse(
            JsonSerializer.Serialize(client.LastRequest, new JsonSerializerOptions(JsonSerializerDefaults.Web)));

        Assert.False(document.RootElement.TryGetProperty("mcpServers", out _));
    }

    [Fact]
    public async Task SendsRequestedMcpServers()
    {
        var client = await CreateSessionAsync(["github"]);

        using var document = JsonDocument.Parse(
            JsonSerializer.Serialize(client.LastRequest, new JsonSerializerOptions(JsonSerializerDefaults.Web)));

        var server = Assert.Single(document.RootElement.GetProperty("mcpServers").EnumerateArray());
        Assert.Equal("github", server.GetString());
    }

    private static async Task<RecordingCaesAiClient> CreateSessionAsync(IReadOnlyList<string>? mcpServers)
    {
        var client = new RecordingCaesAiClient(new CreateCaesAiSessionResponse(
            CaesAiProtocol.CurrentVersion,
            Guid.NewGuid(),
            "browser-token",
            new DateTimeOffset(2026, 9, 1, 12, 30, 0, TimeSpan.Zero),
            "https://caes-ai.test/v1/sessions/id/chat",
            new EffectiveModelPolicy("test-model", "low", "medium", ["low", "medium"]),
            new string('a', 64),
            []));
        var service = new CaesAiSessionService(
            client,
            new StubContextTokenService("signed-context"),
            Options.Create(new CaesAiAppOptions()));

        await service.CreateSessionAsync(
            new CaesAiSessionDefinition("user-123", "Use project tools.", [], McpServers: mcpServers),
            CancellationToken.None);
        return client;
    }

    private sealed class RecordingCaesAiClient(
        CreateCaesAiSessionResponse response) : ICaesAiClient
    {
        public CreateCaesAiSessionRequest? LastRequest { get; private set; }

        public Task<CreateCaesAiSessionResponse> CreateSessionAsync(
            CreateCaesAiSessionRequest request,
            CancellationToken cancellationToken)
        {
            LastRequest = request;
            return Task.FromResult(response);
        }
    }

    private sealed class StubContextTokenService(
        string token) : ICaesAiContextTokenService
    {
        public string Create(string userReference) => token;

        public bool TryValidate(string tokenValue, out string userReference)
        {
            userReference = string.Empty;
            return false;
        }
    }
}
