using UCDavis.CaesAi.Todo.Api.Contracts;
using UCDavis.CaesAi.Todo.Api.Data;
using UCDavis.CaesAi.Todo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace UCDavis.CaesAi.Todo.Api.Services;

public interface ITodoService
{
    Task<IReadOnlyList<TodoResponse>> ListAsync(
        string userId,
        string status,
        string? category,
        bool? hasDueDate,
        CancellationToken cancellationToken);
    Task<TodoResponse?> FindAsync(string userId, Guid id, CancellationToken cancellationToken);
    Task<TodoResponse> CreateAsync(string userId, CreateTodoRequest request, CancellationToken cancellationToken);
    Task<TodoResponse?> UpdateAsync(string userId, Guid id, UpdateTodoRequest request, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(string userId, Guid id, CancellationToken cancellationToken);
    Task<TodoSummaryResponse> SummarizeAsync(string userId, string status, string? category, CancellationToken cancellationToken);
}

public sealed class TodoService(TodoDbContext dbContext, TimeProvider timeProvider) : ITodoService
{
    public async Task<IReadOnlyList<TodoResponse>> ListAsync(
        string userId,
        string status,
        string? category,
        bool? hasDueDate,
        CancellationToken cancellationToken)
    {
        var query = ApplyStatus(ScopedQuery(userId, category), status);
        if (hasDueDate.HasValue)
        {
            query = hasDueDate.Value
                ? query.Where(todo => todo.DueDate != null)
                : query.Where(todo => todo.DueDate == null);
        }

        var todos = await query.ToListAsync(cancellationToken);
        return todos
            .OrderBy(todo => todo.Completed)
            .ThenBy(todo => todo.DueDate == null)
            .ThenBy(todo => todo.DueDate)
            .ThenBy(todo => todo.CreatedAt)
            .ThenBy(todo => todo.Title)
            .Select(todo => ToResponse(todo))
            .ToList();
    }

    public async Task<TodoResponse?> FindAsync(string userId, Guid id, CancellationToken cancellationToken) =>
        await dbContext.Todos
            .Where(todo => todo.UserId == userId && todo.Id == id)
            .Select(todo => ToResponse(todo))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<TodoResponse> CreateAsync(
        string userId,
        CreateTodoRequest request,
        CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var todo = new TodoItem
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Title = NormalizeTitle(request.Title),
            DueDate = request.DueDate,
            Category = NormalizeCategory(request.Category),
            Completed = false,
            CreatedAt = now,
            UpdatedAt = now
        };

        dbContext.Todos.Add(todo);
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToResponse(todo);
    }

    public async Task<TodoResponse?> UpdateAsync(
        string userId,
        Guid id,
        UpdateTodoRequest request,
        CancellationToken cancellationToken)
    {
        var todo = await dbContext.Todos.SingleOrDefaultAsync(
            item => item.UserId == userId && item.Id == id,
            cancellationToken);
        if (todo is null)
        {
            return null;
        }

        if (request.Title is not null)
        {
            todo.Title = NormalizeTitle(request.Title);
        }
        if (request.Completed.HasValue)
        {
            todo.Completed = request.Completed.Value;
        }
        if (request.DueDate.HasValue)
        {
            todo.DueDate = request.DueDate;
        }
        if (request.Category is not null)
        {
            todo.Category = NormalizeCategory(request.Category);
        }

        todo.UpdatedAt = timeProvider.GetUtcNow();
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToResponse(todo);
    }

    public async Task<bool> DeleteAsync(string userId, Guid id, CancellationToken cancellationToken)
    {
        var todo = await dbContext.Todos.SingleOrDefaultAsync(
            item => item.UserId == userId && item.Id == id,
            cancellationToken);
        if (todo is null)
        {
            return false;
        }

        dbContext.Todos.Remove(todo);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<TodoSummaryResponse> SummarizeAsync(
        string userId,
        string status,
        string? category,
        CancellationToken cancellationToken)
    {
        var todos = await ApplyStatus(ScopedQuery(userId, category), status)
            .ToListAsync(cancellationToken);
        var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        var byCategory = todos
            .GroupBy(todo => todo.Category ?? "Uncategorized", StringComparer.OrdinalIgnoreCase)
            .Select(group => new CategoryCount(group.Key, group.Count()))
            .OrderByDescending(item => item.Count)
            .ThenBy(item => item.Category)
            .ToList();

        return new TodoSummaryResponse(
            todos.Count,
            todos.Count(todo => !todo.Completed),
            todos.Count(todo => todo.Completed),
            todos.Count(todo => !todo.Completed && todo.DueDate < today),
            byCategory);
    }

    private static IQueryable<TodoItem> ApplyStatus(IQueryable<TodoItem> query, string status) =>
        status.ToLowerInvariant() switch
        {
            "active" => query.Where(todo => !todo.Completed),
            "completed" => query.Where(todo => todo.Completed),
            "all" or "" => query,
            _ => throw new TodoValidationException("Status must be all, active, or completed.")
        };

    private IQueryable<TodoItem> ScopedQuery(string userId, string? category)
    {
        var query = dbContext.Todos.AsNoTracking().Where(todo => todo.UserId == userId);
        if (!string.IsNullOrWhiteSpace(category))
        {
            var normalized = category.Trim();
            query = query.Where(todo => todo.Category == normalized);
        }
        return query;
    }

    private static string NormalizeTitle(string title)
    {
        var normalized = title.Trim();
        if (normalized.Length is < 1 or > 200)
        {
            throw new TodoValidationException("Title must contain 1 to 200 characters.");
        }
        return normalized;
    }

    private static string? NormalizeCategory(string? category)
    {
        if (string.IsNullOrWhiteSpace(category))
        {
            return null;
        }

        var normalized = category.Trim();
        if (normalized.Length > 50)
        {
            throw new TodoValidationException("Category cannot exceed 50 characters.");
        }
        return normalized;
    }

    private static TodoResponse ToResponse(TodoItem todo) => new(
        todo.Id,
        todo.Title,
        todo.Completed,
        todo.DueDate,
        todo.Category,
        todo.CreatedAt,
        todo.UpdatedAt);
}

public sealed class TodoValidationException(string message) : Exception(message);
