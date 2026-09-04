import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../src/App.js";

const todos = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Visible active Todo",
    completed: false,
    dueDate: "2026-09-02",
    category: "Work",
    createdAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Visible completed Todo",
    completed: true,
    dueDate: null,
    category: "Personal",
    createdAt: "2026-08-31T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z",
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("Todo host page", () => {
  it("loads ordinary Todo state and applies the normal active filter", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/assistant/session") {
        return Response.json({
          sessionId: "00000000-0000-4000-8000-000000000099",
          accessToken: "browser-session-token-that-is-long-enough",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          chatUrl: "http://central.test/chat",
          modelPolicy: {
            model: "test-model",
            defaultReasoningEffort: "low",
            maximumReasoningEffort: "medium",
            allowedReasoningEfforts: ["low", "medium"],
          },
          toolManifestHash: "a".repeat(64),
          tools: [],
        });
      }
      if (url.startsWith("/api/todos/summary")) {
        return Response.json({
          total: 2,
          active: 1,
          completed: 1,
          overdue: 0,
          byCategory: [],
        });
      }
      if (url.startsWith("/api/todos?")) {
        const visible = url.includes("status=active")
          ? todos.filter((todo) => !todo.completed)
          : todos;
        return Response.json(visible);
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Visible active Todo")).toBeVisible();
    expect(screen.getByText("Visible completed Todo")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "active" }));

    await waitFor(() => {
      expect(screen.queryByText("Visible completed Todo")).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("status=active"),
      expect.any(Object),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try Ask CAES AI" }));
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "How many active Todos do I have?",
    );
  });
});
