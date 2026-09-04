using System.Text.Json.Nodes;

namespace UCDavis.CaesAi.AppSdk;

/// <summary>
/// Convenience methods for the JSON Schema shapes commonly used by CAES AI tools.
/// Applications may supply any valid schemas without using these methods.
/// </summary>
public static class CaesAiJsonSchema
{
    public static JsonObject Object(JsonObject properties, params string[] required)
    {
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["additionalProperties"] = false
        };
        if (required.Length > 0)
        {
            schema["required"] = new JsonArray(
                required.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray());
        }

        return schema;
    }

    public static JsonObject String(params string[] allowedValues)
    {
        var schema = new JsonObject { ["type"] = "string" };
        if (allowedValues.Length > 0)
        {
            schema["enum"] = new JsonArray(
                allowedValues.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray());
        }

        return schema;
    }

    public static JsonObject Integer(int minimum = 0) =>
        new() { ["type"] = "integer", ["minimum"] = minimum };

    public static JsonArray NullableTypes(string type) =>
        new(JsonValue.Create(type), JsonValue.Create("null"));
}
