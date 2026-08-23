<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). Purely presentational — storage,
   * capability-loading and the test-connection flow all live in the parent
   * (see the component's own header comment), so every story here is plain
   * props, no services. Covers the backend badge (from a real preset via
   * `getPreset`), the default/stale-default badge pair, the blocked-default
   * reason, and a test outcome with its copyable fix command.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ProviderRow from "./ProviderRow.svelte";
  import type { ProviderConfig, ProviderModel } from "../../domain/providers";
  import type { ProviderTestOutcome } from "../forms/providerTestConnection";

  function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
      id: "p1",
      type: "openai",
      name: "My Groq",
      baseUrl: "https://api.groq.com/openai",
      presetId: "groq",
      ...overrides,
    };
  }

  const MODELS: ProviderModel[] = [
    { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    { id: "qwen-2.5-32b", name: "Qwen 2.5 32B" },
  ];

  const UNREACHABLE: ProviderTestOutcome = {
    kind: "unreachable",
    message: "Couldn't reach http://localhost:11434 — is Ollama running?",
    fix: { label: "Allow this extension's origin", command: "OLLAMA_ORIGINS=* ollama serve" },
  };

  const { Story } = defineMeta({
    title: "Options/ProviderRow",
    component: ProviderRow,
    tags: ["autodocs"],
    args: {
      isFirst: false,
      isLast: false,
      permissionGranted: true,
      testOutcome: undefined,
      testing: false,
      defaultModelsLoading: false,
      defaultModelOptions: MODELS,
      defaultModelBlockedReason: undefined,
      defaultInvalidReason: undefined,
      onEdit: () => undefined,
      onRemove: () => undefined,
      onMoveUp: () => undefined,
      onMoveDown: () => undefined,
      onSetDefault: () => undefined,
      onTest: () => undefined,
    },
  });
</script>

<Story name="Not the default" args={{ provider: provider(), isDefault: false }} />

<Story name="Default" args={{ provider: provider(), isDefault: true }} />

<Story
  name="Default, stale (needs attention)"
  args={{
    provider: provider(),
    isDefault: true,
    defaultInvalidReason: "This provider no longer offers a tool-capable model.",
  }}
/>

<Story
  name="Local preset, no tool-capable models yet"
  args={{
    provider: provider({ type: "ollama", presetId: "ollama", baseUrl: "http://localhost:11434", name: "Local Ollama" }),
    isDefault: false,
    defaultModelOptions: [],
    defaultModelBlockedReason: "No tool-capable models pulled yet.",
  }}
/>

<Story
  name="Checking models"
  args={{ provider: provider(), isDefault: false, defaultModelsLoading: true, defaultModelOptions: [] }}
/>

<Story
  name="Test failed, with a copyable fix"
  args={{
    provider: provider({ type: "ollama", presetId: "ollama", baseUrl: "http://localhost:11434", name: "Local Ollama" }),
    isDefault: false,
    testOutcome: UNREACHABLE,
  }}
/>
