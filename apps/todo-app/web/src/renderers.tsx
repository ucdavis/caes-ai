import type { AssistantRendererProps } from "@ucdavis/caes-ai-assistant-react";

import type { Todo, TodoSummary } from "./api.js";

const dueDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDueDate(value: string): string {
  return dueDateFormatter.format(new Date(`${value}T12:00:00`));
}

export function TodoListToolResult({ data }: AssistantRendererProps) {
  const items = ((data as { items?: Todo[] }).items ?? []);
  if (items.length === 0) {
    return <p className="tool-todo-list__empty">No matching Todos.</p>;
  }
  return (
    <ul className="tool-todo-list">
      {items.map((todo) => (
        <li key={todo.id}>
          <span aria-hidden="true">{todo.completed ? "✓" : "○"}</span>
          <span>{todo.title}</span>
          {todo.dueDate && <time dateTime={todo.dueDate}>{formatDueDate(todo.dueDate)}</time>}
        </li>
      ))}
    </ul>
  );
}

export function TodoSummaryToolResult({ data, props }: AssistantRendererProps) {
  const summary = data as TodoSummary;
  const status = typeof props.status === "string" ? props.status : "all";
  const category = typeof props.category === "string" ? props.category : undefined;
  const maximum = Math.max(summary.total || 1, 1);
  const scope = [
    status === "active" ? "Active Todos" : status === "completed" ? "Completed Todos" : "All Todos",
    category,
  ].filter(Boolean).join(" in ");
  return (
    <div className="tool-summary">
      <p className="tool-summary__scope">{scope}</p>
      <div><strong>{summary.total}</strong><span>Total</span></div>
      <div><strong>{summary.active}</strong><span>Active</span></div>
      <div><strong>{summary.completed}</strong><span>Done</span></div>
      <div><strong>{summary.overdue}</strong><span>Overdue</span></div>
      <div className="tool-summary__bar" aria-label={`${summary.completed} of ${summary.total} complete`}>
        <span style={{ width: `${(summary.completed / maximum) * 100}%` }} />
      </div>
      {summary.byCategory.length > 0 && (
        <div className="tool-summary__categories">
          <span>By category</span>
          <ul>
            {summary.byCategory.map((item) => (
              <li key={item.category}><span>{item.category}</span><strong>{item.count}</strong></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TodoItemToolResult({ data }: AssistantRendererProps) {
  const todo = (data as { todo: Todo }).todo;
  return (
    <div className="tool-todo-item">
      <span aria-hidden="true">{todo.completed ? "✓" : "○"}</span>
      <div><strong>{todo.title}</strong><small>{todo.category ?? "Uncategorized"}</small></div>
    </div>
  );
}
