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
