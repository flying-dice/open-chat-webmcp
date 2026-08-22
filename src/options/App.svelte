<script lang="ts">
  // Options page shell (card 22; card 13 and card 39 add sibling sections
  // here — see the comment below). Card 71 migrated this whole page to
  // shadcn-svelte components + Tailwind utilities
  // (decisions/28-shadcn-svelte-maia-zinc.md): the page-level layout that
  // used to live in options.css's `.page`/`.page-header` is now the utility
  // classes below, and every section renders inside a shadcn `Card`.
  import ProvidersSection from "./components/ProvidersSection.svelte";
  import SettingsSection from "./components/SettingsSection.svelte";
  import McpServersSection from "./components/McpServersSection.svelte";
  import HistorySection from "./components/HistorySection.svelte";
  import AttributionSection from "./components/AttributionSection.svelte";
</script>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 pb-10">
  <header class="flex flex-col gap-1">
    <h1 class="text-2xl leading-tight font-semibold tracking-tight">
      OpenChat (WebMCP) — Options
    </h1>
    <p class="text-sm text-muted-foreground">
      Manage the chat providers the side panel connects through.
    </p>
  </header>

  <!-- Order is configuration first, stored data last: the connections you
       set up (providers, MCP servers) and the policies governing them, then
       the history they produced. Chat history sits at the bottom because it
       is the one section that only ever deletes things. -->
  <ProvidersSection />

  <SettingsSection />

  <McpServersSection />

  <HistorySection />

  <!-- Static, not a setting: comes last because it's about-the-product
       content rather than anything the user configures. -->
  <AttributionSection />
</main>
