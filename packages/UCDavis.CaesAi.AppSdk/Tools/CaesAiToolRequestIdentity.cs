using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace UCDavis.CaesAi.AppSdk;

public sealed record CaesAiToolRequestIdentity(string StorageKey, string RequestHash);

public static class CaesAiToolRequestIdentityFactory
{
    /// <summary>
    /// Creates stable identifiers an application can persist to make mutation callbacks idempotent.
    /// </summary>
    public static CaesAiToolRequestIdentity Create(
        ToolExecutionRequest request,
        string userReference)
    {
        var storageInput = string.Join(
            '\n',
            request.ProtocolVersion,
            request.SessionId.ToString("D"),
            request.ToolCallId);
        var requestBytes = JsonSerializer.SerializeToUtf8Bytes(
            new
            {
                request.ProtocolVersion,
                sessionId = request.SessionId.ToString("D"),
                request.ToolCallId,
                request.ToolName,
                userReference,
                request.Arguments
            },
            JsonSerializerOptions.Web);

        return new CaesAiToolRequestIdentity(
            HexHash(Encoding.UTF8.GetBytes(storageInput)),
            HexHash(requestBytes));
    }

    private static string HexHash(ReadOnlySpan<byte> value) =>
        Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
}
