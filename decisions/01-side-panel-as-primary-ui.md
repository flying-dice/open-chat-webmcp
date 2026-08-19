---
status: Accepted
date: 2026-08-19
---
# Decision 01 — Side panel is the primary UI surface

## Context

The extension needs a chat surface that lives next to a webpage while the model
drives that page through WebMCP tools. Three options were on the table:

- **Popup** (`action.default_popup`) — closes on every outside click. A tool call
  that focuses the page would tear down the chat mid-generation.
- **Injected overlay** — an iframe or shadow-DOM panel injected into the page.
  Always visible, but it mutates the very DOM the tools operate on, fights the
  host page's CSS/z-index, and breaks on CSP-strict sites.
- **Side panel** (`chrome.sidePanel`, Chrome 114+) — a browser-owned pane docked
  beside the tab.

## Decision

Use `chrome.sidePanel` as the only chat surface. The toolbar action opens it via
`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. No popup,
no injected UI.

`minimum_chrome_version` is set to `116` (side panel API plus MAIN-world content
scripts, see [decisions/02](02-mainworld-webmcp-bridge.md)).

## Consequences

- The chat survives clicks, form fills, and navigations in the page — essential
  when the model is operating the site.
- The panel is an extension page, so it has full extension privileges and can
  make cross-origin requests to Ollama directly (see
  [decisions/04](04-ollama-transport.md)).
- Zero interference with the host page's DOM or CSP.
- Panel width is user-controlled and can be narrow, so the chat UI must be
  responsive down to ~320px.
- The panel is destroyed when closed. Any state that must survive that lives in
  `chrome.storage` (see [decisions/07](07-session-state-and-persistence.md)).
