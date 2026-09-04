using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace UCDavis.CaesAi.AppSdk;

public static class CaesAiServiceCollectionExtensions
{
    public static IServiceCollection AddCaesAiAppSdk(
        this IServiceCollection services,
        IConfigurationSection configuration)
    {
        services.AddOptions<CaesAiAppOptions>()
            .Bind(configuration)
            .Validate(
                options => Uri.TryCreate(options.ServerUrl, UriKind.Absolute, out _),
                $"{configuration.Path}:ServerUrl must be an absolute URL.")
            .Validate(
                options => options.ApplicationApiKey.Length >= 16,
                $"{configuration.Path}:ApplicationApiKey must contain at least 16 characters.")
            .Validate(
                options => System.Text.RegularExpressions.Regex.IsMatch(
                    options.ApplicationId,
                    "^[a-z][a-z0-9-]{0,63}$"),
                $"{configuration.Path}:ApplicationId must be a lowercase application identifier.")
            .Validate(
                options => options.CallbackIssuer is null ||
                    Uri.TryCreate(options.CallbackIssuer, UriKind.Absolute, out _),
                $"{configuration.Path}:CallbackIssuer must be an absolute URL when provided.")
            .Validate(
                options => options.CallbackTokenClockSkew >= TimeSpan.Zero &&
                    options.CallbackTokenClockSkew <= TimeSpan.FromMinutes(5),
                $"{configuration.Path}:CallbackTokenClockSkew must be between zero and five minutes.")
            .Validate(
                options => options.JwksRefreshInterval > TimeSpan.Zero,
                $"{configuration.Path}:JwksRefreshInterval must be positive.")
            .Validate(
                options => options.JwksRetryInterval > TimeSpan.Zero && options.JwksRequestTimeout > TimeSpan.Zero &&
                    options.JwksMaximumKeyAge >= options.JwksRefreshInterval,
                $"{configuration.Path}:JWKS retry and timeout must be positive; maximum key age must cover the refresh interval.")
            .Validate(
                options => options.ContextSigningKey.Length >= 32,
                $"{configuration.Path}:ContextSigningKey must contain at least 32 characters.")
            .Validate(
                options => options.ContextTokenLifetime > TimeSpan.Zero,
                $"{configuration.Path}:ContextTokenLifetime must be positive.")
            .Validate(
                options => options.RequestTimeout > TimeSpan.Zero,
                $"{configuration.Path}:RequestTimeout must be positive.")
            .ValidateOnStart();

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<ICaesAiContextTokenService, CaesAiContextTokenService>();
        services.TryAddSingleton<ICaesAiCallbackTokenValidator, CaesAiCallbackTokenValidator>();
        services.TryAddScoped<ICaesAiSessionService, CaesAiSessionService>();
        services.AddHttpClient(CaesAiCallbackTokenValidator.HttpClientName, (serviceProvider, client) =>
        {
            var options = serviceProvider.GetRequiredService<IOptions<CaesAiAppOptions>>().Value;
            client.BaseAddress = new Uri(options.ServerUrl);
            client.Timeout = options.RequestTimeout;
        });
        services.AddHttpClient<ICaesAiClient, CaesAiClient>((serviceProvider, client) =>
        {
            var options = serviceProvider.GetRequiredService<IOptions<CaesAiAppOptions>>().Value;
            client.BaseAddress = new Uri(options.ServerUrl);
            client.Timeout = options.RequestTimeout;
        });

        return services;
    }
}
