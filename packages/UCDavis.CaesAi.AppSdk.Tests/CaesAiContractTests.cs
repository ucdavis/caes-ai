using System.Text.Json;
using System.Text.Json.Nodes;

namespace UCDavis.CaesAi.AppSdk.Tests;

public sealed class CaesAiContractTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public void SharedVersionOneFixturesMatchTheDotNetContracts()
    {
        AssertFixture<CreateCaesAiSessionRequest>("session-creation-request.json");
        AssertFixture<CreateCaesAiSessionResponse>("session-creation-response.json");
        AssertFixture<ToolExecutionRequest>("tool-execution-request.json");
        AssertFixture<ToolExecutionResponse>("tool-execution-response.json");
        AssertFixture<ToolExecutionResponse>("tool-execution-error-response.json");
        AssertFixture<CaesAiErrorResponse>("error-response.json");
    }

    [Fact]
    public void SuccessFactorySerializesOnlyTheSelectedUiEffectShape()
    {
        var response = ToolExecutionResponse.Success(
            new { total = 2 },
            new ToolDisplay("metric", new { title = "Projects" }),
            UiEffect.Invalidate("projects"));

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(response, JsonOptions));
        var root = document.RootElement;
        var display = root.GetProperty("output").GetProperty("display");
        var effect = Assert.Single(root.GetProperty("output").GetProperty("uiEffects").EnumerateArray());

        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal(CaesAiProtocol.CurrentVersion, root.GetProperty("protocolVersion").GetInt32());
        Assert.False(root.TryGetProperty("error", out _));
        Assert.False(display.TryGetProperty("visibility", out _));
        Assert.False(display.TryGetProperty("suppressAssistantText", out _));
        Assert.Equal("invalidate-query", effect.GetProperty("type").GetString());
        Assert.True(effect.TryGetProperty("key", out _));
        Assert.False(effect.TryGetProperty("level", out _));
        Assert.False(effect.TryGetProperty("message", out _));
    }

    [Fact]
    public void FailureFactoryOmitsTheSuccessOutput()
    {
        var response = ToolExecutionResponse.Failure(
            "tool_not_found",
            "The requested tool is not available.");

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(response, JsonOptions));

        Assert.False(document.RootElement.GetProperty("ok").GetBoolean());
        Assert.False(document.RootElement.TryGetProperty("output", out _));
        Assert.Equal(
            "tool_not_found",
            document.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public void SuccessWithoutPresentationOmitsDisplay()
    {
        var response = ToolExecutionResponse.Success(new { found = true });

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(response, JsonOptions));
        var output = document.RootElement.GetProperty("output");

        Assert.False(output.TryGetProperty("display", out _));
        Assert.Empty(output.GetProperty("uiEffects").EnumerateArray());
    }

    [Fact]
    public void ApplicationDataSchemaContainsOnlyApplicationData()
    {
        var schema = CaesAiJsonSchema.Object(
            new JsonObject { ["total"] = CaesAiJsonSchema.Integer() },
            "total");

        var required = schema["required"]!.AsArray();

        Assert.Equal("total", Assert.Single(required)!.GetValue<string>());
        Assert.Null(schema["properties"]!["display"]);
        Assert.Null(schema["properties"]!["uiEffects"]);
    }

    private static void AssertFixture<T>(string name)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "protocol-fixtures", name);
        var value = CaesAiProtocolJson.Deserialize<T>(File.ReadAllBytes(path));
        Assert.NotNull(value);
        var version = value switch
        {
            CreateCaesAiSessionRequest request => request.ProtocolVersion,
            CreateCaesAiSessionResponse response => response.ProtocolVersion,
            ToolExecutionRequest request => request.ProtocolVersion,
            ToolExecutionResponse response => response.ProtocolVersion,
            CaesAiErrorResponse response => response.ProtocolVersion,
            _ => 0
        };
        Assert.Equal(CaesAiProtocol.CurrentVersion, version);
    }

    [Fact]
    public void SharedPositiveAndNegativeFixturesUseTheSameReceiverRules()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "protocol-fixtures", "conformance.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        foreach (var item in document.RootElement.EnumerateArray())
        {
            Assert.Equal(item.GetProperty("valid").GetBoolean(), CaesAiProtocolJson.IsValid(
                item.GetProperty("definition").GetString()!, item.GetProperty("value")));
        }
    }

    [Theory]
    [InlineData("{\"protocolVersion\":1,\"unknown\":true}")]
    [InlineData("{\"protocolVersion\":1}")]
    public void CallbackReceiverRejectsIncompleteDocuments(string json) =>
        Assert.Throws<JsonException>(() => CaesAiProtocolJson.Deserialize<ToolExecutionRequest>(System.Text.Encoding.UTF8.GetBytes(json)));

    [Fact]
    public void ReceiverAppliesTheProtocolPresentationDefaults()
    {
        var response = CaesAiProtocolJson.Deserialize<ToolExecutionResponse>(
            """{"protocolVersion":1,"ok":true,"output":{"data":{},"display":{"kind":"card","props":{}}}}"""u8);
        Assert.Empty(response.Output!.UiEffects);
        Assert.Equal("details", response.Output.Display!.Visibility);
    }
}
