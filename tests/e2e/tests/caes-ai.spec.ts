import { expect, test } from "@playwright/test";

test("normal and assistant Todo flows work together", async ({ page }) => {
  const unique = `${Date.now()}`;
  const normalTitle = `Playwright normal ${unique}`;
  const assistantTitle = `Playwright assistant ${unique}`;

  await page.goto("/");
  const todoCard = page.locator(".todo-card");
  await expect(todoCard.getByText("Review project budget", { exact: true })).toBeVisible();
  await expect(todoCard.getByText("Archive old reports", { exact: true })).toBeVisible();

  await page.getByLabel("Todo title").fill(normalTitle);
  await page.getByRole("textbox", { name: "Category", exact: true }).fill("E2E");
  await page.getByRole("button", { name: "Add Todo" }).click();
  await expect(todoCard.getByText(normalTitle, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "active", exact: true }).click();
  await expect(todoCard.getByText("Review project budget", { exact: true })).toBeVisible();
  await expect(todoCard.getByText("Archive old reports", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "completed", exact: true }).click();
  await expect(todoCard.getByText("Archive old reports", { exact: true })).toBeVisible();
  await expect(todoCard.getByText("Review project budget", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "all", exact: true }).click();

  await page.getByRole("button", { name: "Ask CAES AI", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Assistant" });
  const composer = drawer.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeEnabled();

  await composer.fill("Show Todos with a due date");
  await composer.press("Enter");
  const todoListPresentation = drawer.getByRole("region", { name: "Todo list" });
  await expect(todoListPresentation).toBeVisible();
  const presentedTodos = todoListPresentation.locator(".tool-todo-list li");
  await expect(presentedTodos.first()).toBeVisible();
  await expect(todoListPresentation.getByText(normalTitle, { exact: true })).toHaveCount(0);
  expect(await presentedTodos.count()).toBe(await presentedTodos.locator("time").count());

  await composer.fill("How many Todos are incomplete?");
  await composer.press("Enter");
  const todoSummaryPresentation = drawer.getByRole("region", { name: "Todo summary" });
  await expect(todoSummaryPresentation).toBeVisible();
  await expect(todoSummaryPresentation.locator(".tool-summary")).toBeVisible();
  await expect(todoSummaryPresentation.getByText("Active Todos", { exact: true })).toBeVisible();

  await composer.fill(
    `Use add_todo to add "${assistantTitle}" in the Work category with no due date.`,
  );
  await composer.press("Enter");
  const addApproval = drawer.locator(".caes-ai-assistant__approval").filter({
    hasText: "Approve add_todo?",
  });
  await expect(addApproval).toContainText(assistantTitle);
  await expect(todoCard.getByText(assistantTitle, { exact: true })).toHaveCount(0);
  await addApproval.getByRole("button", { name: "Approve" }).click();
  await expect(todoCard.getByText(assistantTitle, { exact: true })).toBeVisible();

  const assistantCheckbox = todoCard.getByRole("checkbox", {
    name: `Mark ${assistantTitle} complete`,
  });
  await expect(assistantCheckbox).not.toBeChecked();
  await composer.fill(`Use set_todo_completion to mark "${assistantTitle}" complete.`);
  await composer.press("Enter");
  const completionApproval = drawer.locator(".caes-ai-assistant__approval").filter({
    hasText: "Approve set_todo_completion?",
  });
  await expect(completionApproval).toContainText("completed");
  await completionApproval.getByRole("button", { name: "Reject" }).click();
  await expect(completionApproval).toHaveCount(0);
  await expect(composer).toBeEnabled();
  await expect(assistantCheckbox).not.toBeChecked();

  await composer.fill("Use set_todo_filter to show only active Todos.");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "active", exact: true })).toHaveClass(/active/);
  await expect(todoCard.getByText("Archive old reports", { exact: true })).toHaveCount(0);

  await drawer.getByRole("button", { name: "Close assistant" }).click();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "Show inline demo" }).click();
  await expect(page.getByRole("heading", { name: "Inline assistant" })).toBeVisible();
  await expect(page.locator(".caes-ai-assistant--inline")).toBeVisible();
});
