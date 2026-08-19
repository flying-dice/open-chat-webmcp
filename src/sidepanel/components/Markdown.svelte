<script lang="ts">
  import { renderMarkdown } from "../../lib/markdown";

  /**
   * Renders a markdown string as sanitised HTML.
   *
   * Safe to call on every token of a streaming assistant reply: `source`
   * can be partial/incomplete markdown (an unclosed fence, a dangling
   * `**`, a half-typed link) at any point and this component re-renders
   * reactively without throwing or flickering between block types. See
   * src/lib/markdown.ts for the streaming-tolerance and sanitisation
   * design (marked -> DOMPurify, strict allowlist, no raw HTML
   * passthrough).
   *
   * Props:
   *   source - the (possibly incomplete) markdown text to render. Required.
   *   class  - optional extra class name(s) merged onto the root element.
   *
   * Output already includes: fenced code blocks with a copy-to-clipboard
   * button, links forced to target="_blank" rel="noopener noreferrer",
   * and JSON code blocks (``` json or bare `{...}`/`[...]`) pretty-printed
   * when they parse.
   */
  interface Props {
    source: string;
    class?: string;
  }

  let { source, class: extraClass = "" }: Props = $props();

  let html = $derived(renderMarkdown(source));

  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  function handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-copy-button]");
    if (!button) return;

    const block = button.closest("[data-code-block]");
    const codeEl = block?.querySelector("code");
    const text = codeEl?.textContent ?? "";

    navigator.clipboard
      .writeText(text)
      .then(() => {
        const original = button.textContent;
        button.textContent = "Copied";
        button.disabled = true;
        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => {
          button.textContent = original;
          button.disabled = false;
        }, 1500);
      })
      .catch(() => {
        // Clipboard access can be denied (permissions, insecure context) —
        // fail silently rather than throwing inside a click handler.
      });
  }
</script>

<!-- Click handler only delegates to the native <button>/<a> elements the
     sanitised markup already contains (copy buttons, links); those carry
     their own keyboard semantics, so there's nothing extra for this
     wrapper to expose. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="markdown-body {extraClass}" onclick={handleClick}>
  {@html html}
</div>

<style>
  /*
   * All colour/spacing/radius/motion values come from src/lib/theme.css —
   * see decisions/08-native-chrome-design-language.md. This block only
   * adds the element styling theme.css doesn't already cover (it styles
   * p/h1-h3/hr globally, which already apply to this component's {@html}
   * output for free).
   *
   * Content is injected via {@html}, so descendant rules below must use
   * :global() — Svelte's scoping class isn't attached to dynamically
   * injected markup, only to elements the compiler sees statically.
   */

  .markdown-body {
    overflow-wrap: anywhere;
    word-break: break-word;
    min-width: 0;
  }

  .markdown-body :global(a) {
    color: var(--color-primary);
    text-decoration: underline;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin: 0 0 var(--space-2) 0;
    padding-left: var(--space-4);
  }

  .markdown-body :global(li) {
    margin: 0 0 var(--space-1) 0;
  }

  .markdown-body :global(li:last-child) {
    margin-bottom: 0;
  }

  .markdown-body :global(blockquote) {
    margin: 0 0 var(--space-2) 0;
    padding: var(--space-1) var(--space-3);
    border-left: 3px solid var(--color-outline);
    color: var(--color-on-surface-variant);
  }

  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--font-size-heading);
    line-height: var(--line-height-heading);
    font-weight: 600;
    color: var(--color-on-surface);
  }

  .markdown-body :global(p:last-child) {
    margin-bottom: 0;
  }

  /* Inline code */
  .markdown-body :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--font-size-small);
    background: var(--color-surface-container);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-1);
    overflow-wrap: anywhere;
  }

  /* Fenced code block wrapper (built in src/lib/markdown.ts renderCodeBlock) */
  .markdown-body :global(.md-code) {
    margin: 0 0 var(--space-2) 0;
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-card);
    overflow: hidden;
    background: var(--color-surface-container);
  }

  .markdown-body :global(.md-code-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--color-outline-variant);
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
  }

  .markdown-body :global(.md-code-lang) {
    text-transform: uppercase;
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .markdown-body :global(.md-copy-btn) {
    flex: 0 0 auto;
    font-size: var(--font-size-small);
    line-height: 1.6;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--color-surface);
    border: 1px solid var(--color-outline);
    cursor: pointer;
    transition:
      background-color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .markdown-body :global(.md-copy-btn:hover) {
    background: var(--color-surface-container-high);
  }

  .markdown-body :global(.md-code pre) {
    margin: 0;
    padding: var(--space-2);
    overflow-x: auto;
    background: transparent;
  }

  .markdown-body :global(.md-code pre code) {
    display: block;
    background: transparent;
    padding: 0;
    border-radius: 0;
    white-space: pre;
  }

  .markdown-body :global(table) {
    display: block;
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    margin: 0 0 var(--space-2) 0;
    font-size: var(--font-size-small);
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--color-outline);
    padding: var(--space-1) var(--space-2);
    text-align: left;
  }

  .markdown-body :global(th) {
    background: var(--color-surface-container);
    font-weight: 600;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--color-outline);
    margin: var(--space-2) 0;
  }
</style>
