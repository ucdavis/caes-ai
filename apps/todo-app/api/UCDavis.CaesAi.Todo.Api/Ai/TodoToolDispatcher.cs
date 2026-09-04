using System.Text.Json;
using UCDavis.CaesAi.AppSdk;
using UCDavis.CaesAi.Todo.Api.Contracts;
using UCDavis.CaesAi.Todo.Api.Data;
using UCDavis.CaesAi.Todo.Api.Domain;
using UCDavis.CaesAi.Todo.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace UCDavis.CaesAi.Todo.Api.Ai;

public sealed class TodoToolDispatcher(
    ITodoService todoService,
    TodoDbContext dbContext,
    TimeProvider timeProvider,
    ILogger<TodoToolDispatcher> logger) : ICaesAiToolDispatcher
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<ToolExecutionResponse> ExecuteAsync(
        ToolExecutionRequest request,
        string userId,
        CancellationToken cancellationToken)
    {
        try
        {
            return request.ToolName switch
            {
                "list_todos" => await ListAsync(request.Arguments, userId, cancellationToken),
                "get_todo_summary" => await SummarizeAsync(request.Arguments, userId, cancellationToken),
                "add_todo" => await ExecuteIdempotentMutationAsync(
                    request,
                    userId,
                    () => AddAsync(request.Arguments, userId, cancellationToken),
                    cancellationToken),
                "set_todo_completion" => await ExecuteIdempotentMutationAsync(
                    request,
                    userId,
                    () => SetCompletionAsync(request.Arguments, userId, cancellationToken),
                    cancellationToken),
                _ => ToolExecutionResponse.Failure("tool_not_found", "The requested tool is not available.")
            };
        }
        catch (JsonException)
        {
            return ToolExecutionResponse.Failure("invalid_tool_arguments", "The tool arguments are invalid.");
        }
        catch (TodoValidationException exception)
        {
            return ToolExecutionResponse.Failure("invalid_tool_arguments", exception.Message);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Tool execution failed for {ToolName} and {ToolCallId}",
                request.ToolName,
                request.ToolCallId);
            return ToolExecutionResponse.Failure(
                "tool_execution_failed",
                "The Todo operation failed.",
                retryable: true);
        }
    }

    private async Task<ToolExecutionResponse> ListAsync(
        JsonElement arguments,
        string userId,
        CancellationToken cancellationToken)
    {
        var input = arguments.Deserialize<ListTodosArguments>(JsonOptions) ?? new();
        var showList = (input.ResultView ?? "none").ToLowerInvariant() switch
        {
            "list" => true,
            "none" or "" => false,
            _ => throw new TodoValidationException("Result view must be list or none.")
        };
        var items = await todoService.ListAsync(
            userId,
            input.Status ?? "all",
            input.Category,
            input.HasDueDate,
            cancellationToken);
        return ToolExecutionResponse.Success(
            new { items },
            new ToolDisplay(
                "todo-list",
                new { },
                Visibility: showList
                    ? CaesAiDisplayVisibility.Inline
                    : CaesAiDisplayVisibility.Hidden,
                SuppressAssistantText: showList));
    }

    private async Task<ToolExecutionResponse> SummarizeAsync(
        JsonElement arguments,
        string userId,
        CancellationToken cancellationToken)
    {
        var input = arguments.Deserialize<SummaryArguments>(JsonOptions) ?? new();
        var status = input.Status ?? "all";
        var summary = await todoService.SummarizeAsync(
            userId,
            status,
            input.Category,
            cancellationToken);
        return ToolExecutionResponse.Success(
            summary,
            new ToolDisplay(
                "todo-summary",
                new { status, category = input.Category },
                Visibility: CaesAiDisplayVisibility.Inline,
                SuppressAssistantText: true));
    }

    private async Task<ToolExecutionResponse> AddAsync(
        JsonElement arguments,
        string userId,
        CancellationToken cancellationToken)
    {
        var input = arguments.Deserialize<AddTodoArguments>(JsonOptions)
            ?? throw new JsonException("Missing arguments.");
        var todo = await todoService.CreateAsync(
            userId,
            new CreateTodoRequest(input.Title, input.DueDate, input.Category),
            cancellationToken);
        return ToolExecutionResponse.Success(
            new { todo },
            new ToolDisplay("todo-item", new { }),
            UiEffect.Invalidate("todos"),
            UiEffect.Invalidate("todo-summary"),
            UiEffect.Toast("success", "Todo added."));
    }

    private async Task<ToolExecutionResponse> SetCompletionAsync(
        JsonElement arguments,
        string userId,
        CancellationToken cancellationToken)
    {
        var input = arguments.Deserialize<SetCompletionArguments>(JsonOptions)
            ?? throw new JsonException("Missing arguments.");
        var todo = await todoService.UpdateAsync(
            userId,
            input.TodoId,
            new UpdateTodoRequest(null, input.Completed, null, null),
            cancellationToken);
        return todo is null
            ? ToolExecutionResponse.Failure("tool_not_found", "The Todo was not found.")
            : ToolExecutionResponse.Success(
                new { todo },
                new ToolDisplay("todo-item", new { }),
                UiEffect.Invalidate("todos"),
                UiEffect.Invalidate("todo-summary"),
                UiEffect.Toast("success", input.Completed ? "Todo completed." : "Todo reopened."));
    }

    private async Task<ToolExecutionResponse> ExecuteIdempotentMutationAsync(
        ToolExecutionRequest request,
        string userId,
        Func<Task<ToolExecutionResponse>> execute,
        CancellationToken cancellationToken)
    {
        var identity = CaesAiToolRequestIdentityFactory.Create(request, userId);
        var existing = await dbContext.ProcessedToolCalls
            .AsNoTracking()
            .SingleOrDefaultAsync(
                call => call.ToolCallId == identity.StorageKey,
                cancellationToken);
        if (existing is not null)
        {
            var stored = JsonSerializer.Deserialize<StoredToolResult>(
                existing.ResponseJson,
                JsonOptions);
            if (stored is null ||
                existing.ToolName != request.ToolName ||
                existing.UserId != userId ||
                stored.RequestHash != identity.RequestHash)
            {
                return ToolExecutionResponse.Failure(
                    "tool_execution_failed",
                    "The repeated tool call does not match its original request.");
            }

            return stored.Response;
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var response = await execute();
        if (!response.Ok)
        {
            await transaction.RollbackAsync(cancellationToken);
            return response;
        }

        dbContext.ProcessedToolCalls.Add(new ProcessedToolCall
        {
            ToolCallId = identity.StorageKey,
            ToolName = request.ToolName,
            UserId = userId,
            ResponseJson = JsonSerializer.Serialize(
                new StoredToolResult(identity.RequestHash, response),
                JsonOptions),
            ProcessedAt = timeProvider.GetUtcNow()
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return response;
    }

    private sealed record ListTodosArguments(
        string? Status = null,
        string? Category = null,
        bool? HasDueDate = null,
        string? ResultView = null);
    private sealed record SummaryArguments(string? Status = null, string? Category = null);
    private sealed record AddTodoArguments(string Title, DateOnly? DueDate, string? Category);
    private sealed record SetCompletionArguments(Guid TodoId, bool Completed);
    private sealed record StoredToolResult(string RequestHash, ToolExecutionResponse Response);
}
