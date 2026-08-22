---
status: Accepted
date: 2026-08-23
---
# Decision 36 — One type and icon scale for both surfaces

## Context

Card 98 reviewed sizing across the side panel and the options page after the
shadcn/Maia migration (decisions/28-shadcn-svelte-maia-zinc.md). The Tools
panel alone renders four unrelated scales inside a 320–400px column:

- `Empty.Title` at `text-lg` — 18px, and the copy in it is a full sentence, so
  it wraps to two or three lines and reads as a headline
  (`src/sidepanel/components/ToolsPanel.svelte:60,74,90-92`).
- Section labels at `text-xs` uppercase — 12px caps
  (`src/sidepanel/components/ToolsPanel.svelte:55,119`).
- Body copy at `text-sm` — 14px, inherited from `Card`/`Empty`.
- Monospace tool-card titles at the card's inherited 14px with `font-semibold`,
  which at the same px optically outweighs the 14px sans beside it
  (`src/sidepanel/components/ToolListItem.svelte:63`).

The wider sweep found the same disease everywhere. Three causes:

1. **No declared body size.** `src/app.css` sets no base size, so anything
   without an explicit `text-*` inherits the 16px root. The user's chat bubble
   (`Transcript.svelte:201`), the activity sentence
   (`ActivityIndicator.svelte:90`) and the composer textarea
   (`Composer.svelte:193`, `text-base`) render at 16px while the assistant's
   reply beside them renders at 14px. The two halves of one conversation are
   different sizes.
2. **The same element sized differently in different components.** A tool name
   in a row is `font-mono text-sm` in `CallLogEntry.svelte:100` and
   `font-mono text-xs` in `ToolCallRow.svelte:163`; the whole detail body of
   those two is 14px in one and 12px in the other. `PresetPicker.svelte:47`
   uses `font-semibold` for the eyebrow the Tools panel sets in `font-medium`.
3. **Icon sizes that are silently ignored.** `Icon.svelte` renders Hugeicons,
   which set `width`/`height` as *presentation attributes*. Every kit component
   with a `[&_svg:not([class*='size-'])]:size-N` rule — Button, Command.Item,
   DropdownMenu.Item, Empty.Media, Badge, Alert, Item.Media, InputGroup — beats
   those attributes with CSS. So `size={20}` inside a Button renders at 16px,
   `size={20}` inside `Empty.Media` renders at 24px, and IconButton's "compact"
   18px glyph does not exist. 22 of the 22 `size=` props on `<Icon>` are either
   dead or the only thing holding a size — with no way to tell which from the
   call site.

Markdown adds a fourth scale of its own — 18/16/15px headings and 13px code in
`src/ui/components/Markdown.svelte:164-186` — against a 14px reply.

## Decision

### One scale, seven roles, both surfaces

The base is **14px** (`text-sm`, the kit default). Figtree's x-height is large
enough that 14px reads at about the apparent size of 15px Inter, which lands on
Chrome's own side-panel density without fighting the kit on every component.
There is no 13px base and no root `font-size` override: overriding the root
would rescale Maia's rem-based spacing too, and every `Card`, `Item`, `Command`,
`Dialog` and `Tabs` in the vendored kit already declares `text-sm`.

| role | Tailwind | px / weight | used for |
| --- | --- | --- | --- |
| `page-title` | `text-2xl font-semibold tracking-tight leading-tight` | 24 / 600 | the options page `<h1>`. Options only — the side panel has no page title. |
| `title` | `text-base font-medium tracking-tight` | 16 / 500 | the single subject of a whole surface: options section headings, dialog/sheet/popover titles, empty-state titles. Never inside a repeating list. |
| `body` | `text-sm` | 14 / 400 | prose, message text, descriptions, menu and list items, inputs, form fields. The default — omit the class wherever the kit already supplies it. |
| `body-strong` | `text-sm font-medium` | 14 / 500 | list-row and card titles, form labels, sub-headings inside a card. |
| `label` | `text-xs font-medium tracking-wide uppercase text-muted-foreground` | 12 / 500 | section dividers ("THIS PAGE", "MCP SERVERS"), eyebrows ("Approval needed"), group headings. |
| `caption` | `text-xs text-muted-foreground` | 12 / 400 | metadata: durations, model labels, counts, origins, timestamps, footnotes, error detail. |
| `code` | `font-mono text-code` | 13 / 400 | tool names, identifiers, inline code, payload dumps. `font-semibold` where it is a card or row title. |

**Only one role may be larger than `body` on any given screen, and only once.**
Anything that repeats — every row of a list, every card in a stack, every tool
in the Tools panel — is `body` or `body-strong`. Hierarchy inside a repeating
structure comes from **weight and colour, never size**. This is the rule that
kills the current mess: the Tools panel shows two `text-lg` titles at once, and
the model sheet's title is both larger *and* muted grey
(`ProviderPicker.svelte:377`), which inverts the hierarchy it is trying to set.

Corollary rules:

- **Mono runs one step below its sibling sans.** Monospace at the same px has a
  wider, heavier colour than Figtree, so 14px mono inside a 14px paragraph reads
  as the larger of the two. `code` is 13px inside `body`, and 14px
  (`font-mono text-sm font-semibold`) only where it is the `title` of a surface
  — the approval card's tool name is the one place that applies.
- **A title is a noun phrase, not a sentence.** If the copy needs a sentence, it
  is a description. The Tools panel's empty states are titled with paragraphs;
  that, not the 18px, is why they read as headlines.
- **Options runs the same scale.** It adds exactly one role (`page-title`) and
  no size bump elsewhere: at a 768px measure, 14px is what chrome://settings
  itself uses, and a second scale for a five-section settings page buys nothing
  but drift.

### `--text-code`

Add a hand-authored `@theme` block to `src/app.css` (kept separate from the
generated block, which is regenerated by the shadcn CLI):

```css
@theme {
	--text-code: 0.8125rem;          /* 13px */
	--text-code--line-height: 1.25rem; /* matches text-sm, so inline code
	                                      does not disturb a body line */
}
```

`Markdown.svelte`'s inline code, table and code-header rules already use
0.8125rem; they become the source of the token rather than a private exception.
Markdown's heading ladder collapses onto the scale: `h1` 0.9375rem/600, `h2`–`h6`
0.875rem/600 — a heading in a chat reply is separated by weight and space, not
size.

### Icon scale

Icons are sized by their **container**, never by the call site.

| role | size | used for |
| --- | --- | --- |
| `status-dot` | 6px (`size-1.5`) | connection state on the context chip |
| `state-dot` | 8px (`size-2`) | tool-call outcome dot in the transcript |
| `glyph` | 16px (`size-4`) | the workhorse: every icon inside a button, menu item, tab, badge, chip or line of body text |
| `mark` | 20px (`size-5`) | identity marks only — the model/provider glyph in a reply, and the empty-state glyph |
| `tile` | 36px (`size-9`) | the empty-state media tile and the default round icon-button hit target (32px / `size-8` for the compact variant) |

Two glyph sizes, two dot sizes. 16px is what the kit already forces everywhere,
so this is mostly a matter of deleting the props that pretend otherwise.

`Icon.svelte` gains a `class` prop and callers set the size with `size-4`/
`size-5` rather than `size={N}` wherever the icon sits inside a kit component
that owns svg sizing. Where `size={N}` survives, it must be because nothing else
is setting the size — a numeric `size` on an `<Icon>` inside a `Button`,
`Empty.Media`, `Command.Item` or `DropdownMenu.Item` is dead code and gets
deleted.

## Consequences

- Implemented by card 99; card 98 is review-only. The fix list, ordered by
  visual impact, lives on card 98's journal.
- Three vendored kit defaults get overridden at the call site rather than
  patched in `src/ui/components/ui/` (which stays regenerable):
  `Empty.Title`'s `text-lg`, `Textarea`/`Input`'s `text-base md:text-sm` (the
  `md:` breakpoint never fires in a side panel, so those inputs are permanently
  16px), and `Empty.Media`'s `size-10`/`size-6` pairing.
- No unit test asserts on a class name and `verify/checks/screenshots.mjs`
  captures without comparing to a baseline, so the change carries no test risk;
  the screenshot matrix should simply be recaptured after card 99.
- Copy changes ride along where a title is a sentence. That is a deliberate
  scope inclusion: retitling the four Tools-panel empty states does more for the
  complaint than the px change does.
