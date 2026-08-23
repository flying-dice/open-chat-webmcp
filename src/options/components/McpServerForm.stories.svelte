<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). McpServerForm builds its own OAuth
   * machine internally (../forms/oauthSignIn.svelte.ts, rendered by
   * ./McpOAuthPanel.svelte) and tracks host permission via a live `$effect`
   * (../forms/hostPermission.svelte.ts) — so every story seeds
   * `parameters.services.options`.
   *
   * Two of the three auth modes (bearer, oauth-already-connected) are
   * reachable via `initial`, mirroring "edit" mode. The third — choosing
   * "Sign in with OAuth" from a fresh add — is a real Select interaction
   * (bits-ui portals its listbox to `document.body`, same as
   * McpServerForm.test.ts's own `selectOption` helper documents at length),
   * which doubles as this card's portal check for a POPOVER rather than a
   * dialog: it renders and is clickable inside the Storybook iframe with no
   * workaround needed, unlike jsdom, which needs pointer-event polyfills the
   * test file carries. The sign-in/manual-panel/error states beyond that
   * reuse the same real-machine-transition technique as
   * McpOAuthPanel.stories.svelte.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import McpServerForm from "./McpServerForm.svelte";
  import type {
    McpAuthorizationServerInfo,
    McpOAuthAuth,
    McpServerConfig,
    McpSignInResult,
  } from "../../domain/tools";
  import { ok } from "../../domain/result";
  import type { OptionsServices } from "../app-services";
  import { m } from "../../paraglide/messages.js";

  function server(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
    return {
      id: "srv-1",
      name: "Internal ticket tracker",
      url: "https://mcp.example.com/mcp",
      enabled: true,
      transport: "auto",
      ...overrides,
    };
  }

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

  const DISCOVERY: McpAuthorizationServerInfo = {
    issuer: "https://github.com",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
  };

  const seedGranted = (services: OptionsServices): void => {
    services.permissions.has = async () => true;
    services.permissions.request = async () => true;
  };

  const seedNeverResolves = (services: OptionsServices): void => {
    seedGranted(services);
    services.mcpSignIn.begin = () => new Promise<McpSignInResult>(() => undefined);
  };

  const seedManualClientNeeded = (services: OptionsServices): void => {
    seedGranted(services);
    services.mcpSignIn.begin = async () => ({
      status: "needs-manual-client",
      discovery: DISCOVERY,
    });
  };

  const seedSignInFails = (services: OptionsServices): void => {
    seedGranted(services);
    services.mcpSignIn.begin = async () => ({
      status: "error",
      message: "The server rejected the authorization request.",
    });
  };

  /**
   * Opens the "Authentication" select and chooses "Sign in with OAuth" — the
   * listbox is a bits-ui floating-layer PORTAL appended to the iframe's own
   * `document.body`, not inside `canvasElement`, so the option is found via
   * the element's owner document rather than the canvas.
   *
   * Confirmed live in the Storybook iframe via Playwright while building this
   * story (not just inferred from the test file): a click straight after
   * closing the listbox intermittently fails with "pointer-events: none" on
   * `document.body` — bits-ui's scroll-lock releases on a REAL `setTimeout`
   * on close, same as McpServerForm.test.ts's own `afterEach` documents at
   * length for the equivalent jsdom race. Polling the real computed style
   * (rather than a fixed sleep, which was still flaky at 50ms in this same
   * iframe) is the real-browser side of that fix.
   */
  async function chooseOAuthMode(canvasElement: HTMLElement): Promise<void> {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: m.mcpServerForm_authModeLabel() }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByText(m.mcpServerForm_authOauthLabel()));
    await waitFor(() => {
      if (getComputedStyle(canvasElement.ownerDocument.body).pointerEvents === "none") {
        throw new Error("document.body is still pointer-events: none (bits-ui scroll-lock)");
      }
    });
  }

  const { Story } = defineMeta({
    title: "Options/McpServerForm",
    component: McpServerForm,
    tags: ["autodocs"],
    parameters: { services: { options: seedGranted } },
    args: { onSubmit: async () => ok(), onCancel: () => undefined },
  });
</script>

<Story name="Add — no auth" args={{ mode: "add" }} />

<Story
  name="Edit — bearer token"
  args={{ mode: "edit", initial: server({ auth: { type: "bearer", token: "sk-server-token" } }) }}
/>

<Story
  name="Edit — OAuth connected"
  args={{ mode: "edit", initial: server({ auth: fakeAuth({ expiresAt: Date.UTC(2026, 11, 1) }) }) }}
/>

<Story
  name="Edit — OAuth needs reconnect"
  args={{ mode: "edit", initial: server({ auth: fakeAuth({ expiresAt: Date.UTC(2020, 0, 1) }) }) }}
/>

<Story
  name="Choosing OAuth opens the sign-in panel"
  args={{ mode: "add" }}
  play={async ({ canvasElement }) => {
    await chooseOAuthMode(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.getByText(m.mcpServerForm_oauthSignInTitle())).toBeInTheDocument();
  }}
/>

<Story
  name="OAuth — signing in"
  args={{ mode: "add" }}
  parameters={{ services: { options: seedNeverResolves } }}
  play={async ({ canvasElement }) => {
    await chooseOAuthMode(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: m.mcpServerForm_signInAction() }));
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: m.mcpServerForm_signingInLabel() })).toBeInTheDocument(),
    );
  }}
/>

<Story
  name="OAuth — manual registration needed"
  args={{ mode: "add" }}
  parameters={{ services: { options: seedManualClientNeeded } }}
  play={async ({ canvasElement }) => {
    await chooseOAuthMode(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: m.mcpServerForm_signInAction() }));
    await waitFor(() =>
      expect(canvas.getByText(m.mcpServerForm_manualRegistrationTitle())).toBeInTheDocument(),
    );
  }}
/>

<Story
  name="OAuth — sign-in failed"
  args={{ mode: "add" }}
  parameters={{ services: { options: seedSignInFails } }}
  play={async ({ canvasElement }) => {
    await chooseOAuthMode(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: m.mcpServerForm_signInAction() }));
    await waitFor(() =>
      expect(canvas.getByText("The server rejected the authorization request.")).toBeInTheDocument(),
    );
  }}
/>
