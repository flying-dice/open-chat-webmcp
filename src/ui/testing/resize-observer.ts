// jsdom (the "component" Vitest project's environment, vitest.config.ts) has
// no `ResizeObserver` — a real browser API neither jsdom nor this repo's
// vitest.setup.ts polyfills (out of scope for card 84 to add there: a parallel
// agent owns that file this session). bits-ui's floating-layer primitives
// (Tooltip, Popover, DropdownMenu — anything built on `runed`'s
// `useElementSize`) construct one unconditionally the moment their content
// actually mounts, which throws `TypeError: this[#window].ResizeObserver is
// not a constructor` as an UNHANDLED error outside any try/catch a test could
// itself catch — confirmed via IconButton's tooltip wrapper mounting inside
// Composer.svelte. A single unhandled error like that fails the whole Vitest
// run (non-zero exit) even when every assertion passed.
//
// Import this file for its side effect — `import "../../ui/testing/resize-observer";`
// — in any component test whose tree can mount a bits-ui floating-layer
// primitive (which in practice is most of them, since IconButton alone wraps
// every icon button in a Tooltip). Idempotent: safe to import from multiple
// test files in the same run.
//
// The stub only needs to exist and not throw — nothing in this repo's
// component tests asserts on actual resize callbacks, and jsdom never fires
// layout changes for one to report anyway.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
