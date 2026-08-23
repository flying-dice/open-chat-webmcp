# Privacy Policy — OpenChat (WebMCP)

**Effective date:** 23 August 2026

OpenChat (WebMCP) is a Chrome extension that puts a chat model in your
browser's side panel. This policy explains what data the extension handles,
where it goes, and what never happens. The short version: **we collect
nothing.** The extension has no backend, no analytics, no crash reporting,
and no account system. The developer never receives any data from your use
of it.

## What the developer collects

**Nothing.** The extension makes no network requests to any service
operated by, or on behalf of, the developer. There is no telemetry, no
usage tracking, no error reporting, and no identifier of any kind is
created or transmitted.

## What is stored, and where

Everything the extension stores stays on your device, in Chrome's extension
storage:

- **Chat history** — your conversations, including any page text or
  selected text you chose to share with a message, and a record of tool
  calls made during them. Stored locally (`chrome.storage.local`).
- **Provider and MCP server configuration** — names, URLs, and settings for
  the model providers and MCP servers you add. Non-secret settings may sync
  through your own Chrome profile's sync (`chrome.storage.sync`), which is
  a feature of your Google account, not a service of ours.
- **Credentials** — API keys, custom header values, and OAuth tokens for
  servers you add are stored **unencrypted on this device only**
  (`chrome.storage.local`). They are never placed in Chrome sync and never
  leave your device except to the specific server they belong to. Anyone
  with access to your browser profile's files can read them — treat your
  device accordingly.

You can delete all chat history at any time from the options page
("Clear all history"), and remove any provider, server, or credential
individually. Uninstalling the extension removes its storage.

## What leaves your device, and to whom

Network traffic goes only to endpoints **you configured or are already
viewing** — never anywhere else:

1. **Your model provider(s)** — e.g. a local Ollama server or an
   OpenAI-compatible endpoint you added. Your messages, and any page
   content you explicitly shared with them, are sent there to generate
   replies. Their handling of that data is governed by *their* privacy
   policy (a locally running model sends nothing off your machine at all).
2. **MCP servers you registered** — tool calls you approved are sent to the
   server they belong to.
3. **The page you are viewing** — when the model calls a tool the page
   itself publishes, the tool's arguments are delivered to that page's own
   code, in that page, subject to the approval controls below.

## Page access is visible and yours to switch off

The extension can read the page in front of you only under a sharing
control you can always see:

- The panel shows a **"Sharing *page*"** control for the current page.
  Dismissing it makes the assistant fully blind to that page — no tools, no
  page text, no selected text — until you visibly switch it back on.
- **Selected text** is offered as a chip on the composer only while sharing
  is on, and only what the chip shows is sent, with the message you send it
  with.
- While sharing is on, the extension notices when you select something
  different on the page and updates that chip to match — the chip is the
  only place it goes, and it is still sent only with the message you choose
  to send. Dismissing sharing stops this too.
- **Full page text** is included only when you switch on "Share page
  content", and the transcript records what was shared with each message.
- Nothing is read from any page in the background: reads happen only on
  things you do (selecting text, focusing the panel, sending a message),
  never on a page you have stopped sharing, and never on restricted pages
  (like Chrome's own pages).
- Tool calls that are not explicitly read-only **stop for your approval**,
  showing their real arguments, before they run. Remote MCP server tools
  follow their own, stricter approval policy.

## Permissions, in plain terms

- **Side panel, storage** — the UI and the local storage described above.
- **Tabs** — knowing which tab the panel is pointed at; not used to read
  or record browsing history.
- **Identity** — used only to run the OAuth sign-in flow for an MCP server
  you add; not Google-account sign-in.
- **Host access** — `localhost` is pre-granted for local model servers;
  any other origin is requested one at a time, when you add a provider or
  server there, by your explicit click.
- **All-sites content script** — the in-page relay that reads WebMCP tools
  and, on your gesture and only while sharing is on, page text. The
  sharing control above, not the match pattern, is the user-facing on/off
  switch.

## What we never do

- No selling, sharing, or transferring of user data to anyone — there is
  no user data in our hands to begin with.
- No advertising, no profiling, no fingerprinting.
- No remote code: all executable code ships inside the extension package.
- No use of any data for purposes unrelated to the extension's single
  purpose (chatting with a model that can, with your visible consent, read
  or act on the current page).

## Changes to this policy

Changes are made by updating this file in the extension's public source
repository; the effective date above changes with it. Material changes will
be noted in the extension's release notes.

## Contact

Questions or concerns: open an issue on the source repository
(flying-dice/open-chat-webmcp), or contact the developer, Jonathan Turnock,
at jonathan.turnock@gmail.com.
