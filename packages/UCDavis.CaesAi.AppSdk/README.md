# UCDavis.CaesAi.AppSdk

Application-side .NET integration for CAES AI. The package contains the stable HTTP contracts, central session client, signed user-context tokens, session assembly, JSON Schema helpers, and the authenticated ASP.NET Core tool callback endpoint.

## Install the beta

Requires .NET 10 and ASP.NET Core.

```bash
dotnet add package UCDavis.CaesAi.AppSdk --version 0.2.0-beta.0
```

The package includes the normative version 1 wire schema at
`contentFiles/any/any/caes-ai/v1/protocol.schema.json`. Its DTOs implement that
schema. Non-successful central responses are exposed as `CaesAiApiException`,
including the typed CAES AI error body when one was returned.

Applications still own their user authentication, instructions, tool manifests, tool handlers, business services, data access, mutation idempotency, and frontend renderers.

## Registration

```csharp
builder.Services.AddCaesAiAppSdk(
    builder.Configuration.GetSection(CaesAiAppOptions.SectionName));
builder.Services.AddScoped<ICaesAiToolDispatcher, ProjectToolDispatcher>();
```

The `CaesAi` configuration section requires `ServerUrl`, `ApplicationId`, `ApplicationApiKey`, and a `ContextSigningKey` of at least 32 characters. `CallbackIssuer` defaults to `ServerUrl`; set it explicitly when CAES AI is reached through a different internal URL. Applications do not create or store a callback secret. Local development can provide configuration through user secrets, environment variables, or `appsettings.Development.json`.

## Create a browser session

```csharp
app.MapPost("/api/assistant/session", async (
    ICaesAiSessionService sessions,
    CancellationToken cancellationToken) =>
{
    var definition = new CaesAiSessionDefinition(
        currentUser.Id,
        "Use project tools for current financial data.",
        ProjectToolManifest.Build());

    return Results.Ok(await sessions.CreateSessionAsync(
        definition,
        cancellationToken));
});
```

`ICaesAiSessionService` signs the opaque application context, applies the configured model policy, calls CAES AI with the application API key, validates protocol version 1, and returns only CAES AI's accepted browser-safe session fields and tool descriptors. It does not reattach the application's original manifest.

`Model` may be `default`, `fast`, `deep`, or an exact provider model name. An
empty value means `default`. CAES AI resolves named profiles centrally and still
checks every resolved model against both central and application allowlists.

## Map the callback

```csharp
app.MapCaesAiToolCallback();
```

The SDK accepts only short-lived ES256 callback JWTs with CAES AI's fixed token type. It caches CAES AI's JWKS, refreshes on an unknown key ID, checks issuer and application audience, and binds the token to the session, tool call, manifest, and exact JSON request. It then validates the signed application context, derives the user reference from that context, and calls `ICaesAiToolDispatcher`. Tool arguments never choose the user.

Use `ToolExecutionResponse.Success` and `ToolExecutionResponse.Failure` to return the standard envelope. Tool manifests define `InputSchema` and business-only `DataSchema`; CAES AI owns the surrounding output envelope. `CaesAiJsonSchema` has optional helpers for common object, string, integer, and nullable schemas. Applications may use another JSON Schema builder if they prefer.

For mutations, use `CaesAiToolRequestIdentityFactory.Create(request, verifiedUserReference)` as the input to durable idempotency storage. The identity binds the protocol version, session, tool call, tool name, user, and canonical arguments. The application remains responsible for storing the request hash and completed response atomically enough for its business operation.

JWKS refreshes are shared across concurrent callbacks. A usable cached key remains
available during refresh. Defaults are a 15-minute refresh interval, a 30-second
retry/unknown-key cooldown, a two-second refresh timeout and a one-hour maximum key
age since the last successful fetch. Configure `JwksRetryInterval`,
`JwksRequestTimeout` and `JwksMaximumKeyAge` through `CaesAiAppOptions`; maximum age
must be at least the refresh interval. A successful refresh removes retired keys.
Cancelling one callback does not cancel shared refresh work.

Session responses and callback requests are checked against the embedded version 1
JSON Schema before deserialization. Applications that deserialize protocol documents
directly can use `CaesAiProtocolJson.Deserialize<T>` for the same checks.
