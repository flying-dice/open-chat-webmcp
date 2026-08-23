<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). McpServersSection reads
   * `optionsServices().mcpServers`/`.permissions` from `onMount`, so every
   * story seeds `parameters.services.options`. "Seeded — mixed auth states"
   * is the card's explicit ask: OAuth-state rows (a bearer-token server, a
   * disabled server, and an OAuth server needing reconnect) side by side —
   * the same `oauthNeedsReconnect` badge McpServerRow.stories.svelte shows in
   * isolation, here reached through the real section + registry seam.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, within } from "storybook/test";
  import McpServersSection from "./McpServersSection.svelte";
  import type { McpOAuthAuth, McpServerConfig } from "../../domain/tools";
  import { ok } from "../../domain/result";
  import type { OptionsServices } from "../app-services";
  import { createFakeMcpServerRegistry } from "../testing/fake-services";
  import { m } from "../../paraglide/messages.js";

  function fakeAuth(overrides: Partial<McpOAuthAuth> = {}): McpOAuthAuth {
    return {
      type: "oauth",
      accessToken: "fake-access-token",
      clientId: "fake-client-id",
      authorizationServer: {
        issuer: "https://auth.example.com",
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
      },
      ...overrides,
    };
  }

  const MIXED_SERVERS: McpServerConfig[] = [
    {
      id: "srv-github",
      name: "GitHub MCP",
      url: "https://api.githubcopilot.com/mcp",
      enabled: true,
      transport: "auto",
      auth: { type: "bearer", token: "ghp_fake" },
    },
    {
      id: "srv-linear",
      name: "Linear",
      url: "https://mcp.linear.app/mcp",
      enabled: true,
      transport: "streamable-http",
      auth: fakeAuth({ expiresAt: Date.UTC(2020, 0, 1) }), // needs reconnect
    },
    {
      id: "srv-internal",
      name: "Internal tools",
      url: "https://mcp.internal.example.com/mcp",
      enabled: false,
      transport: "auto",
    },
  ];

  const seedGranted = (services: OptionsServices): void => {
    services.permissions.has = async () => true;
    services.permissions.request = async () => true;
  };

  const seedMixedServers = (services: OptionsServices): void => {
    seedGranted(services);
    services.mcpServers = createFakeMcpServerRegistry(MIXED_SERVERS);
  };

  const { Story } = defineMeta({
    title: "Options/McpServersSection",
    component: McpServersSection,
    tags: ["autodocs"],
    parameters: { services: { options: seedGranted } },
  });
</script>

<Story name="Seeded — mixed auth states" parameters={{ services: { options: seedMixedServers } }} />

<Story name="No servers yet" />

<Story
  name="Add form opened"
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // `findByRole` (not `getByRole`) because the section's `onMount` load is
    // still in flight when `play` starts — confirmed live in the Storybook
    // iframe via Playwright, where a `getByRole` click here raced the
    // "Loading MCP servers…" state and failed outright.
    await userEvent.click(await canvas.findByRole("button", { name: m.mcpServersSection_addAction() }));
    await expect(canvas.getByLabelText(m.displayNameLabel())).toBeInTheDocument();
  }}
/>
