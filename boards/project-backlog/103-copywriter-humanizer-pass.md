---
column: review
agent: claude-opus
live: false
labels: [frontend, docs]
priority: high
updatedAt: 2026-08-22T17:15:00.000Z
---
# Copywriter pass: humanize the English source

With all copy in messages/en.json (cards 101-102), a dedicated copywriter
persona reviews every string BEFORE translation (decisions/37): reads well
aloud, plain and human, consistent voice and terminology (one name per
concept: chat/provider/model/tool/server — build the glossary), sentence
case per the design language, no AI-isms (seamlessly, leverage, empower,
robust, "Let's", reflexive em-dashes, apology boilerplate), no
over-explaining. Error messages say what happened and what to do next, in
that order, without blame. The type-scale rule from decisions/36 applies to
copy too: titles are noun phrases; sentences live in descriptions.
Also covers _locales/en manifest strings and the README's user-facing
front section.

## Checklist

- [x] Every messages/en.json string reviewed; edits applied with the glossary journalled
- [x] Titles are noun phrases; error copy follows what-happened → what-next
- [x] AI-ism sweep documented (patterns checked, instances fixed)
- [x] Component tests still green (they assert via message functions, so copy edits flow through)
- [x] Screenshots re-captured where copy changed; verify selectors intact
- [x] npm test, npm run check, npm run guard, npm run build, npm run verify green

## Comments

- **claude-opus** (2026-08-22T16:20:00.000Z): Claimed the card. Read all 401 keys in `messages/en.json:1-599`, `public/_locales/en/messages.json:1-10`, the README front section (`README.md:1-234`), decisions/36's title rule, and — where a key name alone was ambiguous — the component rendering it (`src/sidepanel/components/ToolsPanel.svelte:50-130`, `AnnotationBadges.svelte:36-55`, `ApprovalCard.svelte:86-145`, `ProviderPicker.svelte:152-162,394`, `Inspector.svelte:51-58`, `McpServerForm.svelte:555-566`, `src/options/forms/testResultDisplay.ts:106-125`, `src/sidepanel/stores/approvals.svelte.ts:225-246`). Also swept the harness for TEXT locators before touching anything: `verify/checks/optionsSmoke.mjs:82-281`, `verify/checks/screenshots.mjs:155,213,224,264-277`, `verify/checks/liveSmoke.mjs:137-199`, `verify/run.mjs` (no UI copy — it drives the relay, not the DOM).

- **claude-opus** (2026-08-22T17:00:00.000Z): Rewrote 139 keys / 144 variants in `messages/en.json` — key names, param names, plural declarations/selectors and every `<code>`/`<em>`/`<a>` tag preserved byte-for-byte (verified by a diff script that compares key order, plural `match` shapes, `{param}` sets and the extracted tag list per key: 0 differences on all four). See the glossary, AI-ism sweep and the ten best rewrites in the three entries below.

- **claude-opus** (2026-08-22T17:02:00.000Z): **GLOSSARY — one name per concept.** Every term below now has exactly one word in the UI, and the drift listed against it is gone from `messages/en.json`.
  | concept | the word | killed |
  | --- | --- | --- |
  | a conversation | **chat** | "conversation", "session", "stored session" (`historySection_emptyTitle` was literally "No stored sessions" while nine other keys said chat) |
  | a configured endpoint | **provider** | "backend" (`presetPicker_description`, `providerForm_backendChangeAction`), "chat backend" (README) |
  | the thing you pick on a provider | **model** | — (was already clean) |
  | a callable action | **tool**, qualified as **page tool** / **server tool** | "the page's own tools" vs "remote tools" used interchangeably |
  | a remote tool source | **MCP server** ("server" where unambiguous) | "remote service", "backend" |
  | one invocation, and its record | **tool call** / **call log** | "Call Log" title case; `inspector_callLogTab` was the only title-cased label in the file |
  | reachability | **connect** / **Test connection** | — |
  | Chrome host permission | **permission**, verb **grant**, object **reach** a host | "contact this host" (`permissionGrantedTitle`, `permissionNeededTitle`, `permissionDeniedRetryMessage`) vs "reach" (`mcpTools_*`) |
  | what a new chat starts with | **default** | "seeded", "the panel opens with" |
  | adding a provider/server | **add** | "register"/"registered" (5 keys + README), which read as protocol jargon next to the "Add provider" button |
  | on/off for a server | **enable** / **disable** | "turn on"/"turn off" (`mcpServersSection_turnOnFailedWhat` said "turn on" while the button said "Enable") |
  | picking from a list | **choose** | "select" (`providerRow_selectModelPlaceholder` was "Select a model" next to `providerPicker_chooseModelLabel`'s "Choose a model") |
  | the two surfaces | **side panel** / **options page** | "settings page", "the panel" |
  | quoting a user value | curly `“{name}”` | `\"{name}\"` and `'{title}'` mixed across 8 keys |
  Also normalised: "Model id" → "Model ID" (the file already said "Client ID"); the four near-identical credential warnings now share one closing sentence.

- **claude-opus** (2026-08-22T17:04:00.000Z): **AI-ISM SWEEP.** Patterns grepped across `messages/en.json`, `README.md` and `public/_locales/en/messages.json`: seamless(ly), leverage, empower, robust, delve, streamline, "Let's", unlock, elevate, utilize, facilitate, "in order to", simply, effortless, cutting-edge, state-of-the-art, game-changing, "dive in", "it's important to note", "please note", "ensure that", comprehensive, holistic, synergy, best-in-class, powerful, intuitive, user-friendly, blazing, supercharge, crucial, vital, realm, landscape, tapestry, meticulous, testament, exclamation marks, apology boilerplate.
  Cards 101/102 had already kept the obvious vocabulary out — the only lexical hits were three "simply"s (2 fixed, 1 kept where it carries real meaning in `toolsPanel_noServerToolsDescription`) and README's "or simply visiting a site" → "or opening a site". The real tic was structural:
  - **Reflexive em-dash: 73 across 64 keys → 3.** Every one was re-read and replaced with the punctuation the sentence actually wanted (a full stop, a colon, a semicolon, a comma, or a `·` in a two-part chip label). The 3 survivors are earned: one matched parenthetical pair (`historySection_description`), and one as a visual separator appended to a heading (`toolCallRow_untrustedDataSuffix`). This matters most for the next card: dash-welded clauses are exactly what nine translators would each guess at differently.
  - **Shouty emphasis** used as a substitute for clear phrasing: "page tools come from THIS tab only", "its OWN, stricter approval policy", "A SEPARATE setting from…" — all three rewritten so the sentence carries the emphasis.
  - **Dev-doc leakage into shipped UI:** four strings quoted repo file paths at the user (`historySection_description`, `settingsSection_approvalDescription`, `settingsSection_mcpApprovalDescription`, `mcpServersSection_description` all cited `decisions/NN-….md`). Removed; the decisions still own the rationale, the UI no longer name-drops them.
  - **Over-explaining:** `providersSection_emptyDescription` and `approvalCard_unknownToolWarning` each ended on a clause explaining a distinction the reader had not asked about; `toolsPanel_noPageToolsDescription1`'s nested dashes became one parenthesis.
  - **Hedging/jargon leakage:** `readOnlyHint: true` appeared verbatim in two policy descriptions; both now say "marks read-only" and the exact identifier survives once, in `settingsSection_safetyAnnotationsNotice`, inside its `<code>` — where a technical reader actually acts on it. HTTP codes kept only in `testConnection_authFailed`, `provider_authFailed`, `provider_httpError`, `testConnection_httpMessage`.

- **claude-opus** (2026-08-22T17:06:00.000Z): **Ten best before → after.**
  1. `historySection_emptyTitle` — "No stored sessions" → **"No chats yet"** (the glossary breach that had a third word for the product's central noun, and it now matches `historyPanel_emptyTitle` exactly).
  2. `storageMessage_sentence` — "{what} — {reason}.{suffix}" → **"{what}: {reason}.{suffix}"**. This template joins every storage failure in the app; the colon is what "what happened, then why" actually reads like: *"Couldn't rename this chat: the browser's storage didn't accept it. Try again in a moment."* (`src/ui/storageMessage.test.ts:20` updated to match.)
  3. `providersSection_staleDefaultWarning` — the `{reason}` sat mid-sentence, and a raw provider error carries no full stop, so the options page rendered *"…{"error":"model not found"} New chats will need…"* run together (visible in the recaptured `options-light.png`). Moved the interpolation to the end: **"…Set a new default below. Reason: {reason}"** — reads correctly whether the reason is one of our sentences or the provider's raw text.
  4. `header_renameAriaLabel` — "{title} (click to rename)" → **"Rename chat: {title}"**. A screen reader was being told to click; now it hears the action, then the subject, which also handles a long chat title gracefully.
  5. `annotationBadges_unannotated` — "unannotated" → **"no safety hints"**. The one badge whose text was a developer's word for the data structure rather than a reader's word for the risk.
  6. `toolsPanel_restrictedTitle` — "Extensions can't reach this page" → **"No extension access here"** (decisions/36: a title is a noun phrase; the sentence lives in the description below it). Same treatment for `toolsPanel_webmcpOffTitle` and `providerPicker_heading` ("Choose your model" → **"Provider and model"** — it is a sheet title, and it lists providers as well as models).
  7. `toolCallRow_stalledTooltip` — "The side panel closed, or the turn ended, before this call reported back — it may still have run on the other end." → **"This call never reported back: the side panel closed, or the turn ended, first. It may still have run at the other end."** What happened first, cause second.
  8. `mcpTools_permissionDeniedError` — "This extension hasn't been granted permission to reach \"{name}\" ({url}) yet — grant it from the options page's MCP Servers section, then try again." → **"The extension doesn't have permission to reach “{name}” ({url}) yet. Grant it in the options page's MCP servers section, then try again."** Passive-with-a-dash → two sentences: state, then instruction.
  9. `approvalCard_skipServerLabel` / `skipPageLabel` — "(this session)" → **"…, until the side panel closes"**. "Session" was ambiguous against "chat" and was also *wrong* for a reader who assumes it means the conversation; the skip list lives for the panel's lifetime (`src/sidepanel/stores/approvals.svelte.ts:233-246`), so the label now says so.
  10. `extDescription` (`public/_locales/en/messages.json:7`) — "Chat with a local Ollama server or an OpenAI-compatible provider that drives the page via WebMCP tools" (the relative clause attached to *provider*, so it read as though the provider drives the page) → **"Chat in a side panel with a local Ollama or any OpenAI-compatible model, and let it act on the page through WebMCP tools."** 120 chars, inside the Web Store's 132 limit. `package.json:59`'s `description` updated in step, per that key's own note.

- **claude-opus** (2026-08-22T17:10:00.000Z): **Harness locators: zero changes needed, by design.** Before editing I froze the 24 literals the harness matches on and rewrote around them: `optionsSmoke.mjs`'s "Chat providers", "Add provider", "Add header", "Header name, e.g. x-api-key", "Value", "Remove header {name}", "Cancel", "Add one anyway", "Show", "Hide", "Save changes", "Edit", "Remove", "Add MCP server", "Add server", "Permission granted", "Permission needed for this host"; `screenshots.mjs`'s "More options" and the four required section headings ("Chat providers", "Tool approval", "MCP servers", "Chat history"); `liveSmoke.mjs`'s "Message", "Send", "Copy response". Every one was already a correct verb-button or noun-label under the new rules, so none needed touching — `node verify/checks/optionsSmoke.mjs` is 13/13 without a single locator edit. The two reserved-header errors optionsSmoke matches ("Content-Type is set automatically…", "is set automatically by the client…") are NOT in `messages/en.json` — see the follow-ups below. One test literal did need updating: `src/ui/storageMessage.test.ts:21`'s regex hardcoded the old em-dash joiner.

- **claude-opus** (2026-08-22T17:12:00.000Z): **Notes for review, and follow-ups I deliberately did not do.**
  - *Meaning changed, key kept* (per the card's rule): `annotationBadges_serverDestructive` "server: destructive" → "destructive". It renders only when `mcpAnnotations` exist (`AnnotationBadges.svelte:39,48`), i.e. only on a server tool, and `approvalCard_runsOnServerSuffix` one line above already says "(an MCP server, not this page)" — the prefix was redundant, and a colon inside a badge reads as debug output. `providerForm_backendChangeAction`'s *value* is now "Change provider"; its key still says "backend" (renaming keys is out of scope).
  - *Confirm-dialog titles stay questions* ("Delete all {count} chats?", "Remove “{name}”?") — decisions/36's noun-phrase rule is about headings that name a surface, and every platform confirm asks a question. Flagging it rather than silently exempting it.
  - *User-facing English still outside the translation source*, found while grepping: `src/domain/providers/provider.ts:111,114` ("Content-Type is set automatically for this provider's wire format and can't be overridden.") and `src/domain/tools/servers.ts:128` ("\"{name}\" is set automatically by the client and cannot be overridden.") — two reserved-header errors that reach the options page, disagree with each other on contractions ("can't" vs "cannot") and on quote style, and will be the only untranslated strings in the UI after card 104. Left alone here because moving them is an architecture change (domain cannot import Paraglide) with a test + smoke-locator blast radius, not a wording change. Recommend a card. `src/domain/chat/turn.ts:440`'s "The user denied this tool call." is intentionally not UI copy — it is fed to the model.
  - *Not touched:* the `<code class="font-mono text-xs">` classes inside the rich-copy strings are 12px where decisions/36 says `code` is 13px (`--text-code`). That is a card 99 sizing fix, not copy; markup was preserved exactly as found.
  - **Gates, all green** (2026-08-22): `npm test` 963/963 in 63 files · `npm run check` 1498 files, 0 errors · `npm run guard` all six (biome, boundaries, clean-code, return-types, throws, i18n — i18n confirms en:401 keys, none added or lost) · `npm run build` OK · `npm run verify` 9/9 required + screenshots PASS, all 11 PNGs recaptured against the new copy · `node verify/checks/optionsSmoke.mjs` 13/13. Not committed, per instruction.
