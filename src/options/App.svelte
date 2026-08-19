<script lang="ts">
  // Options page shell (card 22; card 13 adds a sibling section here later
  // — see the comment below). Chrome-native design tokens
  // (decisions/08-native-chrome-design-language.md) come from
  // src/lib/theme.css, wired in src/options/main.ts; layout/section
  // utility classes shared across sections live in src/options/options.css.
  import ProvidersSection from "./components/ProvidersSection.svelte";
  import SettingsSection from "./components/SettingsSection.svelte";
</script>

<main class="page">
  <header class="page-header">
    <h1>OpenChat (WebMCP) — Options</h1>
    <p>Manage the chat providers the side panel connects through.</p>
  </header>

  <ProvidersSection />

  <SettingsSection />
</main>
