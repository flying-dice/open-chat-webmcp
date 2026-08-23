<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). McpOAuthPanel renders one
   * `OAuthSignInState` (../forms/oauthSignIn.svelte.ts, card 113's extracted
   * sign-in state machine) — it takes no services itself, but the machine's
   * own `signIn`/`continueManual`/`redirectUri` methods read
   * `optionsServices()` at call time. Three states (not connected, connected,
   * needs reconnect) are reachable straight from `createOAuthSignIn`'s
   * `initialAuth` — no interaction needed. The other three (signing in, the
   * manual-registration panel, a failed sign-in) are real MACHINE
   * transitions, not synthetic props: each story seeds `mcpSignIn.begin`
   * through `parameters.services.options` (the same seam every other
   * services-backed story uses) and a `play` function clicks the real
   * "Sign in" button, so what renders is the actual machine reacting to a
   * fake service answer — exactly the states oauthSignIn.svelte.test.ts
   * drives, reached through the UI instead of the machine's own API.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import McpOAuthPanel from "./McpOAuthPanel.svelte";
  import { createOAuthSignIn, type OAuthSignInState } from "../forms/oauthSignIn.svelte";
  import type { HostPermissionState } from "../forms/hostPermission.svelte";
  import type {
    McpAuthorizationServerInfo,
    McpOAuthAuth,
    McpSignInResult,
  } from "../../domain/tools";
  import type { OptionsServices } from "../app-services";
  import { m } from "../../paraglide/messages.js";

  function hostPermission(granted: boolean | undefined = true): HostPermissionState {
    return { granted };
  }

  function machine(initialAuth?: McpOAuthAuth): OAuthSignInState {
    return createOAuthSignIn({
      serverUrl: () => "https://mcp.example.com/mcp",
      hostPermission: hostPermission(),
      initialAuth,
    });
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

  /** A `begin` that never settles — clicking "Sign in" reaches `signingIn: true` and stays there, exactly like a real in-flight request. */
  const seedNeverResolves = (services: OptionsServices): void => {
    services.mcpSignIn.begin = () => new Promise<McpSignInResult>(() => undefined);
  };

  const seedManualClientNeeded = (services: OptionsServices): void => {
    services.mcpSignIn.begin = async () => ({
      status: "needs-manual-client",
      discovery: DISCOVERY,
    });
  };

  const seedSignInFails = (services: OptionsServices): void => {
    services.mcpSignIn.begin = async () => ({
      status: "error",
      message: "The server rejected the authorization request.",
    });
  };

  async function clickSignIn(canvasElement: HTMLElement): Promise<void> {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: m.mcpServerForm_signInAction() }));
  }

  const { Story } = defineMeta({
    title: "Options/McpOAuthPanel",
    component: McpOAuthPanel,
    tags: ["autodocs"],
  });
</script>

<Story name="Not connected" args={{ oauth: machine() }} />

<Story
  name="Connected, expires later"
  args={{ oauth: machine(fakeAuth({ expiresAt: Date.UTC(2026, 11, 1) })) }}
/>

<Story name="Connected, no expiry" args={{ oauth: machine(fakeAuth()) }} />

<Story
  name="Needs reconnect"
  args={{ oauth: machine(fakeAuth({ expiresAt: Date.UTC(2020, 0, 1) })) }}
/>

<Story
  name="Signing in"
  args={{ oauth: machine() }}
  parameters={{ services: { options: seedNeverResolves } }}
  play={async ({ canvasElement }) => {
    await clickSignIn(canvasElement);
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: m.mcpServerForm_signingInLabel() })).toBeInTheDocument(),
    );
  }}
/>

<!-- decisions/27, card 63: some authorization servers (GitHub's, notably)
     have no RFC 7591 registration endpoint and need a manually pre-registered
     app instead of dynamic client registration. -->
<Story
  name="Manual registration needed"
  args={{ oauth: machine() }}
  parameters={{ services: { options: seedManualClientNeeded } }}
  play={async ({ canvasElement }) => {
    await clickSignIn(canvasElement);
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByText(m.mcpServerForm_manualRegistrationTitle())).toBeInTheDocument(),
    );
  }}
/>

<Story
  name="Sign-in failed"
  args={{ oauth: machine() }}
  parameters={{ services: { options: seedSignInFails } }}
  play={async ({ canvasElement }) => {
    await clickSignIn(canvasElement);
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByText("The server rejected the authorization request.")).toBeInTheDocument(),
    );
  }}
/>
