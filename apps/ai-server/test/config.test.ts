import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";

describe("GitHub MCP configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, undefined],
    ["   ", undefined],
    ["  synthetic-github-token  ", "synthetic-github-token"],
  ])("reads the token from %j", (value, expected) => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("DATABASE_URL", "postgresql://unused.test/caes-ai");
    vi.stubEnv("CAES_AI_GITHUB_MCP_TOKEN", value);

    expect(loadConfig().githubMcpToken).toBe(expected);
  });
});
