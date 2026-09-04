using System.Buffers;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace UCDavis.CaesAi.AppSdk;

public static class CaesAiEndpointRouteBuilderExtensions
{
    public static RouteHandlerBuilder MapCaesAiToolCallback(
        this IEndpointRouteBuilder endpoints,
        string pattern = "/api/ai/tools/execute") =>
        endpoints.MapPost(pattern, ExecuteToolAsync);

    private static async Task<IResult> ExecuteToolAsync(
        HttpRequest httpRequest,
        ICaesAiToolDispatcher dispatcher,
        ICaesAiContextTokenService contextTokens,
        ICaesAiCallbackTokenValidator callbackTokens,
        CancellationToken cancellationToken)
    {
        var body = await ReadBodyAsync(httpRequest, cancellationToken);
        if (body is null)
        {
            return Results.Json(
                ToolExecutionResponse.Failure(
                    "invalid_tool_arguments",
                    "The callback request is invalid."),
                statusCode: StatusCodes.Status400BadRequest);
        }

        ToolExecutionRequest? request;
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind == JsonValueKind.Object &&
                document.RootElement.TryGetProperty("protocolVersion", out var version) &&
                version.ValueKind == JsonValueKind.Number && version.TryGetInt32(out var number) &&
                number != CaesAiProtocol.CurrentVersion)
            {
                return Results.Json(
                    ToolExecutionResponse.Failure(
                        "unsupported_protocol_version",
                        $"The application supports protocol version {CaesAiProtocol.CurrentVersion}."),
                    statusCode: StatusCodes.Status400BadRequest);
            }
            request = CaesAiProtocolJson.Deserialize<ToolExecutionRequest>(body);
        }
        catch (JsonException)
        {
            request = null;
        }
        if (request is null)
        {
            return Results.Json(
                ToolExecutionResponse.Failure(
                    "invalid_tool_arguments",
                    "The callback request is invalid."),
                statusCode: StatusCodes.Status400BadRequest);
        }

        var authorization = httpRequest.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ||
            !await callbackTokens.ValidateAsync(
                authorization["Bearer ".Length..],
                body,
                request,
                cancellationToken))
        {
            return Unauthorized(
                "invalid_callback_token",
                "Tool callback authentication failed.");
        }

        if (!contextTokens.TryValidate(request.ContextToken, out var userReference))
        {
            return Unauthorized(
                "invalid_session_token",
                "The application context is invalid or expired.");
        }

        return Results.Ok(await dispatcher.ExecuteAsync(
            request,
            userReference,
            cancellationToken));
    }

    private static async Task<byte[]?> ReadBodyAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        const int maximumBytes = 256 * 1024;
        if (request.ContentLength > maximumBytes)
        {
            return null;
        }

        await using var body = new MemoryStream();
        var buffer = ArrayPool<byte>.Shared.Rent(16 * 1024);
        try
        {
            while (true)
            {
                var read = await request.Body.ReadAsync(buffer, cancellationToken);
                if (read == 0)
                {
                    return body.ToArray();
                }
                if (body.Length + read > maximumBytes)
                {
                    return null;
                }
                await body.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static IResult Unauthorized(string code, string message) =>
        Results.Json(
            ToolExecutionResponse.Failure(code, message),
            statusCode: StatusCodes.Status401Unauthorized);
}
