using UCDavis.CaesAi.Todo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace UCDavis.CaesAi.Todo.Api.Data;

public static class TodoSeed
{
    public const string DemoUserId = "demo-user-1";

    public static async Task InitializeAsync(
        TodoDbContext dbContext,
        TimeProvider timeProvider,
        CancellationToken cancellationToken = default)
    {
        await dbContext.Database.EnsureCreatedAsync(cancellationToken);
        if (await dbContext.Todos.AnyAsync(cancellationToken))
        {
            return;
        }

        var now = timeProvider.GetUtcNow();
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        dbContext.Todos.AddRange(
            Create("Review project budget", "Work", today.AddDays(1), false, now.AddMinutes(-30)),
            Create("Submit travel receipts", "Finance", today.AddDays(-2), false, now.AddHours(-2)),
            Create("Plan faculty meeting", "Work", today.AddDays(5), false, now.AddHours(-3)),
            Create("Renew parking permit", "Personal", today.AddDays(10), false, now.AddDays(-1)),
            Create("Archive old reports", "Work", null, true, now.AddDays(-3)),
            Create("Reconcile August expenses", "Finance", today, true, now.AddDays(-2)));
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static TodoItem Create(
        string title,
        string category,
        DateOnly? dueDate,
        bool completed,
        DateTimeOffset createdAt) => new()
        {
            Id = Guid.NewGuid(),
            UserId = DemoUserId,
            Title = title,
            Category = category,
            DueDate = dueDate,
            Completed = completed,
            CreatedAt = createdAt,
            UpdatedAt = createdAt
        };
}
