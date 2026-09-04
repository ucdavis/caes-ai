using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace UCDavis.CaesAi.AppSdk;

public interface ICaesAiClient
{
    Task<CreateCaesAiSessionResponse> CreateSessionAsync(
        CreateCaesAiSessionRequest request,
        CancellationToken cancellationToken);
}

public sealed class CaesAiApiException(
    System.Net.HttpStatusCode statusCode,
    CaesAiErrorResponse? response)
    : HttpRequestException(
        response?.Error.Message ?? $"CAES AI returned HTTP {(int)statusCode}.",
        null,
        statusCode)
{
    public CaesAiErrorResponse? Response { get; } = response;
}

public sealed class CaesAiClient(
    HttpClient httpClient,
    IOptions<CaesAiAppOptions> options) : ICaesAiClient
{
    public async Task<CreateCaesAiSessionResponse> CreateSessionAsync(
        CreateCaesAiSessionRequest request,
        CancellationToken cancellationToken)
    {
        using var message = new HttpRequestMessage(HttpMethod.Post, "/v1/sessions")
        {
            Content = JsonContent.Create(request)
        };
        message.Headers.Authorization = new AuthenticationHeaderValue(
            "ApiKey",
            options.Value.ApplicationApiKey);

        using var response = await httpClient.SendAsync(message, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            CaesAiErrorResponse? error = null;
            try
            {
                error = CaesAiProtocolJson.Deserialize<CaesAiErrorResponse>(
                    await response.Content.ReadAsByteArrayAsync(cancellationToken));
            }
            catch (System.Text.Json.JsonException)
            {
                // Preserve the HTTP failure even when an intermediary returned a non-protocol body.
            }

            throw new CaesAiApiException(response.StatusCode, error);
        }
        var session = CaesAiProtocolJson.Deserialize<CreateCaesAiSessionResponse>(
            await response.Content.ReadAsByteArrayAsync(cancellationToken));
        if (session.ProtocolVersion != CaesAiProtocol.CurrentVersion)
        {
            throw new HttpRequestException(
                $"CAES AI returned unsupported protocol version {session.ProtocolVersion}.");
        }

        return session;
    }
}
