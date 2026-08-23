<script module lang="ts">
  /**
   * Card 125 (decisions/42-storybook.md). Both approval-policy groups read
   * `optionsServices().settings` from `onMount`, so every story seeds
   * `parameters.services.options`. The interface-language section reads
   * Paraglide directly (not a service — see the component's own header
   * comment on why that's deliberate), so the locale toolbar axis already
   * exercises it in every story without any seed of its own.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, waitFor, within } from "storybook/test";
  import SettingsSection from "./SettingsSection.svelte";
  import { fail, ok } from "../../domain/result";
  import type { OptionsServices } from "../app-services";
  import { storageFailure } from "../testing/fake-services";
  import { storageFailureMessage } from "../../ui/storageMessage";
  import { m } from "../../paraglide/messages.js";

  const seedTrustReadOnly = (services: OptionsServices): void => {
    services.settings.getMcpApprovalPolicy = async () => ok("trust-read-only");
  };

  const seedAutoRunAll = (services: OptionsServices): void => {
    services.settings.getApprovalPolicy = async () => ok("auto-run-all");
  };

  const READ_FAILURE = storageFailure();
  const seedReadFailure = (services: OptionsServices): void => {
    services.settings.getApprovalPolicy = async () => fail(READ_FAILURE);
  };

  const { Story } = defineMeta({
    title: "Options/SettingsSection",
    component: SettingsSection,
    tags: ["autodocs"],
  });
</script>

<Story name="Defaults" />

<Story name="Auto-run everything (page tools)" parameters={{ services: { options: seedAutoRunAll } }} />

<Story name="Trust read-only (MCP tools)" parameters={{ services: { options: seedTrustReadOnly } }} />

<Story
  name="Policy read failed"
  parameters={{ services: { options: seedReadFailure } }}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const expected = storageFailureMessage(m.settingsSection_readPolicyFailedWhat(), READ_FAILURE);
    await waitFor(() => expect(canvas.getByText(expected)).toBeInTheDocument());
  }}
/>
