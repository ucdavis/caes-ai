using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace UCDavis.CaesAi.AppSdk;

public interface ICaesAiContextTokenService
{
    string Create(string userReference);
    bool TryValidate(string token, out string userReference);
}

public sealed class CaesAiContextTokenService(
    IOptions<CaesAiAppOptions> options,
    TimeProvider timeProvider) : ICaesAiContextTokenService
{
    private readonly byte[] _key = Encoding.UTF8.GetBytes(options.Value.ContextSigningKey);
    private readonly TimeSpan _lifetime = options.Value.ContextTokenLifetime;

    public string Create(string userReference)
    {
        var now = timeProvider.GetUtcNow();
        var payload = new ContextTokenPayload(
            userReference,
            now.ToUnixTimeSeconds(),
            now.Add(_lifetime).ToUnixTimeSeconds(),
            Guid.NewGuid().ToString("N"));
        var encodedPayload = WebEncoders.Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(payload));
        return $"{encodedPayload}.{Sign(encodedPayload)}";
    }

    public bool TryValidate(string token, out string userReference)
    {
        userReference = string.Empty;
        var parts = token.Split('.', 2);
        if (parts.Length != 2)
        {
            return false;
        }

        byte[] suppliedSignature;
        byte[] expectedSignature;
        try
        {
            suppliedSignature = WebEncoders.Base64UrlDecode(parts[1]);
            expectedSignature = WebEncoders.Base64UrlDecode(Sign(parts[0]));
        }
        catch (FormatException)
        {
            return false;
        }

        if (suppliedSignature.Length != expectedSignature.Length ||
            !CryptographicOperations.FixedTimeEquals(suppliedSignature, expectedSignature))
        {
            return false;
        }

        try
        {
            var payload = JsonSerializer.Deserialize<ContextTokenPayload>(
                WebEncoders.Base64UrlDecode(parts[0]));
            if (payload is null ||
                string.IsNullOrWhiteSpace(payload.UserReference) ||
                payload.ExpiresAt <= timeProvider.GetUtcNow().ToUnixTimeSeconds())
            {
                return false;
            }

            userReference = payload.UserReference;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private string Sign(string payload)
    {
        var signature = HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes(payload));
        return WebEncoders.Base64UrlEncode(signature);
    }

    private sealed record ContextTokenPayload(
        string UserReference,
        long IssuedAt,
        long ExpiresAt,
        string Nonce);
}
