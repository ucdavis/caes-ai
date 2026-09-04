using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text.Json;
using UCDavis.CaesAi.AppSdk;
using UCDavis.CaesAi.Todo.Api.Data;
using UCDavis.CaesAi.Todo.Api.Ai;
using UCDavis.CaesAi.Todo.Api.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;

namespace UCDavis.CaesAi.Todo.Api.IntegrationTests;

public sealed class TodoApiFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection _connection = new("Data Source=:memory:");

    public TodoApiFactory()
    {
        _connection.Open();
    }

    public RecordingCaesAiClient CaesAiClient { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["CaesAi:ServerUrl"] = "http://caes-ai.test",
                ["CaesAi:ApplicationId"] = "todo-app",
                ["CaesAi:ApplicationApiKey"] = "test-application-key-long-enough",
                ["CaesAi:ContextSigningKey"] = "test-context-signing-key-at-least-32-bytes",
                ["CaesAi:DefaultReasoningEffort"] = "low",
                ["CaesAi:MaximumReasoningEffort"] = "medium"
            }));
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<TodoDbContext>>();
            services.AddDbContext<TodoDbContext>(options =>
                options.UseSqlite(_connection));
            services.RemoveAll<ICaesAiClient>();
            services.AddSingleton<ICaesAiClient>(CaesAiClient);
            services.RemoveAll<ICaesAiCallbackTokenValidator>();
            services.AddSingleton<ICaesAiCallbackTokenValidator, TestCallbackTokenValidator>();
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            _connection.Dispose();
        }
    }
}

public sealed class TestCallbackTokenValidator : ICaesAiCallbackTokenValidator
{
    public Task<bool> ValidateAsync(
        string token,
        ReadOnlyMemory<byte> requestBody,
        ToolExecutionRequest request,
        CancellationToken cancellationToken) =>
        Task.FromResult(token == "test-signed-callback-token");
}

public sealed class RecordingCaesAiClient : ICaesAiClient
{
    public CreateCaesAiSessionRequest? LastRequest { get; private set; }

    public Task<CreateCaesAiSessionResponse> CreateSessionAsync(
        CreateCaesAiSessionRequest request,
        CancellationToken cancellationToken)
    {
        LastRequest = request;
        return Task.FromResult(new CreateCaesAiSessionResponse(
            CaesAiProtocol.CurrentVersion,
            Guid.NewGuid(),
            "browser-session-token-that-is-long-enough",
            DateTimeOffset.UtcNow.AddMinutes(30),
            "http://caes-ai.test/v1/sessions/session/chat",
            new EffectiveModelPolicy("test-model", "low", "medium", ["low", "medium"]),
            new string('a', 64),
            request.Tools));
    }
}

public sealed class TodoApiTests : IClassFixture<TodoApiFactory>
{
    private readonly HttpClient _client;
    private readonly TodoApiFactory _factory;

    public TodoApiTests(TodoApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task UserCanCreateAndRetrieveATodo()
    {
        var createResponse = await _client.PostAsJsonAsync("/api/todos", new
        {
            title = "Submit the Walter report",
            dueDate = "2026-09-04",
            category = "Work"
        });

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        var todos = await _client.GetFromJsonAsync<List<TodoResponse>>("/api/todos?status=all");

        var created = Assert.Single(todos!, todo => todo.Title == "Submit the Walter report");
        Assert.Equal("Submit the Walter report", created.Title);
        Assert.Equal(new DateOnly(2026, 9, 4), created.DueDate);
        Assert.Equal("Work", created.Category);
        Assert.False(created.Completed);
    }

    [Fact]
    public async Task UserCanUpdateAndDeleteATodo()
    {
        var title = $"CRUD Todo {Guid.NewGuid():N}";
        var createResponse = await _client.PostAsJsonAsync("/api/todos", new
        {
            title,
            dueDate = (string?)null,
            category = "CRUD"
        });
        var created = await createResponse.Content.ReadFromJsonAsync<TodoResponse>();

        var updateResponse = await _client.PatchAsJsonAsync($"/api/todos/{created!.Id}", new
        {
            title = $"{title} updated",
            completed = true,
            dueDate = "2026-09-09",
            category = "Updated"
        });
        var updated = await updateResponse.Content.ReadFromJsonAsync<TodoResponse>();

        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        Assert.True(updated!.Completed);
        Assert.Equal($"{title} updated", updated.Title);
        Assert.Equal("Updated", updated.Category);

        var deleteResponse = await _client.DeleteAsync($"/api/todos/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);
        var todos = await _client.GetFromJsonAsync<List<TodoResponse>>("/api/todos?status=all");
        Assert.DoesNotContain(todos!, todo => todo.Id == created.Id);
    }

    [Fact]
    public async Task TodoBackendDynamicallyRegistersItsToolsWhenCreatingASession()
    {
        var response = await _client.PostAsync("/api/assistant/session", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var request = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);
        Assert.Equal("demo-user-1", request.UserReference);
        Assert.Contains(request.Tools, tool => tool.Name == "list_todos" && tool.Risk == "read");
        Assert.Contains(request.Tools, tool => tool.Name == "add_todo" && tool.NeedsApproval);
        Assert.Contains(request.Tools, tool => tool.Name == "set_todo_filter" && tool.Execution == "client");
        Assert.DoesNotContain("callback", request.ContextToken, StringComparison.OrdinalIgnoreCase);
        var responseBody = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("test-application-key-long-enough", responseBody, StringComparison.Ordinal);
        Assert.DoesNotContain("test-context-signing-key", responseBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ApprovedMutationCallbackIsAuthenticatedScopedAndIdempotent()
    {
        await _client.PostAsync("/api/assistant/session", content: null);
        var sessionRequest = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);
        var toolCallId = $"call-{Guid.NewGuid():N}";
        var sessionId = Guid.NewGuid();
        var title = $"Idempotent Todo {Guid.NewGuid():N}";
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/ai/tools/execute")
        {
            Content = JsonContent.Create(new
            {
                protocolVersion = CaesAiProtocol.CurrentVersion,
                sessionId,
                toolCallId,
                toolName = "add_todo",
                toolManifestHash = new string('a', 64),
                arguments = new { title, dueDate = "2026-09-08", category = "Work" },
                contextToken = sessionRequest.ContextToken
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            "test-signed-callback-token");

        var first = await _client.SendAsync(request);
        var duplicateRequest = new HttpRequestMessage(HttpMethod.Post, "/api/ai/tools/execute")
        {
            Content = JsonContent.Create(new
            {
                protocolVersion = CaesAiProtocol.CurrentVersion,
                sessionId,
                toolCallId,
                toolName = "add_todo",
                toolManifestHash = new string('a', 64),
                arguments = new { title, dueDate = "2026-09-08", category = "Work" },
                contextToken = sessionRequest.ContextToken
            })
        };
        duplicateRequest.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            "test-signed-callback-token");
        var duplicate = await _client.SendAsync(duplicateRequest);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, duplicate.StatusCode);
        var todos = await _client.GetFromJsonAsync<List<TodoResponse>>("/api/todos?status=all");
        Assert.Single(todos!, todo => todo.Title == title);

        using var body = JsonDocument.Parse(await duplicate.Content.ReadAsStringAsync());
        Assert.True(body.RootElement.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task NormalQueriesDoNotReturnAnotherUsersTodos()
    {
        var hiddenTitle = $"Hidden Todo {Guid.NewGuid():N}";
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var now = DateTimeOffset.UtcNow;
            dbContext.Todos.Add(new TodoItem
            {
                Id = Guid.NewGuid(),
                UserId = "another-user",
                Title = hiddenTitle,
                Completed = false,
                CreatedAt = now,
                UpdatedAt = now
            });
            await dbContext.SaveChangesAsync();
        }

        var todos = await _client.GetFromJsonAsync<List<TodoResponse>>("/api/todos?status=all");

        Assert.DoesNotContain(todos!, todo => todo.Title == hiddenTitle);
    }

    [Fact]
    public async Task InvalidContextSignatureFailsBeforeToolDispatch()
    {
        await _client.PostAsync("/api/assistant/session", content: null);
        var session = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);
        var invalid = $"{session.ContextToken[..^1]}{(session.ContextToken[^1] == 'a' ? 'b' : 'a')}";

        var response = await SendToolAsync(
            "list_todos",
            new { status = "all" },
            invalid,
            $"call-{Guid.NewGuid():N}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task InvalidCallbackTokenFailsBeforeToolDispatch()
    {
        await _client.PostAsync("/api/assistant/session", content: null);
        var session = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/ai/tools/execute")
        {
            Content = JsonContent.Create(new
            {
                protocolVersion = CaesAiProtocol.CurrentVersion,
                sessionId = Guid.NewGuid(),
                toolCallId = $"call-{Guid.NewGuid():N}",
                toolName = "list_todos",
                toolManifestHash = new string('a', 64),
                arguments = new { status = "all" },
                contextToken = session.ContextToken
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            "incorrect-callback-token");

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(
            "invalid_callback_token",
            body.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task UnsupportedCallbackProtocolVersionFailsExplicitly()
    {
        await _client.PostAsync("/api/assistant/session", content: null);
        var session = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/ai/tools/execute")
        {
            Content = JsonContent.Create(new
            {
                protocolVersion = CaesAiProtocol.CurrentVersion + 1,
                sessionId = Guid.NewGuid(),
                toolCallId = $"call-{Guid.NewGuid():N}",
                toolName = "list_todos",
                toolManifestHash = new string('a', 64),
                arguments = new { status = "all" },
                contextToken = session.ContextToken
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            "test-signed-callback-token");

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(
            "unsupported_protocol_version",
            body.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task UnknownToolReturnsASafeError()
    {
        await _client.PostAsync("/api/assistant/session", content: null);
        var session = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);

        var response = await SendToolAsync(
            "unknown_tool",
            new { },
            session.ContextToken,
            $"call-{Guid.NewGuid():N}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(body.RootElement.GetProperty("ok").GetBoolean());
        Assert.Equal("tool_not_found", body.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task ToolHandlersUseTheUserFromTheSignedContext()
    {
        string contextToken;
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            contextToken = scope.ServiceProvider
                .GetRequiredService<ICaesAiContextTokenService>()
                .Create("another-user");
        }
        var title = $"Other user Todo {Guid.NewGuid():N}";

        var response = await SendToolAsync(
            "add_todo",
            new { title, dueDate = (string?)null, category = "Private" },
            contextToken,
            $"call-{Guid.NewGuid():N}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var visible = await _client.GetFromJsonAsync<List<TodoResponse>>("/api/todos?status=all");
        Assert.DoesNotContain(visible!, todo => todo.Title == title);
        await using var verificationScope = _factory.Services.CreateAsyncScope();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<TodoDbContext>();
        Assert.True(await dbContext.Todos.AnyAsync(todo => todo.UserId == "another-user" && todo.Title == title));
    }

    [Fact]
    public async Task SummaryMatchesTheVisibleTodoPopulation()
    {
        var todos = await _client.GetFromJsonAsync<List<TodoResponse>>("/api/todos?status=all");
        using var summary = JsonDocument.Parse(
            await _client.GetStringAsync("/api/todos/summary"));
        var body = summary.RootElement;

        Assert.Equal(todos!.Count, body.GetProperty("total").GetInt32());
        Assert.Equal(todos.Count(todo => !todo.Completed), body.GetProperty("active").GetInt32());
        Assert.Equal(todos.Count(todo => todo.Completed), body.GetProperty("completed").GetInt32());
        Assert.True(body.GetProperty("overdue").GetInt32() >= 0);
    }

    [Fact]
    public async Task SummaryStatusFiltersTotalsAndCategoryCounts()
    {
        var category = $"Summary-{Guid.NewGuid():N}";
        var dueDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(2);
        await CreateTodoAsync("Active summary Todo", category, dueDate, completed: false);
        await CreateTodoAsync("Completed summary Todo", category, dueDate, completed: true);

        using var summary = JsonDocument.Parse(await _client.GetStringAsync(
            $"/api/todos/summary?status=active&category={Uri.EscapeDataString(category)}"));
        var body = summary.RootElement;

        Assert.Equal(1, body.GetProperty("total").GetInt32());
        Assert.Equal(1, body.GetProperty("active").GetInt32());
        Assert.Equal(0, body.GetProperty("completed").GetInt32());
        var categoryCount = Assert.Single(body.GetProperty("byCategory").EnumerateArray());
        Assert.Equal(category, categoryCount.GetProperty("category").GetString());
        Assert.Equal(1, categoryCount.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task ListToolFiltersDueDatesBeforeBuildingAnInlinePresentation()
    {
        var category = $"Due-list-{Guid.NewGuid():N}";
        var dueTitle = $"Dated Todo {Guid.NewGuid():N}";
        var undatedTitle = $"Undated Todo {Guid.NewGuid():N}";
        await CreateTodoAsync(dueTitle, category, DateOnly.FromDateTime(DateTime.UtcNow).AddDays(3), completed: false);
        await CreateTodoAsync(undatedTitle, category, dueDate: null, completed: false);
        await _client.PostAsync("/api/assistant/session", content: null);
        var session = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);

        var response = await SendToolAsync(
            "list_todos",
            new { status = "all", category, hasDueDate = true, resultView = "list" },
            session.ContextToken,
            $"call-{Guid.NewGuid():N}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var output = document.RootElement.GetProperty("output");
        var item = Assert.Single(output.GetProperty("data").GetProperty("items").EnumerateArray());
        Assert.StartsWith(dueTitle, item.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.String, item.GetProperty("dueDate").ValueKind);
        var display = output.GetProperty("display");
        Assert.Equal("inline", display.GetProperty("visibility").GetString());
        Assert.True(display.GetProperty("suppressAssistantText").GetBoolean());
    }

    [Fact]
    public async Task OverdueCountIncludesOnlyIncompletePastDueTodos()
    {
        var category = $"Due-{Guid.NewGuid():N}";
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        await CreateTodoAsync("Past active", category, today.AddDays(-2), completed: false);
        await CreateTodoAsync("Past completed", category, today.AddDays(-3), completed: true);
        await CreateTodoAsync("Future active", category, today.AddDays(2), completed: false);

        using var summary = JsonDocument.Parse(await _client.GetStringAsync(
            $"/api/todos/summary?category={Uri.EscapeDataString(category)}"));

        Assert.Equal(3, summary.RootElement.GetProperty("total").GetInt32());
        Assert.Equal(1, summary.RootElement.GetProperty("overdue").GetInt32());
    }

    [Fact]
    public async Task CompletionMutationIsIdempotentByToolCallId()
    {
        var created = await _client.PostAsJsonAsync("/api/todos", new
        {
            title = $"Completion Todo {Guid.NewGuid():N}",
            dueDate = (string?)null,
            category = "Work"
        });
        var todo = await created.Content.ReadFromJsonAsync<TodoResponse>();
        await _client.PostAsync("/api/assistant/session", content: null);
        var session = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);
        var toolCallId = $"call-{Guid.NewGuid():N}";
        var sessionId = Guid.NewGuid();

        var first = await SendToolAsync(
            "set_todo_completion",
            new { todoId = todo!.Id, completed = true },
            session.ContextToken,
            toolCallId,
            sessionId);
        var duplicate = await SendToolAsync(
            "set_todo_completion",
            new { todoId = todo.Id, completed = true },
            session.ContextToken,
            toolCallId,
            sessionId);

        Assert.Equal(await first.Content.ReadAsStringAsync(), await duplicate.Content.ReadAsStringAsync());
        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
        var storageKey = CaesAiToolRequestIdentityFactory.Create(
            new ToolExecutionRequest(
                CaesAiProtocol.CurrentVersion,
                sessionId,
                toolCallId,
                "set_todo_completion",
                new string('a', 64),
                JsonSerializer.SerializeToElement(new { todoId = todo.Id, completed = true }),
                session.ContextToken),
            "demo-user-1").StorageKey;
        Assert.Equal(
            1,
            await dbContext.ProcessedToolCalls.CountAsync(
                call => call.ToolCallId == storageKey));
    }

    [Fact]
    public async Task ReusedToolCallWithDifferentArgumentsIsRejected()
    {
        await _client.PostAsync("/api/assistant/session", content: null);
        var session = Assert.IsType<CreateCaesAiSessionRequest>(_factory.CaesAiClient.LastRequest);
        var toolCallId = $"call-{Guid.NewGuid():N}";
        var sessionId = Guid.NewGuid();

        var first = await SendToolAsync(
            "add_todo",
            new { title = "Original replay title", category = "Work" },
            session.ContextToken,
            toolCallId,
            sessionId);
        var changed = await SendToolAsync(
            "add_todo",
            new { title = "Changed replay title", category = "Work" },
            session.ContextToken,
            toolCallId,
            sessionId);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        using var changedBody = JsonDocument.Parse(await changed.Content.ReadAsStringAsync());
        Assert.False(changedBody.RootElement.GetProperty("ok").GetBoolean());
        Assert.Contains(
            "does not match",
            changedBody.RootElement.GetProperty("error").GetProperty("message").GetString());
    }

    private async Task<HttpResponseMessage> SendToolAsync(
        string toolName,
        object arguments,
        string contextToken,
        string toolCallId,
        Guid? sessionId = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/ai/tools/execute")
        {
            Content = JsonContent.Create(new
            {
                protocolVersion = CaesAiProtocol.CurrentVersion,
                sessionId = sessionId ?? Guid.NewGuid(),
                toolCallId,
                toolName,
                toolManifestHash = new string('a', 64),
                arguments,
                contextToken
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            "test-signed-callback-token");
        return await _client.SendAsync(request);
    }

    private async Task CreateTodoAsync(
        string title,
        string category,
        DateOnly? dueDate,
        bool completed)
    {
        var response = await _client.PostAsJsonAsync("/api/todos", new
        {
            title = $"{title} {Guid.NewGuid():N}",
            dueDate = dueDate?.ToString("yyyy-MM-dd"),
            category
        });
        var todo = await response.Content.ReadFromJsonAsync<TodoResponse>();
        if (completed)
        {
            await _client.PatchAsJsonAsync($"/api/todos/{todo!.Id}", new { completed = true });
        }
    }

    private sealed record TodoResponse(
        Guid Id,
        string Title,
        bool Completed,
        DateOnly? DueDate,
        string? Category,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt);
}
