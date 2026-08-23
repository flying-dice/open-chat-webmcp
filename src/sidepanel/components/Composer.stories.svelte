<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The composer (card 07/60,
   * decisions/18) — the send/stop swap plus card 35's four `blocked` empty
   * states, all derived from `../stores/selection.svelte`'s module state.
   *
   * Same seam as ModelPicker.stories.svelte: `setSelectionStateForTesting`
   * (added to selection.svelte.ts by this card) sets the exact state
   * Composer's `blocked` derivation reads, since the only production path
   * that ever populates it (`syncToTab`) is async and Storybook has no
   * per-story `vi.mock` equivalent to fall back on. See that function's doc
   * comment, and ModelPicker.stories.svelte's header, for the full story.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Composer from "./Composer.svelte";
  import {
    setSelectionStateForTesting,
    EMPTY_SELECTION_STATE,
    type SelectionStateSnapshot,
  } from "../stores/selection.svelte";
  import type { ProviderConfig } from "../../domain/providers";
  import type { SidePanelServices } from "../app-services";

  const OLLAMA: ProviderConfig = {
    id: "ollama-local",
    type: "ollama",
    name: "Local Ollama",
    baseUrl: "http://localhost:11434",
  };

  const seedReady = (_services: SidePanelServices): void => {
    setSelectionStateForTesting({
      ...EMPTY_SELECTION_STATE,
      providers: [OLLAMA],
      resolution: { status: "ok", config: OLLAMA, model: "llama3.1" },
      selectionExplicit: true,
    });
  };

  const seedNoProviders = (_services: SidePanelServices): void => {
    setSelectionStateForTesting({ ...EMPTY_SELECTION_STATE });
  };

  const seedProvidersLoading = (_services: SidePanelServices): void => {
    setSelectionStateForTesting({ ...EMPTY_SELECTION_STATE, providersStatus: "loading" });
  };

  const seedProvidersError = (_services: SidePanelServices): void => {
    setSelectionStateForTesting({ ...EMPTY_SELECTION_STATE, providersStatus: "error" });
  };

  const seedUnselected = (_services: SidePanelServices): void => {
    setSelectionStateForTesting({ ...EMPTY_SELECTION_STATE, providers: [OLLAMA] });
  };

  const seedDangling = (_services: SidePanelServices): void => {
    setSelectionStateForTesting({
      ...EMPTY_SELECTION_STATE,
      providers: [OLLAMA],
      resolution: { status: "dangling", providerId: "deleted-provider", model: "llama3.1" },
    });
  };

  const seedNeedsConfirmation = (_services: SidePanelServices): void => {
    setSelectionStateForTesting({
      ...EMPTY_SELECTION_STATE,
      providers: [OLLAMA],
      resolution: { status: "ok", config: OLLAMA, model: "llama3.1" },
      selectionExplicit: false,
    });
  };

  const { Story } = defineMeta({
    title: "Side panel/Composer",
    component: Composer,
    tags: ["autodocs"],
    parameters: { panelWidth: 400, services: { sidepanel: seedReady } },
    args: { busy: false, onSend: () => undefined, onStop: () => undefined },
  });
</script>

<Story name="Ready to send" />

<Story name="Busy (streaming/tool round in flight)" args={{ busy: true }} />

<Story name="Blocked: no providers registered" parameters={{ services: { sidepanel: seedNoProviders } }} />

<Story name="Blocked: providers loading" parameters={{ services: { sidepanel: seedProvidersLoading } }} />

<Story name="Blocked: provider list failed to load" parameters={{ services: { sidepanel: seedProvidersError } }} />

<Story name="Blocked: no model selected yet" parameters={{ services: { sidepanel: seedUnselected } }} />

<Story name="Blocked: selected provider was deleted" parameters={{ services: { sidepanel: seedDangling } }} />

<Story
  name="Blocked: needs one-click confirmation"
  parameters={{ services: { sidepanel: seedNeedsConfirmation } }}
/>

<Story name="At 320px" parameters={{ panelWidth: 320, services: { sidepanel: seedReady } }} />
