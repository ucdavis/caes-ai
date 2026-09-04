namespace UCDavis.CaesAi.Todo.Api.Contracts;

public sealed record CreateTodoRequest(string Title, DateOnly? DueDate, string? Category);

public sealed record UpdateTodoRequest(string? Title, bool? Completed, DateOnly? DueDate, string? Category);

public sealed record TodoResponse(
    Guid Id,
    string Title,
    bool Completed,
    DateOnly? DueDate,
    string? Category,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CategoryCount(string Category, int Count);

public sealed record TodoSummaryResponse(
    int Total,
    int Active,
    int Completed,
    int Overdue,
    IReadOnlyList<CategoryCount> ByCategory);
