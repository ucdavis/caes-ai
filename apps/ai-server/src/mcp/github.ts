export const githubMcpUrl = "https://api.githubcopilot.com/mcp/x/repos/readonly";
export const githubAllowedTools = ["search_code", "get_file_contents"] as const;
export const githubToolNames: readonly string[] = githubAllowedTools.map((name) => `github_${name}`);
