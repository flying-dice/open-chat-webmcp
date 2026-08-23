<script module lang="ts">
  /**
   * Proof story 3 of card 123 (decisions/42-storybook.md): the SHARED UI
   * layer's one component, used by both surfaces.
   *
   * Markdown is the component whose look is hardest to judge from a test —
   * it renders sanitised HTML through `{@html}` and styles it with a scoped
   * `<style>` block reading shadcn's own tokens (see the component's header
   * for why that is the one allowed exception to "Tailwind utilities only").
   * That makes it precisely the thing Storybook is for: a code block with its
   * copy button, a table, a list and a blockquote, side by side, in both
   * themes, without launching Chrome.
   *
   * The streaming story is not decoration either: `source` is expected to be
   * INCOMPLETE markdown on every token of an assistant reply, and the
   * unclosed fence below is what proves the renderer does not flicker between
   * block types on the way there.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Markdown from "./Markdown.svelte";

  const SAMPLE = `## Fixing the Ollama origin

Chrome extensions send an \`Origin\` header that Ollama rejects by default.
Set **OLLAMA_ORIGINS** before starting the server:

\`\`\`bash
OLLAMA_ORIGINS='chrome-extension://*' ollama serve
\`\`\`

The tool call that failed came back as:

\`\`\`json
{"error":"403 Forbidden","hint":"origin not allowed"}
\`\`\`

Checklist:

1. Stop the running server
2. Export the variable
3. Restart, then [re-test the connection](https://localhost:11434)

> If it still fails, the server is probably bound to a different port.

| Setting | Value |
| --- | --- |
| Host | \`127.0.0.1\` |
| Port | \`11434\` |
`;

  /** Mid-stream: an unclosed fence and a dangling bold marker, exactly as a token boundary leaves them. */
  const STREAMING = `Here is what I found on the page:

- The form posts to \`/api/signup\`
- It has **three required fi`;

  const { Story } = defineMeta({
    title: "Shared UI/Markdown",
    component: Markdown,
    tags: ["autodocs"],
    args: { source: SAMPLE },
  });
</script>

<Story name="Rendered sample" />

<Story name="Mid-stream (incomplete markdown)" args={{ source: STREAMING }} />

<!-- The same content in a 320px side panel, where the code block and the table have to scroll rather than push the layout. -->
<Story name="In a 320px panel" parameters={{ panelWidth: 320 }} />
