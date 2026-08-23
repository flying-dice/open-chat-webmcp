<script module lang="ts">
  /**
   * Card 124 (decisions/42-storybook.md). The blocking approve/deny card
   * (card 09, decisions/05). Takes `request: PendingApproval` entirely as a
   * prop — it never reads app-services OR any store beyond
   * `approve`/`deny`'s side effects (../stores/approvals.svelte), so unlike
   * Composer/ModelPicker/Transcript this needs no seam at all: clicking
   * Approve/Deny in the canvas calls the REAL exported functions, which
   * no-op harmlessly against a request this module's own singleton queue
   * never actually enqueued (see approvals.svelte.ts's `settle` — nothing to
   * resolve, so it returns early).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ApprovalCard from "./ApprovalCard.svelte";
  import type { PendingApproval } from "../stores/approvals.svelte";

  const PAGE_REQUEST: PendingApproval = {
    id: "req-1",
    call: { id: "call-1", name: "delete_all_items", arguments: { confirm: true } },
    tool: {
      name: "delete_all_items",
      description: "Deletes every item in the current list.",
      annotations: {},
      origin: { kind: "page" },
      call: async () => ({ ok: true, result: undefined }),
    },
    skip: { kind: "page", key: "https://example.com::delete_all_items" },
  };

  const SERVER_REQUEST: PendingApproval = {
    id: "req-2",
    call: { id: "call-2", name: "acme__run_query", arguments: { query: "SELECT * FROM orders" } },
    tool: {
      name: "acme__run_query",
      description: "Runs a SQL query against the Acme warehouse.",
      annotations: { untrustedContentHint: true },
      mcpAnnotations: { destructiveHint: true },
      origin: { kind: "server", serverId: "acme", serverName: "Acme" },
      call: async () => ({ ok: true, result: undefined }),
    },
    skip: { kind: "server", key: "acme::acme__run_query" },
  };

  const UNKNOWN_TOOL_REQUEST: PendingApproval = {
    id: "req-3",
    call: { id: "call-3", name: "vanished_tool", arguments: {} },
    tool: undefined,
    skip: undefined,
  };

  const { Story } = defineMeta({
    title: "Side panel/ApprovalCard",
    component: ApprovalCard,
    tags: ["autodocs"],
    parameters: { panelWidth: 400 },
    args: { request: PAGE_REQUEST },
  });
</script>

<Story name="Pending page tool" />

<Story name="Pending server tool (destructive)" args={{ request: SERVER_REQUEST }} />

<Story name="Origin unknown (hallucinated tool name)" args={{ request: UNKNOWN_TOOL_REQUEST }} />
