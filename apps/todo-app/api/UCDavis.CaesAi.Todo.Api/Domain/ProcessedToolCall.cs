namespace UCDavis.CaesAi.Todo.Api.Domain;

public sealed class ProcessedToolCall
{
    public required string ToolCallId { get; set; }
    public required string ToolName { get; set; }
    public required string UserId { get; set; }
    public required string ResponseJson { get; set; }
    public DateTimeOffset ProcessedAt { get; set; }
}
