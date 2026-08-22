// The extension's own chrome, as seen from a UI surface (card 78).
//
// One call today: `chrome.runtime.openOptionsPage()`, which was the last
// `chrome.*` site left in src/sidepanel/stores/selection.svelte.ts. Provider
// CRUD lives only on the options page (decisions/10), so the side panel's
// "no providers registered" and "provider deleted" empty states — and the
// assistant note a 401 produces (src/domain/chat/turn.ts's `"open-options"`
// action) — all need a way to send the user there. That is a platform
// capability, not a rule about a selection, so it is an adapter the
// composition root injects rather than a call a store makes.
//
// Deliberately not folded into ./tab-sync.ts or ./protocol.ts: neither is
// about the extension's own surfaces, and an adapter that grows a second
// unrelated responsibility is how src/lib happened.

/** What a UI surface may ask of the extension's own chrome. */
export interface ExtensionShell {
  /** Open (or focus) this extension's options page. */
  openOptionsPage(): void;
}

export function createExtensionShell(): ExtensionShell {
  return {
    openOptionsPage(): void {
      chrome.runtime.openOptionsPage();
    },
  };
}
