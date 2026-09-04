namespace UCDavis.CaesAi.AppSdk;

/// <summary>
/// Configures one application's trusted connection to CAES AI.
/// </summary>
public sealed class CaesAiAppOptions
{
    public const string SectionName = "CaesAi";

    public string ServerUrl { get; set; } = "http://localhost:4310";
    public string ApplicationId { get; set; } = string.Empty;
    public string ApplicationApiKey { get; set; } = string.Empty;
    public string? CallbackIssuer { get; set; }
    public TimeSpan CallbackTokenClockSkew { get; set; } = TimeSpan.FromSeconds(15);
    public TimeSpan JwksRefreshInterval { get; set; } = TimeSpan.FromMinutes(15);
    /// <summary>Minimum spacing between failed or unknown-key refresh attempts.</summary>
    public TimeSpan JwksRetryInterval { get; set; } = TimeSpan.FromSeconds(30);
    /// <summary>Maximum trust age since a successful JWKS fetch, including an outage.</summary>
    public TimeSpan JwksMaximumKeyAge { get; set; } = TimeSpan.FromHours(1);
    /// <summary>Bounds a shared JWKS refresh independently of callback cancellation.</summary>
    public TimeSpan JwksRequestTimeout { get; set; } = TimeSpan.FromSeconds(2);
    public string ContextSigningKey { get; set; } = string.Empty;
    public TimeSpan ContextTokenLifetime { get; set; } = TimeSpan.FromMinutes(30);
    public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(15);
    public string? Model { get; set; }
    public string DefaultReasoningEffort { get; set; } = "none";
    public string MaximumReasoningEffort { get; set; } = "none";
    public bool AllowPerTurnReasoningOverride { get; set; } = true;
}
