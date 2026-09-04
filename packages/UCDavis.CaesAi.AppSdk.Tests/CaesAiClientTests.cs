using System.Net;
using System.Text;
using Microsoft.Extensions.Options;

namespace UCDavis.CaesAi.AppSdk.Tests;

public sealed class CaesAiClientTests
{
    [Fact]
    public async Task PreservesTypedProtocolErrors()
    {
        using var httpClient = new HttpClient(new ErrorHandler())
        {
            BaseAddress = new Uri("https://caes-ai.test")
        };
        var client = new CaesAiClient(httpClient, Options.Create(new CaesAiAppOptions
        {
            ApplicationApiKey = "test-application-key"
        }));
        var request = new CreateCaesAiSessionRequest(
            CaesAiProtocol.CurrentVersion,
            "user",
            "signed-context-token",
            "Use tools.",
            new ModelPolicyRequest(null, "low", "medium", true),
            []);

        var exception = await Assert.ThrowsAsync<CaesAiApiException>(() =>
            client.CreateSessionAsync(request, CancellationToken.None));

        Assert.Equal(HttpStatusCode.Unauthorized, exception.StatusCode);
        Assert.Equal("invalid_application_key", exception.Response?.Error.Code);
        Assert.False(exception.Response?.Error.Retryable);
    }

    private sealed class ErrorHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized)
            {
                Content = new StringContent(
                    """
                    {"protocolVersion":1,"error":{"code":"invalid_application_key","message":"Application authentication failed.","retryable":false}}
                    """,
                    Encoding.UTF8,
                    "application/json")
            });
    }
}
