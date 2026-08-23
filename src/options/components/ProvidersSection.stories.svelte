<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). ProvidersSection reads
   * `optionsServices().providers`/`.createProviderClient`/`.permissions` from
   * `onMount` — every story seeds `parameters.services.options`. Covers rows
   * + badges (default/backend), a test-connection outcome reached through a
   * real `play` click (not a synthetic outcome prop — this section has no
   * such prop, `gate.outcomes` is internal), and card 41's fourth checklist
   * item: the STALE-DEFAULT banner for a stored default whose provider was
   * since removed (decisions/97-stale-default-model-banner's `dangling`
   * resolution).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import ProvidersSection from "./ProvidersSection.svelte";
  import type { ProviderConfig, ProviderModel } from "../../domain/providers";
  import { ok } from "../../domain/result";
  import type { OptionsServices } from "../app-services";
  import {
    createFakeProviderClientFactory,
    createFakeProviderRegistry,
  } from "../testing/fake-services";
  import { m } from "../../paraglide/messages.js";

  const OLLAMA_PROVIDER: ProviderConfig = {
    id: "prov-ollama",
    type: "ollama",
    name: "Local Ollama",
    baseUrl: "http://localhost:11434",
    presetId: "ollama",
  };

  const GROQ_PROVIDER: ProviderConfig = {
    id: "prov-groq",
    type: "openai",
    name: "My Groq",
    baseUrl: "https://api.groq.com/openai",
    presetId: "groq",
    apiKey: "sk-not-a-real-key",
  };

  const TOOL_CAPABLE_MODELS: ProviderModel[] = [
    { id: "llama3.3", name: "llama3.3" },
    { id: "qwen2.5", name: "qwen2.5" },
  ];

  /** Every provider answers with two tool-capable models — the default factory's `chat()` stub is reused verbatim, only `listModels`/`getCapabilities` are overridden. */
  function toolCapableClientFactory(): OptionsServices["createProviderClient"] {
    const base = createFakeProviderClientFactory();
    return (config) => ({
      ...base(config),
      listModels: async () => ok(TOOL_CAPABLE_MODELS),
      getCapabilities: async () => ok({ status: "tool-capable" as const }),
    });
  }

  const seedGranted = (services: OptionsServices): void => {
    services.permissions.has = async () => true;
    services.permissions.request = async () => true;
    services.createProviderClient = toolCapableClientFactory();
  };

  const seedTwoProviders = (services: OptionsServices): void => {
    seedGranted(services);
    services.providers = createFakeProviderRegistry([OLLAMA_PROVIDER, GROQ_PROVIDER], {
      getDefaultSelection: async () => ok({ providerId: OLLAMA_PROVIDER.id, model: "llama3.3" }),
    });
  };

  const seedStaleDefault = (services: OptionsServices): void => {
    seedGranted(services);
    services.providers = createFakeProviderRegistry([GROQ_PROVIDER], {
      // Points at a provider that no longer exists — decisions/41's fourth
      // checklist item, reached via `resolveSelection`'s "dangling" status.
      getDefaultSelection: async () => ok({ providerId: "prov-deleted", model: "some-model" }),
    });
  };

  const seedOneProvider = (services: OptionsServices): void => {
    seedGranted(services);
    services.providers = createFakeProviderRegistry([GROQ_PROVIDER]);
  };

  const { Story } = defineMeta({
    title: "Options/ProvidersSection",
    component: ProvidersSection,
    tags: ["autodocs"],
    parameters: { services: { options: seedGranted } },
  });
</script>

<Story name="Seeded — default + non-default" parameters={{ services: { options: seedTwoProviders } }} />

<Story name="Stale default banner" parameters={{ services: { options: seedStaleDefault } }} />

<Story name="No providers yet" />

<Story
  name="Test connection succeeded"
  parameters={{ services: { options: seedOneProvider } }}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const testButton = await canvas.findByRole("button", { name: m.testConnectionAction() });
    await userEvent.click(testButton);
    await waitFor(() =>
      expect(
        canvas.getByText(m.testResultDisplay_providerSuccess({ count: TOOL_CAPABLE_MODELS.length })),
      ).toBeInTheDocument(),
    );
  }}
/>
