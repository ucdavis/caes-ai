using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace UCDavis.CaesAi.AppSdk;

public static class CaesAiProtocol
{
    public const int CurrentVersion = 1;
}

public static class CaesAiToolExecution
{
    public const string Server = "server";
    public const string Client = "client";
}

public static class CaesAiToolRisk
{
    public const string Read = "read";
    public const string Write = "write";
    public const string Ui = "ui";
}

public static class CaesAiDisplayVisibility
{
    public const string Inline = "inline";
    public const string Details = "details";
    public const string Hidden = "hidden";
}

public sealed record ApplicationToolManifest(
    string Name,
    string Description,
    string Execution,
    string Risk,
    bool NeedsApproval,
    JsonObject InputSchema,
    JsonObject DataSchema,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ToolPresentation? Presentation = null);

public sealed record ToolPresentation(
    string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Label = null);

public sealed record ModelPolicyRequest(
    string? RequestedModel,
    string DefaultReasoningEffort,
    string MaximumReasoningEffort,
    bool AllowPerTurnOverride);

public sealed record CreateCaesAiSessionRequest(
    int ProtocolVersion,
    string UserReference,
    string ContextToken,
    string Instructions,
    ModelPolicyRequest ModelPolicy,
    IReadOnlyList<ApplicationToolManifest> Tools);

public sealed record EffectiveModelPolicy(
    string Model,
    string DefaultReasoningEffort,
    string MaximumReasoningEffort,
    IReadOnlyList<string> AllowedReasoningEfforts);

public sealed record CreateCaesAiSessionResponse(
    int ProtocolVersion,
    Guid SessionId,
    string AccessToken,
    DateTimeOffset ExpiresAt,
    string ChatUrl,
    EffectiveModelPolicy ModelPolicy,
    string ToolManifestHash,
    IReadOnlyList<ApplicationToolManifest> Tools);

public sealed record BrowserAssistantSessionResponse(
    int ProtocolVersion,
    Guid SessionId,
    string AccessToken,
    DateTimeOffset ExpiresAt,
    string ChatUrl,
    EffectiveModelPolicy ModelPolicy,
    string ToolManifestHash,
    IReadOnlyList<ApplicationToolManifest> Tools);

public sealed record CaesAiSessionDefinition(
    string UserReference,
    string Instructions,
    IReadOnlyList<ApplicationToolManifest> Tools,
    ModelPolicyRequest? ModelPolicy = null);

public sealed record ToolExecutionRequest(
    int ProtocolVersion,
    Guid SessionId,
    string ToolCallId,
    string ToolName,
    string ToolManifestHash,
    JsonElement Arguments,
    string ContextToken);

public sealed record ToolDisplay(
    string Kind,
    object Props,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Visibility = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    bool SuppressAssistantText = false);

public sealed record UiEffect(
    string Type,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<object>? Key = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Level = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Message = null)
{
    public static UiEffect Invalidate(params object[] key) =>
        new("invalidate-query", Key: key);

    public static UiEffect Toast(string level, string message) =>
        new("toast", Level: level, Message: message);
}

public sealed record ToolOutputEnvelope(
    object Data,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ToolDisplay? Display,
    IReadOnlyList<UiEffect> UiEffects);

public sealed record ToolError(string Code, string Message, bool Retryable);

public sealed record CaesAiErrorResponse(int ProtocolVersion, ToolError Error);

public sealed record ToolExecutionResponse(
    int ProtocolVersion,
    bool Ok,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ToolOutputEnvelope? Output = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ToolError? Error = null)
{
    public static ToolExecutionResponse Success(
        object data,
        ToolDisplay? display = null,
        params UiEffect[] effects) =>
        new(CaesAiProtocol.CurrentVersion, true, new ToolOutputEnvelope(data, display, effects));

    public static ToolExecutionResponse Failure(
        string code,
        string message,
        bool retryable = false) =>
        new(
            CaesAiProtocol.CurrentVersion,
            false,
            Error: new ToolError(code, message, retryable));
}
