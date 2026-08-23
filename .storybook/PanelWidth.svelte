<script lang="ts">
  /**
   * The width-preset decorator's wrapper (card 123, decisions/42-storybook.md).
   *
   * A Storybook decorator that WRAPS (rather than just running a side effect)
   * returns `{ Component, props }` from ./preview.ts, and the Svelte
   * renderer's own DecoratorHandler mounts it with the story as its children
   * snippet. This is that component: a fixed-width box painted in the app's
   * own surface tokens.
   *
   * Why fixed pixels and not a Storybook viewport: Chrome gives a side panel
   * a real, user-draggable width, and the panel's layout is judged at the two
   * ends of the range people actually leave it at — 320px (the narrowest
   * Chrome allows) and 400px (roughly the default). Those are the two numbers
   * decision 42 names. A story opts in through `parameters.panelWidth`, so
   * options-page and shared-UI stories — which live on a full page — are
   * unaffected.
   *
   * `bg-background text-foreground` rather than inheriting: the story canvas
   * is Storybook's own white, so without painting the app's surface token here
   * a dark-theme story would render dark text on a light card. Both tokens
   * follow the `.dark` class ./preview.ts's theme decorator puts on `<html>`.
   */
  import type { Snippet } from "svelte";

  interface Props {
    /** Panel width in CSS pixels — 320 or 400, per `parameters.panelWidth`. */
    width: number;
    /** The story being wrapped, handed over by the Svelte renderer. */
    children: Snippet;
  }

  const { width, children }: Props = $props();
</script>

<div class="bg-background text-foreground overflow-hidden border" style="width: {width}px">
  {@render children()}
</div>
