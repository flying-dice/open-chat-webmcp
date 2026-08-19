---
status: Accepted
date: 2026-08-20
---
# Decision 14 — Backend MCP servers are remote-only, merged and namespaced with page tools

## Context

WebMCP gives the model tools published by the page in front of you. Users also
want tools that have nothing to do with the current page — a ticket tracker, a
search index, an internal service — exposed by real MCP servers they already run.

MCP's most common transport is stdio, over a subprocess. A browser extension
cannot spawn or speak to a subprocess. It can speak HTTP.

## Decision

Support REMOTE MCP servers only: streamable HTTP and SSE endpoints addressed by
URL. No stdio, and no companion helper process.

Local stdio-only servers are reached, if at all, by the user putting an existing
off-the-shelf stdio-to-HTTP proxy in front of them. That is documented, not
shipped — it keeps a whole class of process management out of a browser extension.

Server tools are MERGED with the page's WebMCP tools into one list the model sees,
namespaced by server so a server tool cannot collide with a page tool or with
another server's. The namespace is part of the tool name presented to the model,
so a tool call is unambiguous about where it will execute.

The approval policy from decision 05 applies UNCHANGED to both kinds: a tool
annotated `readOnlyHint` runs automatically, everything else asks. MCP tool
annotations are used the same way page annotations are.

Server configs live in a registry alongside providers (decision 10): URL, display
name, optional auth, enabled/disabled, stored in `chrome.storage.sync` with any
credential split into `chrome.storage.local`. Reaching a server's host requires
`chrome.permissions.request` from a user gesture, exactly as a remote provider does.

## Consequences

- The model's tool list is no longer "what this page offers". The inspector and
  the approval cards must make it obvious WHERE a tool will execute, because
  "read-only" means something very different for a page you are looking at and a
  remote service you are not.
- Trusting annotations was already a UX-guidance-not-security-boundary call
  (decision 05). That is a larger bet for a remote server than for a page: a
  destructive remote tool labelled read-only acts outside anything the user can
  see. The honest mitigation is that the user chose to add that server.
- One namespacing scheme must serve both the model-facing tool name and the UI. A
  separator has to be chosen that models handle reliably in tool names.
- A slow or unreachable server must not block the page's own tools from being
  offered. Discovery has to degrade per-server, not all-or-nothing.
- This is the first feature where the extension acts on something other than the
  current tab, which weakens the "it only touches the page you are on" story the
  store listing (card 19) was going to tell.
