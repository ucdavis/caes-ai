import { defineConfig, devices } from "@playwright/test";

const useExistingStack = process.env.CAES_AI_E2E_USE_EXISTING_STACK === "true";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.CAES_AI_E2E_BASE_URL || "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useExistingStack ? undefined : {
    command: "npm --prefix ../.. run dev",
    // The Vite process is ready before the .NET API on a cold build. Waiting on
    // Kestrel prevents the assistant's one-time session bootstrap from racing it.
    url: "http://127.0.0.1:5180/health",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
