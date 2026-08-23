<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The composer's flat model picker
   * (card 51, decisions/22). Takes NO props at all — every input comes from
   * `../stores/selection.svelte`'s module-singleton state, populated in
   * production only by `syncToTab`, an async function driven through several
   * awaited `sidePanelServices()` calls (see that module's own doc comment).
   *
   * ModelPicker.test.ts/Composer.test.ts drive their components by
   * `vi.mock`-ing that whole module — one module graph per test FILE.
   * Storybook is one module graph for the WHOLE session (decisions/42), so
   * there is no per-story mock to reach for. Per card 123's guidance this
   * seeds the STORE directly instead, through
   * `setSelectionStateForTesting` — a real, exported, typed seam added to
   * selection.svelte.ts by this card (see that function's doc comment for
   * why a direct-state seam beats replaying the async `syncToTab` path for a
   * static story), rather than inventing a story-only double of the module.
   *
   * `pickerOpen: true` is part of every snapshot below so the popover
   * content actually mounts without a click first.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ModelPicker from "./ModelPicker.svelte";
  import {
    setSelectionStateForTesting,
    EMPTY_SELECTION_STATE,
    type SelectionStateSnapshot,
  } from "../stores/selection.svelte";
  import type { ModelCapabilities, ProviderConfig } from "../../domain/providers";
  import type { ModelListEntry } from "../stores/selection.svelte";
  import type { SidePanelServices } from "../app-services";

  const TOOL_CAPABLE: ModelCapabilities = { status: "tool-capable" };
  const UNKNOWN: ModelCapabilities = { status: "unknown", detail: ["Capability check timed out."] };
  const NO_TOOLS: ModelCapabilities = {
    status: "no-tools",
    detail: ["No function-calling on this model."],
  };

  const OLLAMA: ProviderConfig = {
    id: "ollama-local",
    type: "ollama",
    name: "Local Ollama",
    baseUrl: "http://localhost:11434",
  };
  const OPENAI_DOWN: ProviderConfig = {
    id: "openai-remote",
    type: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
  };
  const CUSTOM_HOST: ProviderConfig = {
    id: "custom-host",
    type: "openai",
    name: "Self-hosted",
    baseUrl: "https://models.internal.example.com",
  };

  function entry(id: string, capability: ModelCapabilities): ModelListEntry {
    return { model: { id, name: id }, capability };
  }

  const seedGrouped = (_services: SidePanelServices): void => {
    const snapshot: SelectionStateSnapshot = {
      ...EMPTY_SELECTION_STATE,
      providers: [OLLAMA],
      resolution: { status: "ok", config: OLLAMA, model: "llama3.1" },
      selectionExplicit: true,
      pickerOpen: true,
      modelsByProvider: {
        [OLLAMA.id]: {
          status: "loaded",
          entries: [
            entry("llama3.1", TOOL_CAPABLE),
            entry("mystery-model", UNKNOWN),
            entry("tinyllama", NO_TOOLS),
          ],
        },
      },
    };
    setSelectionStateForTesting(snapshot);
  };

  const seedDegradedProvider = (_services: SidePanelServices): void => {
    const snapshot: SelectionStateSnapshot = {
      ...EMPTY_SELECTION_STATE,
      providers: [OPENAI_DOWN],
      pickerOpen: true,
      modelsByProvider: {
        [OPENAI_DOWN.id]: {
          status: "error",
          message: "Couldn't reach OpenAI: the request was blocked (likely a CORS/network issue).",
          error: {
            kind: "unreachable-or-cors",
            message: "network error",
            fix: {
              label: "Grant a host permission on the options page",
              command: "https://api.openai.com/*",
            },
          },
        },
      },
    };
    setSelectionStateForTesting(snapshot);
  };

  const seedManualEntry = (_services: SidePanelServices): void => {
    const snapshot: SelectionStateSnapshot = {
      ...EMPTY_SELECTION_STATE,
      providers: [CUSTOM_HOST],
      pickerOpen: true,
      modelsByProvider: {
        [CUSTOM_HOST.id]: {
          status: "not-supported",
          message: "This provider doesn't support listing models — enter one manually.",
          manualEntry: undefined,
        },
      },
    };
    setSelectionStateForTesting(snapshot);
  };

  const { Story } = defineMeta({
    title: "Side panel/ModelPicker",
    component: ModelPicker,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
  });
</script>

<Story name="Grouped (selectable, unverified, no-tools)" parameters={{ services: { sidepanel: seedGrouped } }} />

<Story name="Degraded provider (connection error, copyable fix)" parameters={{ services: { sidepanel: seedDegradedProvider } }} />

<Story name="Manual entry (no listing API)" parameters={{ services: { sidepanel: seedManualEntry } }} />
