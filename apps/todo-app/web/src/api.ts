import type { AssistantSession } from "@ucdavis/caes-ai-assistant-react";

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoSummary {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  byCategory: Array<{ category: string; count: number }>;
}

const baseUrl = (import.meta.env.VITE_TODO_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Request failed with status ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const todoApi = {
  list: (status: "all" | "active" | "completed", category?: string) => {
    const search = new URLSearchParams({ status });
    if (category) search.set("category", category);
    return request<Todo[]>(`/api/todos?${search}`);
  },
  summary: (category?: string) => {
    const search = new URLSearchParams();
    if (category) search.set("category", category);
    return request<TodoSummary>(`/api/todos/summary?${search}`);
  },
  create: (input: { title: string; dueDate: string | null; category: string | null }) =>
    request<Todo>("/api/todos", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: Partial<Pick<Todo, "title" | "completed" | "dueDate" | "category">>) =>
    request<Todo>(`/api/todos/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/api/todos/${id}`, { method: "DELETE" }),
  createAssistantSession: () =>
    request<AssistantSession>("/api/assistant/session", { method: "POST" }),
};
