using Microsoft.Extensions.Options;

namespace UCDavis.CaesAi.AppSdk;

public interface ICaesAiSessionService
{
    Task<BrowserAssistantSessionResponse> CreateSessionAsync(
        CaesAiSessionDefinition definition,
        CancellationToken cancellationToken);
}

public sealed class CaesAiSessionService(
    ICaesAiClient client,
    ICaesAiContextTokenService contextTokens,
    IOptions<CaesAiAppOptions> options) : ICaesAiSessionService
{
    public async Task<BrowserAssistantSessionResponse> CreateSessionAsync(
        CaesAiSessionDefinition definition,
        CancellationToken cancellationToken)
    {
        var configured = options.Value;
        var policy = definition.ModelPolicy ?? new ModelPolicyRequest(
            string.IsNullOrWhiteSpace(configured.Model) ? null : configured.Model,
            configured.DefaultReasoningEffort,
            configured.MaximumReasoningEffort,
            configured.AllowPerTurnReasoningOverride);
        var request = new CreateCaesAiSessionRequest(
            CaesAiProtocol.CurrentVersion,
            definition.UserReference,
            contextTokens.Create(definition.UserReference),
            definition.Instructions,
            policy,
            definition.Tools);
        var session = await client.CreateSessionAsync(request, cancellationToken);

        return new BrowserAssistantSessionResponse(
            session.ProtocolVersion,
            session.SessionId,
            session.AccessToken,
            session.ExpiresAt,
            session.ChatUrl,
            session.ModelPolicy,
            session.ToolManifestHash,
            session.Tools);
    }
}
