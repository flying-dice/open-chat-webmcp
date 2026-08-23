<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). Message list + autoscroll (card
   * 61, decisions/26). Transcript reads `approvals.pending`
   * (../stores/approvals.svelte) and `openOptionsPage`
   * (../stores/selection.svelte) directly — both are left at their real,
   * untouched defaults here (an empty pending queue; the real
   * `sidePanelServices().shell.openOptionsPage()` no-op against the fake
   * services story-services.ts already wires up), since none of the states
   * below need a pending approval card. Every other input is a plain prop.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Transcript from "./Transcript.svelte";
  import type { TranscriptEntry, TurnPhase } from "../../domain/chat";

  const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);

  function userMsg(id: string, content: string): TranscriptEntry {
    return { id, role: "user", content, createdAt: NOW };
  }

  function assistantMsg(
    id: string,
    content: string,
    extra: Partial<TranscriptEntry> = {},
  ): TranscriptEntry {
    return { id, role: "assistant", content, createdAt: NOW, ...extra };
  }

  function toolStep(
    id: string,
    toolName: string,
    extra: Partial<TranscriptEntry> = {},
  ): TranscriptEntry {
    return {
      id,
      role: "tool",
      content: "",
      createdAt: NOW,
      toolName,
      toolCallId: id,
      toolArgs: {},
      toolStatus: "pending",
      toolMode: "auto",
      toolOrigin: { kind: "page" },
      ...extra,
    };
  }

  const STREAMING_MESSAGES: TranscriptEntry[] = [
    userMsg("u1", "How do I fix the Ollama origin error?"),
    assistantMsg("a1", "You need to set the `OLLAMA_ORIGINS` environment vari"),
  ];
  const STREAMING_PHASE: TurnPhase = { kind: "streaming" };

  const NOTE_KIND_MESSAGES: TranscriptEntry[] = [
    userMsg("u1", "Keep going until you're done"),
    assistantMsg("n1", "", { note: { kind: "iteration-cap", limit: 8 } }),
    userMsg("u2", "Try again"),
    assistantMsg("n2", "", {
      note: {
        kind: "provider-error",
        error: {
          kind: "unreachable-or-cors",
          message: "network error",
          fix: {
            label: "Set OLLAMA_ORIGINS before starting the server",
            command: "OLLAMA_ORIGINS='chrome-extension://*' ollama serve",
          },
        },
      },
      actions: [{ kind: "retry" }],
    }),
  ];

  const LEGACY_PROSE_MESSAGES: TranscriptEntry[] = [
    userMsg("u1", "What happened there?"),
    assistantMsg("n1", "⚠️ Something went wrong ages ago.", {
      actions: [{ kind: "open-options", label: "Open options (stored label)" }],
    }),
  ];

  const ACTIVITY_GROUP_MESSAGES: TranscriptEntry[] = [
    userMsg("u1", "Read this page and submit the form"),
    toolStep("t1", "read_page_text", { toolStatus: "success", content: "Found the form." }),
    toolStep("t2", "submit_form"),
  ];
  const CALLING_PHASE: TurnPhase = {
    kind: "calling",
    toolName: "submit_form",
    origin: { kind: "page" },
    startedAt: Date.now() - 1500,
  };

  const { Story } = defineMeta({
    title: "Side panel/Transcript",
    component: Transcript,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: {
      messages: [],
      streamingMessageId: null,
      turnPhase: null,
      onRetry: () => undefined,
      modelLabel: "llama3.1",
    },
  });
</script>

<Story
  name="Streaming reply"
  args={{ messages: STREAMING_MESSAGES, streamingMessageId: "a1", turnPhase: STREAMING_PHASE }}
/>

<!-- Both note kinds render from a stored KIND, not stored prose (card 114) — the second one includes the copyable OLLAMA_ORIGINS fix block. -->
<Story name="Note kinds (iteration cap, provider error with fix)" args={{ messages: NOTE_KIND_MESSAGES }} />

<!-- Pre-release posture: an entry written before card 114 has English prose in `content` and no `note` — it renders exactly as recorded, nothing converted. -->
<Story name="Legacy prose passthrough" args={{ messages: LEGACY_PROSE_MESSAGES }} />

<Story
  name="Activity group, live and expanded"
  args={{ messages: ACTIVITY_GROUP_MESSAGES, turnPhase: CALLING_PHASE }}
/>

<Story name="Empty (no messages yet)" args={{ toolsNotice: "This page publishes no WebMCP tools." }} />

<Story name="At 320px" parameters={{ panelWidth: 320 }} args={{ messages: STREAMING_MESSAGES, streamingMessageId: "a1", turnPhase: STREAMING_PHASE }} />
