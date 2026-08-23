<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). ProviderForm reads
   * `optionsServices().permissions` through `trackHostPermission` (a live
   * `$effect`), so every story seeds `parameters.services.options` even where
   * the story doesn't otherwise care about permissions — the same reset the
   * `withServices` decorator applies to every story either way.
   *
   * Covers: a hosted preset pre-filled (badge + docs link + API key
   * required), a LOCAL preset's "doesn't need an API key... Add one anyway"
   * escape hatch (a real `play` click, not a synthetic prop — card 125's own
   * wording for this state), an edit-mode masked API key, the blank-name
   * validation error (exactly ProviderForm.test.ts's own recipe — a genuinely
   * empty name never reaches `handleSubmit` at all, since the field also
   * carries HTML `required`), and the reserved-`Authorization`-header error
   * HeadersEditor renders inline for a stored header that collides with an
   * OpenAI provider's own API key auth.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, within } from "storybook/test";
  import ProviderForm from "./ProviderForm.svelte";
  import { PROVIDER_PRESETS, type ProviderConfig } from "../../domain/providers";
  import { ok } from "../../domain/result";
  import type { OptionsServices } from "../app-services";
  import { m } from "../../paraglide/messages.js";

  const GROQ_PRESET = PROVIDER_PRESETS.find((p) => p.id === "groq");
  if (!GROQ_PRESET)
    throw new Error("groq preset missing from the catalogue — story fixture is stale");

  // A LOCAL preset whose TYPE still needs an API key (`type: "openai"`) —
  // unlike the Ollama preset (`type: "ollama"`, which never shows the key
  // field at all, local or not), this is the actual branch "Add key anyway"
  // exists for: a local OpenAI-compatible runtime someone has put behind an
  // authenticated gateway.
  const LM_STUDIO_PRESET = PROVIDER_PRESETS.find((p) => p.id === "lmstudio");
  if (!LM_STUDIO_PRESET)
    throw new Error("lmstudio preset missing from the catalogue — story fixture is stale");

  const seedGranted = (services: OptionsServices): void => {
    services.permissions.has = async () => true;
    services.permissions.request = async () => true;
  };

  function editingConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
      id: "p1",
      type: "openai",
      name: "My OpenAI",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-not-a-real-key-0123456789",
      ...overrides,
    };
  }

  const { Story } = defineMeta({
    title: "Options/ProviderForm",
    component: ProviderForm,
    tags: ["autodocs"],
    parameters: { services: { options: seedGranted } },
    args: { onSubmit: async () => ok(), onCancel: () => undefined },
  });
</script>

<Story name="Add — hosted preset prefilled" args={{ mode: "add", preset: GROQ_PRESET }} />

<Story
  name="Add — local preset, Add key anyway"
  args={{ mode: "add", preset: LM_STUDIO_PRESET }}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByLabelText(m.providerForm_apiKeyLabel())).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: m.providerForm_addKeyAnywayAction() }));
    await expect(canvas.getByLabelText(m.providerForm_apiKeyLabel())).toBeInTheDocument();
  }}
/>

<Story name="Edit — masked API key" args={{ mode: "edit", initial: editingConfig() }} />

<Story
  name="Validation error — blank display name"
  args={{ mode: "add" }}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(m.displayNameLabel()), "   ");
    const urlInput = canvas.getByLabelText(m.providerForm_baseUrlLabel());
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, "http://localhost:11434");
    await userEvent.click(
      canvas.getByRole("button", { name: new RegExp(m.providers_addProviderAction()) }),
    );
    await expect(await canvas.findByText(m.enterDisplayNameError())).toBeInTheDocument();
  }}
/>

<Story
  name="Headers — reserved Authorization name"
  args={{
    mode: "edit",
    initial: editingConfig({
      headers: [{ key: "Authorization", value: "Bearer sk-should-not-be-set-here" }],
    }),
  }}
/>
