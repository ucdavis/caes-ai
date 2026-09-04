import {
  AssistantProvider,
  type AssistantRendererRegistry,
  useAssistant,
} from "@ucdavis/caes-ai-assistant-react";
import {
  AssistantDrawer,
  AssistantInline,
  AssistantLauncher,
} from "@ucdavis/caes-ai-assistant-react/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";

import { todoApi, type Todo } from "./api.js";
import {
  TodoItemToolResult,
  TodoListToolResult,
  TodoSummaryToolResult,
} from "./renderers.js";

type Status = "all" | "active" | "completed";

const renderers: AssistantRendererRegistry = {
  "todo-list": TodoListToolResult,
  "todo-summary": TodoSummaryToolResult,
  "todo-item": TodoItemToolResult,
};

function AddTodoForm({ onAdd, pending }: { onAdd: (input: { title: string; dueDate: string | null; category: string | null }) => void; pending: boolean }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [category, setCategory] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({ title: title.trim(), dueDate: dueDate || null, category: category.trim() || null });
    setTitle("");
    setDueDate("");
    setCategory("");
  };
  return (
    <form className="todo-form" onSubmit={submit}>
      <label className="todo-form__title">What needs doing?<input aria-label="Todo title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Prepare the project update" /></label>
      <label>Due date<input aria-label="Due date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      <label>Category<input aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={50} placeholder="Work" /></label>
      <button type="submit" disabled={pending || !title.trim()}>{pending ? "Adding…" : "Add Todo"}</button>
    </form>
  );
}

function TodoRow({ todo, onToggle, onDelete }: { todo: Todo; onToggle: () => void; onDelete: () => void }) {
  return (
    <li className={`todo-row ${todo.completed ? "todo-row--completed" : ""}`}>
      <label className="todo-row__check"><input type="checkbox" checked={todo.completed} onChange={onToggle} aria-label={`Mark ${todo.title} ${todo.completed ? "active" : "complete"}`} /><span aria-hidden="true" /></label>
      <div className="todo-row__body"><strong>{todo.title}</strong><div>{todo.category && <span className="category-pill">{todo.category}</span>}{todo.dueDate && <time dateTime={todo.dueDate}>Due {new Date(`${todo.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>}</div></div>
      <button className="todo-row__delete" type="button" onClick={onDelete} aria-label={`Delete ${todo.title}`}>Delete</button>
    </li>
  );
}

function AskCaesAiExampleButton() {
  const assistant = useAssistant();
  return (
    <button
      type="button"
      className="view-toggle"
      onClick={() => assistant.openWithDraft("How many active Todos do I have?")}
    >
      Try Ask CAES AI
    </button>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("all");
  const [category, setCategory] = useState("");
  const [inline, setInline] = useState(false);
  const [toast, setToast] = useState<string>();

  const todos = useQuery({ queryKey: ["todos", status, category], queryFn: () => todoApi.list(status, category || undefined) });
  const summary = useQuery({ queryKey: ["todo-summary", category], queryFn: () => todoApi.summary(category || undefined) });
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["todos"] }),
    queryClient.invalidateQueries({ queryKey: ["todo-summary"] }),
  ]);
  const createTodo = useMutation({ mutationFn: todoApi.create, onSuccess: invalidate });
  const updateTodo = useMutation({ mutationFn: ({ id, completed }: { id: string; completed: boolean }) => todoApi.update(id, { completed }), onSuccess: invalidate });
  const deleteTodo = useMutation({ mutationFn: todoApi.remove, onSuccess: invalidate });

  const setTodoFilterTool = useMemo(
    () => ({
      name: "set_todo_filter",
      execute: (args: unknown) => {
        const filter = (args as { filter: Status }).filter;
        setStatus(filter);
        return { applied: true };
      },
    }),
    [],
  );
  const clientTools = useMemo(() => [setTodoFilterTool], [setTodoFilterTool]);
  const uiBridge = useMemo(
    () => ({
      invalidateQuery: (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: [...key] }),
      showToast: (_level: "success" | "info" | "error", message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(undefined), 3_000);
      },
    }),
    [queryClient],
  );

  const categories = [...new Set(
    (todos.data ?? []).flatMap((todo) => todo.category ? [todo.category] : []),
  )];
  return (
    <AssistantProvider
      createSession={todoApi.createAssistantSession}
      clientTools={clientTools}
      renderers={renderers}
      uiBridge={uiBridge}
      title="Todo Assistant"
    >
      <div className="app-shell">
        <header className="app-header"><div className="brand-mark" aria-hidden="true">C</div><div><span>CAES AI Alpha</span><h1>Todos, with a careful assistant</h1></div><div className="app-header__actions"><AskCaesAiExampleButton /><button type="button" className="view-toggle" onClick={() => setInline((value) => !value)}>{inline ? "Hide inline demo" : "Show inline demo"}</button></div></header>
        <main>
          <section className="summary-grid" aria-label="Todo summary">
            <div><span>Active</span><strong>{summary.data?.active ?? "—"}</strong></div>
            <div><span>Completed</span><strong>{summary.data?.completed ?? "—"}</strong></div>
            <div><span>Total</span><strong>{summary.data?.total ?? "—"}</strong></div>
            <div><span>Overdue</span><strong>{summary.data?.overdue ?? "—"}</strong></div>
          </section>
          <section className="todo-card">
            <div className="todo-card__heading"><div><span className="eyebrow">Demo workspace</span><h2>My Todos</h2></div><div className="filters" role="group" aria-label="Todo filters">{(["all", "active", "completed"] as const).map((filter) => <button type="button" key={filter} className={status === filter ? "active" : ""} onClick={() => setStatus(filter)}>{filter}</button>)}</div></div>
            <AddTodoForm onAdd={(input) => createTodo.mutate(input)} pending={createTodo.isPending} />
            <div className="category-filter"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label></div>
            {todos.isLoading && <p className="state-message">Loading Todos…</p>}
            {todos.isError && <p className="state-message state-message--error">{todos.error.message}</p>}
            {todos.data?.length === 0 && <p className="state-message">No Todos match this view.</p>}
            {todos.data && todos.data.length > 0 && <ul className="todo-list">{todos.data.map((todo) => <TodoRow key={todo.id} todo={todo} onToggle={() => updateTodo.mutate({ id: todo.id, completed: !todo.completed })} onDelete={() => deleteTodo.mutate(todo.id)} />)}</ul>}
          </section>
          {inline && <section className="inline-demo"><div><span className="eyebrow">Reusable layout</span><h2>Inline assistant</h2></div><AssistantInline composerProps={{ placeholder: "Ask about your Todos…" }} /></section>}
        </main>
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
      <AssistantLauncher />
      <div id="caes-ai-assistant-drawer"><AssistantDrawer panelProps={{ composerProps: { placeholder: "Ask about your Todos…" } }} /></div>
    </AssistantProvider>
  );
}
