using UCDavis.CaesAi.AppSdk;
using UCDavis.CaesAi.Todo.Api.Contracts;
using UCDavis.CaesAi.Todo.Api.Ai;
using UCDavis.CaesAi.Todo.Api.Data;
using UCDavis.CaesAi.Todo.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<TodoDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Todos") ?? "Data Source=caes-ai-todos.db"));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<ITodoService, TodoService>();
builder.Services.AddScoped<ICaesAiToolDispatcher, TodoToolDispatcher>();
builder.Services.AddCaesAiAppSdk(
    builder.Configuration.GetSection(CaesAiAppOptions.SectionName));
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins("http://localhost:5173", "http://localhost:8080")
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();
app.UseCors();

await using (var scope = app.Services.CreateAsyncScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
    await dbContext.Database.EnsureCreatedAsync();
    if (!app.Environment.IsEnvironment("Testing"))
    {
        await TodoSeed.InitializeAsync(
            dbContext,
            scope.ServiceProvider.GetRequiredService<TimeProvider>());
    }
}

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/todos", async (
    string? status,
    string? category,
    ITodoService service,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await service.ListAsync(
            TodoSeed.DemoUserId,
            status ?? "all",
            category,
            hasDueDate: null,
            cancellationToken));
    }
    catch (TodoValidationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapGet("/api/todos/summary", async (
    string? status,
    string? category,
    ITodoService service,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await service.SummarizeAsync(
            TodoSeed.DemoUserId,
            status ?? "all",
            category,
            cancellationToken));
    }
    catch (TodoValidationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/api/todos", async (
    CreateTodoRequest request,
    ITodoService service,
    CancellationToken cancellationToken) =>
{
    try
    {
        var created = await service.CreateAsync(TodoSeed.DemoUserId, request, cancellationToken);
        return Results.Created($"/api/todos/{created.Id}", created);
    }
    catch (TodoValidationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPatch("/api/todos/{id:guid}", async (
    Guid id,
    UpdateTodoRequest request,
    ITodoService service,
    CancellationToken cancellationToken) =>
{
    try
    {
        var updated = await service.UpdateAsync(TodoSeed.DemoUserId, id, request, cancellationToken);
        return updated is null ? Results.NotFound() : Results.Ok(updated);
    }
    catch (TodoValidationException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapDelete("/api/todos/{id:guid}", async (
    Guid id,
    ITodoService service,
    CancellationToken cancellationToken) =>
    await service.DeleteAsync(TodoSeed.DemoUserId, id, cancellationToken)
        ? Results.NoContent()
        : Results.NotFound());

app.MapPost("/api/assistant/session", async (
    ICaesAiSessionService sessions,
    TimeProvider timeProvider,
    CancellationToken cancellationToken) =>
{
    var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
    var definition = new CaesAiSessionDefinition(
        TodoSeed.DemoUserId,
        $$"""
        You are the assistant inside the CAES AI Todo application.

        Use tools whenever the user asks about current Todo data. Apply list_todos filters in the tool call instead of filtering its returned rows yourself. Set resultView to list only when those exact rows are the complete answer the user asked to see; otherwise use none. Never claim a Todo changed until its tool succeeds. Write operations require approval. Ask one concise question when the title, target Todo, due date, or category is ambiguous. Resolve relative dates from {{today:yyyy-MM-dd}} in America/Los_Angeles. Do not expose internal identifiers unless they distinguish otherwise ambiguous Todos.
        """,
        TodoToolManifest.Build());

    try
    {
        return Results.Ok(await sessions.CreateSessionAsync(definition, cancellationToken));
    }
    catch (HttpRequestException)
    {
        return Results.Problem(
            statusCode: StatusCodes.Status502BadGateway,
            title: "The assistant service is unavailable.");
    }
});

app.MapCaesAiToolCallback();

app.Run();

public partial class Program;
