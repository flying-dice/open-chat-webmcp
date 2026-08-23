<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). Purely presentational — all
   * storage/test-connection flow lives in the parent (see the component's own
   * header comment) — so every story here is plain props, no services. Covers
   * the badge trio (disabled/bearer/needs-reconnect) `oauthNeedsReconnect`
   * (src/domain/tools) decides, plus a test outcome underneath via
   * McpTestResult.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import McpServerRow from "./McpServerRow.svelte";
  import type { McpServerConfig } from "../../domain/tools";
  import type { McpTestOutcome } from "../forms/mcpTestConnection";

  function server(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
    return {
      id: "srv-1",
      name: "GitHub MCP",
      url: "https://api.githubcopilot.com/mcp",
      enabled: true,
      transport: "auto",
      ...overrides,
    };
  }

  const SUCCESS: McpTestOutcome = {
    kind: "success",
    connection: { protocolVersion: "2025-06-18", serverInfo: { name: "github-mcp" } },
    tools: [{ name: "search_issues" }, { name: "create_pull_request" }],
  };

  const { Story } = defineMeta({
    title: "Options/McpServerRow",
    component: McpServerRow,
    tags: ["autodocs"],
    args: {
      isFirst: false,
      isLast: false,
      permissionGranted: true,
      testOutcome: undefined,
      testing: false,
      onEdit: () => undefined,
      onRemove: () => undefined,
      onMoveUp: () => undefined,
      onMoveDown: () => undefined,
      onToggleEnabled: () => undefined,
      onTest: () => undefined,
    },
  });
</script>

<Story name="Enabled, no auth" args={{ server: server() }} />

<Story
  name="Bearer token"
  args={{ server: server({ auth: { type: "bearer", token: "sk-server-token" }, headers: { "X-Trace": "1" } }) }}
/>

<Story
  name="Needs reconnect"
  args={{
    server: server({
      auth: { type: "oauth", accessToken: "expired", clientId: "c", expiresAt: Date.now() - 60_000, authorizationServer: { issuer: "https://auth.example.com", authorizationEndpoint: "https://auth.example.com/authorize", tokenEndpoint: "https://auth.example.com/token" } },
    }),
  }}
/>

<Story name="Disabled" args={{ server: server({ enabled: false }), permissionGranted: undefined }} />

<Story name="Testing" args={{ server: server(), testing: true }} />

<Story name="Test succeeded, tools found" args={{ server: server(), testOutcome: SUCCESS }} />
