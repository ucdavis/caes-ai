namespace UCDavis.CaesAi.Todo.Api.Domain;

public sealed class TodoItem
{
    public Guid Id { get; set; }
    public required string UserId { get; set; }
    public required string Title { get; set; }
    public bool Completed { get; set; }
    public DateOnly? DueDate { get; set; }
    public string? Category { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
