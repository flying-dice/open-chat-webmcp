<!--
  Fixture ONLY for src/ui/__tests__/smoke.test.ts (card 82) — proves the
  jsdom Vitest project can compile and mount a real Svelte 5 component
  (runes, props) through @testing-library/svelte before card 84 writes
  actual component tests against it. Not part of the shared UI kit; nothing
  else imports this file.
-->
<script lang="ts">
  let { name }: { name: string } = $props();
</script>

<p>Hello, {name}!</p>
