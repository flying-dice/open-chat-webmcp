<script lang="ts">
  // The "Custom headers (optional)" section of a registry form
  // (decisions/15-custom-headers-are-credentials.md) — the add/remove row
  // list, the per-row error, and the masked-by-default values with their
  // Show/Hide toggle.
  //
  // Card 81 extracted this from ProviderForm.svelte and McpServerForm.svelte,
  // which carried the same markup, the same row CRUD and the same
  // `showHeaderValues` toggle twice over; the row model and the validation
  // skeleton around each form's own reserved-name rule now live in
  // ../lib/headerRows.ts. Only two things ever actually differed between the
  // two copies and both are props: the introductory sentence (a provider's
  // headers and a server's are sent to different things, and the copy says
  // so) and the id given to the first name input, so each form's own
  // `<Field.Label for=...>` still targets a unique element.
  //
  // Header VALUES get the same treatment as an API key or a bearer token:
  // masked by default here, stored unencrypted and local-only by the
  // registries, never synced — each form carries its own storage warning
  // below its editor.
  import type { Snippet } from "svelte";
  import { untrack } from "svelte";
  import { headerRowError, type HeaderRow, type ReservedHeaderCheck } from "../lib/headerRows";
  import * as Alert from "$lib/components/ui/alert";
  import * as Field from "$lib/components/ui/field";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";

  interface Props {
    /** The rows being edited — bound, since adding and removing a row replaces the array the owning form later reads back to build its config. */
    rows: HeaderRow[];
    /** The owning form's reserved-name rule (its bounded context's, evaluated against its own auth state) — see ../lib/headerRows.ts. */
    isReserved: ReservedHeaderCheck;
    /** Id for the first row's name input, so the form's `<Field.Label for=...>` targets it. Must be unique on the page. */
    firstInputId: string;
    /** What these headers are sent to, in the form's own words. */
    description: Snippet;
  }

  let { rows = $bindable(), isReserved, firstInputId, description }: Props = $props();

  // Ids only need to be unique within this editor and never leave it, so a
  // counter past the highest seeded id is enough. Snapshotted once at mount —
  // it is a cursor, not reactive state.
  let nextRowId = untrack(() => rows.reduce((max, row) => Math.max(max, row.id), -1) + 1);

  let showValues = $state(false);

  function addRow(): void {
    rows = [...rows, { id: nextRowId++, key: "", value: "" }];
  }

  function removeRow(id: number): void {
    rows = rows.filter((row) => row.id !== id);
  }
</script>

<Field.Field>
  <Field.Label for={firstInputId}>Custom headers (optional)</Field.Label>
  <Alert.Root class="bg-background">
    <Alert.Description>{@render description()}</Alert.Description>
  </Alert.Root>

  {#if rows.length > 0}
    <div class="flex flex-col gap-1">
      {#each rows as row, i (row.id)}
        {@const err = headerRowError(row, rows, isReserved)}
        <div class="flex items-start gap-1">
          <Input
            id={i === 0 ? firstInputId : undefined}
            type="text"
            bind:value={row.key}
            placeholder="Header name, e.g. x-api-key"
            autocomplete="off"
            aria-invalid={err ? "true" : undefined}
          />
          <Input
            type={showValues ? "text" : "password"}
            bind:value={row.value}
            placeholder="Value"
            autocomplete="off"
            aria-invalid={err ? "true" : undefined}
          />
          <Button
            variant="ghost"
            size="icon"
            onclick={() => removeRow(row.id)}
            aria-label={`Remove header ${row.key || i + 1}`}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          </Button>
        </div>
        {#if err}
          <Field.Error>{err}</Field.Error>
        {/if}
      {/each}
    </div>
  {/if}

  <div class="flex items-center gap-2">
    <Button variant="ghost" size="sm" onclick={addRow}>
      <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
      Add header
    </Button>
    {#if rows.length > 0}
      <Button variant="ghost" size="sm" onclick={() => (showValues = !showValues)}>
        {showValues ? "Hide values" : "Show values"}
      </Button>
    {/if}
  </div>
</Field.Field>
