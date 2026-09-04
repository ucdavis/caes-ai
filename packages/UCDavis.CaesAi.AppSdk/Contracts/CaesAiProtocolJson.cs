using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Json.Schema;

namespace UCDavis.CaesAi.AppSdk;

/// <summary>Validates wire documents against the packaged version 1 contract before deserialization.</summary>
public static class CaesAiProtocolJson
{
    private static readonly IReadOnlyDictionary<string, JsonSchema> Schemas = LoadSchemas();
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        NumberHandling = JsonNumberHandling.Strict,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    /// <summary>Checks a named definition in the packaged protocol, without resolving external schemas.</summary>
    public static bool IsValid(string definition, JsonElement value) =>
        Schemas.TryGetValue(definition, out var schema) &&
        schema.Evaluate(value, new EvaluationOptions { RequireFormatValidation = true }).IsValid;

    /// <summary>Rejects missing, unknown, or invalid fields before constructing a supported wire DTO.</summary>
    public static T Deserialize<T>(ReadOnlySpan<byte> utf8Json)
    {
        var definition = typeof(T) == typeof(CreateCaesAiSessionRequest) ? "sessionCreationRequest"
            : typeof(T) == typeof(CreateCaesAiSessionResponse) || typeof(T) == typeof(BrowserAssistantSessionResponse) ? "sessionCreationResponse"
            : typeof(T) == typeof(ToolExecutionRequest) ? "toolExecutionRequest"
            : typeof(T) == typeof(ToolExecutionResponse) ? "toolExecutionResponse"
            : typeof(T) == typeof(CaesAiErrorResponse) ? "caesAiErrorResponse"
            : throw new ArgumentException("Unsupported CAES AI wire contract.");
        using var document = JsonDocument.Parse(utf8Json.ToArray());
        if (!IsValid(definition, document.RootElement))
        {
            // Do not copy validation values into an exception that a host may log.
            throw new JsonException("The CAES AI document does not match protocol version 1.");
        }
        var normalized = JsonNode.Parse(utf8Json)!;
        if (definition == "toolExecutionResponse" && normalized["output"] is JsonObject output)
        {
            output["uiEffects"] ??= new JsonArray();
            if (output["display"] is JsonObject display) display["visibility"] ??= "details";
        }
        return normalized.Deserialize<T>(Options)
            ?? throw new JsonException("CAES AI returned an empty document.");
    }

    private static IReadOnlyDictionary<string, JsonSchema> LoadSchemas()
    {
        using var stream = typeof(CaesAiProtocolJson).Assembly.GetManifestResourceStream("CaesAi.Protocol.V1")
            ?? throw new InvalidOperationException("The CAES AI protocol resource is missing.");
        var root = JsonNode.Parse(stream)!.AsObject();
        var definitions = root["$defs"]!.AsObject();
        return definitions.ToDictionary(entry => entry.Key, entry =>
        {
            var selected = root.DeepClone().AsObject();
            selected["$ref"] = $"#/$defs/{entry.Key}";
            // Each compiled document has a private root, so no mutable global registry is needed.
            selected.Remove("$id");
            using var document = JsonDocument.Parse(selected.ToJsonString());
            return JsonSchema.Build(document.RootElement.Clone());
        }, StringComparer.Ordinal);
    }
}
