<script lang="ts">
  // Options page shell (card 22; card 13 and card 39 add sibling sections
  // here — see the comment below). Chrome-native design tokens
  // (decisions/08-native-chrome-design-language.md) come from
  // src/lib/theme.css, wired in src/options/main.ts; layout/section
  // utility classes shared across sections live in src/options/options.css.
  import ProvidersSection from "./components/ProvidersSection.svelte";
  import SettingsSection from "./components/SettingsSection.svelte";
  import McpServersSection from "./components/McpServersSection.svelte";
  import HistorySection from "./components/HistorySection.svelte";
  import AttributionSection from "./components/AttributionSection.svelte";
</script>

<main class="page">
  <header class="page-header">
    <h1>OpenChat (WebMCP) — Options</h1>
    <p>Manage the chat providers the side panel connects through.</p>
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
