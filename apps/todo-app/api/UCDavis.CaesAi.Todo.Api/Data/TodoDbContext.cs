using UCDavis.CaesAi.Todo.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace UCDavis.CaesAi.Todo.Api.Data;

public sealed class TodoDbContext(DbContextOptions<TodoDbContext> options) : DbContext(options)
{
    public DbSet<TodoItem> Todos => Set<TodoItem>();
    public DbSet<ProcessedToolCall> ProcessedToolCalls => Set<ProcessedToolCall>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TodoItem>(entity =>
        {
            entity.HasKey(todo => todo.Id);
            entity.Property(todo => todo.UserId).HasMaxLength(128);
            entity.Property(todo => todo.Title).HasMaxLength(200);
            entity.Property(todo => todo.Category).HasMaxLength(50);
            entity.HasIndex(todo => new { todo.UserId, todo.Completed });
        });

        modelBuilder.Entity<ProcessedToolCall>(entity =>
        {
            entity.HasKey(call => call.ToolCallId);
            entity.Property(call => call.ToolCallId).HasMaxLength(256);
            entity.Property(call => call.ToolName).HasMaxLength(64);
            entity.Property(call => call.UserId).HasMaxLength(128);
        });
    }
}
