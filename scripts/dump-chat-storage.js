/*
 * Chat-storage diagnostic dump (card 55, extended by card 59:
 * boards/project-backlog/59-sync-path-diagnostics-and-durability.md).
 *
 * NOT a node script — this is meant to be pasted into an EXTENSION page's
 * devtools console, where `chrome.storage` and `chrome.tabs` are available:
 *
 *   1. Reproduce the bug first (have a chat with messages, switch away from
 *      the tab and back, so the panel is showing the broken state).
 *   2. Right-click the side panel -> Inspect (or open the options page and
 *      inspect that) to get a devtools console in an extension context.
 *   3. Paste this whole file into the console and hit enter.
 *   4. Copy the printed JSON.
 *
 * WANT THE FULL [webmcp][tab-sync] TRACE TOO, NOT JUST THIS SNAPSHOT? (card
 * 59 item 1) That tracing is off by default in a real installed build
 * (`import.meta.env.DEV` is `false` in every build loadable unpacked,
 * including what `npm run launch` opens) — turn it on first, in the SAME
 * devtools console, before reproducing:
 *
 *   window.__webmcpPanelDebug.enableTracing()
 *
 * It survives the panel being closed/reopened (stored in
 * `chrome.storage.local`, not an in-memory flag), so reproduce the bug,
 * THEN come back here and paste this script. Turn it back off afterward
 * with `window.__webmcpPanelDebug.disableTracing()` so it doesn't keep
 * logging. See src/sidepanel/stores/panel.svelte.ts's `isTracingEnabled`
 * doc comment for the full story.
 *
 * PRIVACY: deliberately reports ids, origins, roles and counts only. No
 * message text, no tool arguments/results, no full tab URLs are included, so
 * the output is safe to paste into a bug report. `liveSession` below keeps
 * this guarantee too — it only ever reports a chat id, counts, and the
 * tracing on/off state, sourced from `panel.svelte.ts`'s own
 * equally-scoped debug hook (see its doc comment on
 * `window.__webmcpPanelDebug`).
 *
 * The `diagnosis` block at the end is the interesting part — it flags the
 * specific failure modes cards 55/59 chase:
 *   - orphanedChats:     a chat record with messages that is MISSING from
 *                        `chat:index`, i.e. invisible to the history list.
 *                        This is the unserialized read-modify-write of
 *                        `chat:index` in commitSession (src/lib/session.ts).
 *   - danglingPointers:  a `tabchat:<tabId>` pointing at a chat id that no
 *                        longer exists in storage.
 *   - pointersToEmpty:   a tab pointing at a chat with zero messages, while
 *                        other chats with messages exist for that origin —
 *                        the "transcript reset to No messages yet" shape.
 *   - originMismatches:  a pointer whose recorded `tabOrigin` differs from
 *                        the tab's CURRENT origin. getOrCreateChatForTab
 *                        treats that as a recycled tab id and hands back a
 *                        brand-new empty chat.
 *   - indexWithoutRecord: an index entry whose `chat:<id>` record is gone.
 *   - chatsFailingValidation: a chat record that would fail
 *                        src/lib/session.ts's real `isChatSession()`
 *                        validator — see the CARD 59 note on `isChatSessionValid`
 *                        below for why this used to under-report as 0.
 *   - liveVsStorageDivergence: the panel's in-memory chat (card 59 item 6)
 *                        disagrees with what is on disk for that same chat
 *                        id — the direct version of what card 57's dump
 *                        could previously only prove by inference.
 */

(async () => {
  const all = await chrome.storage.local.get(null);

  const originOf = (url) => {
    if (!url) return "";
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  };

  const index = Array.isArray(all["chat:index"]) ? all["chat:index"] : [];

  const chatKeys = Object.keys(all).filter(
    (k) => k.startsWith("chat:") && k !== "chat:index",
  );

  // Mirrors src/lib/session.ts's isRecord/isToolCallMode/isToolCallLogEntry/
  // isChatMessageLike/isProviderSelectionLike/isChatSession EXACTLY (card 59
  // item 5) — including isToolCallLogEntry's isRecord(arguments) check,
  // which the pre-card-59 version of this script didn't reproduce at all.
  // The two must be kept in sync by hand; drifting apart again is exactly
  // what produced the bug this replaces: card 55's dump reported
  // `chatsFailingValidation: 0` while all 63 stored records were actually
  // unreadable by the real validator.
  const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const isToolCallModeValid = (v) => v === "auto" || v === "approved" || v === "denied";
  const isToolCallLogEntryValid = (v) =>
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    isRecord(v.arguments) &&
    isToolCallModeValid(v.mode) &&
    typeof v.startedAt === "number" &&
    (v.endedAt === undefined || typeof v.endedAt === "number") &&
    (v.error === undefined || typeof v.error === "string");
  const isChatMessageLikeValid = (v) =>
    isRecord(v) && typeof v.role === "string" && typeof v.content === "string";
  const isProviderSelectionLikeValid = (v) =>
    isRecord(v) && typeof v.providerId === "string" && typeof v.model === "string";
  const isChatSessionValid = (v) =>
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.origin === "string" &&
    Array.isArray(v.messages) &&
    v.messages.every(isChatMessageLikeValid) &&
    (v.selection === undefined || isProviderSelectionLikeValid(v.selection)) &&
    Array.isArray(v.toolCalls) &&
    v.toolCalls.every(isToolCallLogEntryValid) &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    (v.title === undefined || typeof v.title === "string");

  const chats = chatKeys.map((k) => {
    // `raw` (the UNCOERCED stored value) is what the real validator runs
    // against below. `c` is a display-only fallback to `{}` so the fields
    // beneath don't throw on a `null`/`undefined` record — it must NEVER be
    // used for the validity check itself, since defaulting a missing
    // `messages` array to `[]` before checking it is exactly the bug being
    // fixed here (`[].every(...)` is vacuously true).
    const raw = all[k];
    const c = raw || {};
    const messagesIsArray = Array.isArray(c.messages);
    const toolCallsIsArray = Array.isArray(c.toolCalls);
    const messages = messagesIsArray ? c.messages : [];
    return {
      id: c.id ?? k.slice("chat:".length),
      key: k,
      origin: c.origin,
      messageCount: messages.length,
      roles: messages.map((m) => m && m.role),
      // Card 59 item 5: raw shape flags, reported separately from the
      // coerced `messageCount`/`roles` above so a genuinely missing/corrupt
      // array is visible instead of silently reading as "0 messages".
      messagesIsArray,
      toolCallsIsArray,
      // The actual `isChatSession()` result against the RAW stored value —
      // this is what determines whether readChatRaw()/getChat()/
      // getOrCreateChatForTab() would treat this record as existing at all.
      isValidChatSession: isChatSessionValid(raw),
      toolCallCount: toolCallsIsArray ? c.toolCalls.length : null,
      hasSelection: Boolean(c.selection),
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : null,
    };
  });

  const pointers = Object.entries(all)
    .filter(([k]) => k.startsWith("tabchat:"))
    .map(([k, v]) => ({
      tabId: Number(k.slice("tabchat:".length)),
      chatId: v && v.chatId,
      tabOrigin: v && v.tabOrigin,
    }));

  // Live tabs, so a pointer's recorded tabOrigin can be compared against the
  // origin that tab is actually showing right now.
  let liveTabs = [];
  try {
    liveTabs = (await chrome.tabs.query({})).map((t) => ({
      tabId: t.id,
      origin: originOf(t.url),
      active: t.active,
      windowId: t.windowId,
    }));
  } catch (err) {
    liveTabs = [`chrome.tabs unavailable in this context: ${String(err)}`];
  }

  // Card 59 item 6: the panel's own in-memory session, read through the
  // debug hook src/sidepanel/stores/panel.svelte.ts attaches to
  // `globalThis` — see that hook's doc comment. `null` when this script is
  // pasted into a context that never loads that module at all (e.g. the
  // OPTIONS page's console, which has no side panel session to report), not
  // an error.
  const liveSession =
    typeof window !== "undefined" && typeof window.__webmcpPanelDebug === "function"
      ? window.__webmcpPanelDebug()
      : null;

  const byId = new Map(chats.map((c) => [c.id, c]));
  const indexIds = new Set(index.map((e) => e && e.id));
  const tabById = new Map(
    liveTabs.filter((t) => t && t.tabId !== undefined).map((t) => [t.tabId, t]),
  );

  const diagnosis = {
    orphanedChats: chats
      .filter((c) => c.messageCount > 0 && !indexIds.has(c.id))
      .map((c) => ({ id: c.id, origin: c.origin, messageCount: c.messageCount })),

    indexWithoutRecord: index
      .filter((e) => e && !byId.has(e.id))
      .map((e) => ({ id: e.id, origin: e.origin, messageCount: e.messageCount })),

    danglingPointers: pointers.filter((p) => p.chatId && !byId.has(p.chatId)),

    pointersToEmpty: pointers
      .filter((p) => {
        const c = p.chatId && byId.get(p.chatId);
        return c && c.messageCount === 0;
      })
      .map((p) => ({
        tabId: p.tabId,
        chatId: p.chatId,
        tabOrigin: p.tabOrigin,
        otherChatsWithMessagesForThisOrigin: chats.filter(
          (c) => c.origin === p.tabOrigin && c.messageCount > 0,
        ).length,
      })),

    originMismatches: pointers
      .filter((p) => {
        const t = tabById.get(p.tabId);
        return t && t.origin !== p.tabOrigin;
      })
      .map((p) => ({
        tabId: p.tabId,
        pointerTabOrigin: p.tabOrigin,
        tabOriginNow: tabById.get(p.tabId).origin,
      })),

    // Card 59 item 5: filters on the REAL validator result now, not the
    // old `everyMessageValid` (computed over an already-`[]`-coerced
    // array, which was vacuously true whenever `messages` was missing
    // entirely — the exact false negative this replaces).
    chatsFailingValidation: chats
      .filter((c) => !c.isValidChatSession)
      .map((c) => ({
        id: c.id,
        origin: c.origin,
        messageCount: c.messageCount,
        messagesIsArray: c.messagesIsArray,
        toolCallsIsArray: c.toolCallsIsArray,
      })),

    // Card 59 item 6: the direct, no-inference-needed version of what card
    // 57's dump could only argue by elimination — the on-screen chat and
    // its own on-disk record disagreeing.
    liveVsStorageDivergence: (() => {
      if (!liveSession || liveSession.chatId === undefined) return null;
      const stored = byId.get(liveSession.chatId);
      if (!stored) {
        return {
          chatId: liveSession.chatId,
          note: "the panel's live chat id has no matching chat:<id> record in storage at all",
        };
      }
      if (stored.messageCount !== liveSession.messageCount) {
        return {
          chatId: liveSession.chatId,
          storedMessageCount: stored.messageCount,
          liveMessageCount: liveSession.messageCount,
        };
      }
      return null; // in sync
    })(),
  };

  const report = {
    counts: {
      indexEntries: index.length,
      chatRecords: chats.length,
      pointers: pointers.length,
    },
    index: index.map((e) => ({
      id: e && e.id,
      origin: e && e.origin,
      messageCount: e && e.messageCount,
      updatedAt: e && e.updatedAt ? new Date(e.updatedAt).toISOString() : null,
    })),
    chats,
    pointers,
    liveTabs,
    liveSession,
    diagnosis,
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  // devtools-only helper: puts the JSON straight on the clipboard.
  if (typeof copy === "function") {
    copy(json);
    console.log("^ copied to clipboard");
  }
  return report;
})();
