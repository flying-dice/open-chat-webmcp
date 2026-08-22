<script lang="ts">
  import { renderMarkdown } from "../markdown";

  /**
   * Renders a markdown string as sanitised HTML.
   *
   * Safe to call on every token of a streaming assistant reply: `source`
   * can be partial/incomplete markdown (an unclosed fence, a dangling
   * `**`, a half-typed link) at any point and this component re-renders
   * reactively without throwing or flickering between block types. See
   * src/ui/markdown.ts for the streaming-tolerance and sanitisation
   * design (marked -> DOMPurify, strict allowlist, no raw HTML
   * passthrough).
   *
   * Lives in src/lib/components (not src/sidepanel/components, where it
   * originated with card 14) because it's used by both the side panel
   * (streaming transcript, ProviderPicker's copyable fixes/commands) and
   * the options page (card 33's copyable OLLAMA_ORIGINS fix in
   * ProviderForm.svelte/ProviderRow.svelte) — a presentational component
   * with no dependency on either app's own state, so it belongs in the
   * shared tree rather than being cross-imported out of one app into the
   * other.
   *
   * Props:
   *   source - the (possibly incomplete) markdown text to render. Required.
   *   class  - optional extra class name(s) merged onto the root element.
   *
   * Output already includes: fenced code blocks with a copy-to-clipboard
   * button, links forced to target="_blank" rel="noopener noreferrer",
   * and JSON code blocks (``` json or bare `{...}`/`[...]`) pretty-printed
   * when they parse.
   *
   * Card 67 (decisions/28-shadcn-svelte-maia-zinc.md): restyled with
   * Tailwind. The root element's own layout is plain utility classes; the
   * element styling below it stays a small scoped style block — the
   * decision's explicitly-allowed exception for this component, since
   * content arrives via the @html directive and Tailwind utility classes
   * can't reach into sanitised innerHTML the compiler never sees. Every
   * rule below reads shadcn's own Zinc tokens (src/app.css: --foreground,
   * --muted-foreground, --primary, --border, --muted, --background,
   * --radius-*) rather than the legacy chat-theme.css/theme.css custom
   * properties, which card 72 has since deleted. That purge is also why the
   * block below has to restate element defaults Tailwind's preflight zeroes
   * (paragraph/heading margins, list markers): theme.css used to supply them
   * globally, and preflight — correctly, for utility-styled markup — does not.
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
<div
  class="markdown-body min-w-0 text-sm [overflow-wrap:anywhere] [word-break:break-word] {extraClass}"
  onclick={handleClick}
>
  {@html html}
</div>

<style>
  /*
   * Content is injected via {@html}, so descendant rules below must use
   * :global() — Svelte's scoping class isn't attached to dynamically
   * injected markup, only to elements the compiler sees statically. Every
   * value is one of shadcn's own Zinc tokens (src/app.css) or Tailwind's
   * rem spacing scale, kept as plain CSS only because these selectors have
   * nowhere else to live (see the doc comment above).
   */

  .markdown-body :global(a) {
    color: var(--primary);
    text-decoration: underline;
  }

  .markdown-body :global(p) {
    margin: 0 0 0.5rem 0;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin: 0 0 0.5rem 0;
    padding-left: 1.25rem;
  }

  .markdown-body :global(ul) {
    list-style: disc;
  }

  .markdown-body :global(ol) {
    list-style: decimal;
  }

  .markdown-body :global(li) {
    margin: 0 0 0.25rem 0;
  }

  .markdown-body :global(li:last-child) {
    margin-bottom: 0;
  }

  .markdown-body :global(blockquote) {
    margin: 0 0 0.5rem 0;
    padding: 0.25rem 0.75rem;
    border-left: 3px solid var(--border);
    color: var(--muted-foreground);
  }

  /* Preflight strips heading font-size/weight/margin; markdown headings need
     them back, on a scale that stays close to the 14px body text a 320px-wide
     side panel is built around. */
  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    margin: 0 0 0.5rem 0;
    line-height: 1.3;
    font-weight: 600;
    color: var(--foreground);
  }

  .markdown-body :global(h1) {
    font-size: 1.125rem;
  }

  .markdown-body :global(h2) {
    font-size: 1rem;
  }

  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    font-size: 0.9375rem;
  }

  .markdown-body :global(p:last-child) {
    margin-bottom: 0;
  }

  /* Inline code */
  .markdown-body :global(code) {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    background: var(--muted);
    border-radius: var(--radius-sm);
    padding: 1px 0.25rem;
    overflow-wrap: anywhere;
  }

  /* Fenced code block wrapper (built in src/ui/markdown.ts renderCodeBlock) */
  .markdown-body :global(.md-code) {
    margin: 0 0 0.5rem 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--muted);
  }

  .markdown-body :global(.md-code-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.8125rem;
    color: var(--muted-foreground);
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
    font-size: 0.8125rem;
    line-height: 1.6;
    padding: 0 0.5rem;
    border-radius: 9999px;
    background: var(--background);
    border: 1px solid var(--border);
    cursor: pointer;
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .markdown-body :global(.md-copy-btn:hover) {
    background: var(--accent);
  }

  .markdown-body :global(.md-code pre) {
    margin: 0;
    padding: 0.5rem;
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
    margin: 0 0 0.5rem 0;
    font-size: 0.8125rem;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--border);
    padding: 0.25rem 0.5rem;
    text-align: left;
  }

  .markdown-body :global(th) {
    background: var(--muted);
    font-weight: 600;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.5rem 0;
  }
</style>
