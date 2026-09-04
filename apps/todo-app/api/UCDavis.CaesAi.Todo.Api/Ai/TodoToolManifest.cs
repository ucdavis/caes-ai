using System.Text.Json.Nodes;
using UCDavis.CaesAi.AppSdk;

namespace UCDavis.CaesAi.Todo.Api.Ai;

public static class TodoToolManifest
{
    public static IReadOnlyList<ApplicationToolManifest> Build() =>
    [
        new(
            "list_todos",
            "Returns the current user's Todos, filtered by completion status, category, or whether a due date is set. Set resultView to list only when these exact filtered rows are the complete answer the user asked to see. Use none when reading rows for lookup, further filtering, comparison, or another action.",
            CaesAiToolExecution.Server,
            CaesAiToolRisk.Read,
            false,
            CaesAiJsonSchema.Object(new JsonObject
            {
                ["status"] = CaesAiJsonSchema.String("all", "active", "completed"),
                ["category"] = CaesAiJsonSchema.String(),
                ["hasDueDate"] = new JsonObject { ["type"] = "boolean" },
                ["resultView"] = CaesAiJsonSchema.String("list", "none")
            }),
            CaesAiJsonSchema.Object(new JsonObject
            {
                ["items"] = new JsonObject { ["type"] = "array", ["items"] = TodoSchema() }
            }, "items"),
            new ToolPresentation("todo-list", "Todo list")),
        new(
            "get_todo_summary",
            "Counts the current user's Todos, optionally filtered by completion status or category. The application renders the result as a summary card.",
            CaesAiToolExecution.Server,
            CaesAiToolRisk.Read,
            false,
            CaesAiJsonSchema.Object(new JsonObject
            {
                ["status"] = CaesAiJsonSchema.String("all", "active", "completed"),
                ["category"] = CaesAiJsonSchema.String()
            }),
            CaesAiJsonSchema.Object(new JsonObject
            {
                ["total"] = CaesAiJsonSchema.Integer(),
                ["active"] = CaesAiJsonSchema.Integer(),
                ["completed"] = CaesAiJsonSchema.Integer(),
                ["overdue"] = CaesAiJsonSchema.Integer(),
                ["byCategory"] = new JsonObject
                {
                    ["type"] = "array",
                    ["items"] = CaesAiJsonSchema.Object(new JsonObject
                    {
                        ["category"] = CaesAiJsonSchema.String(),
                        ["count"] = CaesAiJsonSchema.Integer()
                    }, "category", "count")
                }
            }, "total", "active", "completed", "overdue", "byCategory"),
            new ToolPresentation("todo-summary", "Todo summary")),
        new(
            "add_todo",
            "Creates a Todo for the current user. Resolve relative dates before calling.",
            CaesAiToolExecution.Server,
            CaesAiToolRisk.Write,
            true,
            CaesAiJsonSchema.Object(new JsonObject
            {
                ["title"] = CaesAiJsonSchema.String(),
                ["dueDate"] = new JsonObject { ["type"] = CaesAiJsonSchema.NullableTypes("string"), ["format"] = "date" },
                ["category"] = new JsonObject { ["type"] = CaesAiJsonSchema.NullableTypes("string") }
            }, "title"),
            CaesAiJsonSchema.Object(new JsonObject { ["todo"] = TodoSchema() }, "todo"),
            new ToolPresentation("todo-item", "New Todo")),
        new(
            "set_todo_completion",
            "Marks one of the current user's Todos complete or incomplete.",
            CaesAiToolExecution.Server,
            CaesAiToolRisk.Write,
            true,
            CaesAiJsonSchema.Object(new JsonObject
            {
                ["todoId"] = new JsonObject { ["type"] = "string", ["format"] = "uuid" },
                ["completed"] = new JsonObject { ["type"] = "boolean" }
            }, "todoId", "completed"),
            CaesAiJsonSchema.Object(new JsonObject { ["todo"] = TodoSchema() }, "todo"),
            new ToolPresentation("todo-item", "Todo update")),
        new(
            "set_todo_filter",
            "Changes the visible Todo filter in the browser.",
            CaesAiToolExecution.Client,
            CaesAiToolRisk.Ui,
            false,
            CaesAiJsonSchema.Object(new JsonObject
            {
                ["filter"] = CaesAiJsonSchema.String("all", "active", "completed")
            }, "filter"),
            CaesAiJsonSchema.Object(new JsonObject
            {
                ["applied"] = new JsonObject { ["type"] = "boolean" }
            }, "applied"))
    ];

    private static JsonObject TodoSchema() => CaesAiJsonSchema.Object(new JsonObject
    {
        ["id"] = new JsonObject { ["type"] = "string", ["format"] = "uuid" },
        ["title"] = CaesAiJsonSchema.String(),
        ["completed"] = new JsonObject { ["type"] = "boolean" },
        ["dueDate"] = new JsonObject { ["type"] = CaesAiJsonSchema.NullableTypes("string"), ["format"] = "date" },
        ["category"] = new JsonObject { ["type"] = CaesAiJsonSchema.NullableTypes("string") },
        ["createdAt"] = new JsonObject { ["type"] = "string", ["format"] = "date-time" },
        ["updatedAt"] = new JsonObject { ["type"] = "string", ["format"] = "date-time" }
    }, "id", "title", "completed", "createdAt", "updatedAt");
}
