// The `chrome.runtime` half of pulling page context (card 118,
// decisions/40-page-context-access.md).
//
// The one implementation of `PageContextSource` (src/domain/chat): one
// `sendMessage`/response round trip, panel → service worker → content relay,
// exactly the shape ./page-tool-executor.ts has for a tool call. The relay is
// still the only code that touches a page; this is the wire.
//
// NO TIMEOUT LIVES HERE, for the same reason it does not live in
// ./page-tool-executor.ts: the budget belongs to the hop that can actually
// abandon the work. `SW_PAGE_CONTEXT_TIMEOUT_MS` (src/infra/webmcp/timeouts.mjs)
// is applied by the worker around its `chrome.tabs.sendMessage` to the relay,
// which is where an unresponsive page is detectable; a second timer here
// would only race the worker's and report a vaguer version of the same
// outcome.
//
// ERRORS AS VALUES (decisions/34). Every failure this can meet — a restricted
// page, a wedged tab, a worker that isn't listening — is an EXPECTED outcome
// of asking a browser tab for its content, not a bug, so all of them come
// back in the error member of a `Result` and none of them throw. The mapping
// from the messaging layer's vocabulary to the domain's is done here and only
// here: nothing in src/domain/chat ever sees a `chrome.runtime.lastError`
// string.

import { PageContextError, type PageContextSource } from "../../domain/chat";
import { fail, ok } from "../../domain/result";
import type { RuntimeGetPageContextRequest, RuntimeGetPageContextResponse } from "./protocol";

/**
 * A {@link PageContextSource} over the `runtime:get-page-context` message
 * pair. Stateless and tab-agnostic — the tab is an argument, not a
 * construction parameter, because the panel's tracked tab changes underneath
 * a long-lived panel (src/infra/chrome-runtime/tab-sync.ts) and a source
 * bound at construction would go stale on the first tab switch.
 */
export function createPageContextSource(): PageContextSource {
  return {
    async pull(tabId, mode) {
      const request: RuntimeGetPageContextRequest = {
        type: "runtime:get-page-context",
        tabId,
        mode,
      };

      let response: RuntimeGetPageContextResponse | undefined;
      try {
        // CAST: `chrome.runtime.sendMessage` resolves `any` in @types/chrome
        // — what comes back is whatever the listener returned. Naming the
        // shape here is what stops that `any` spreading; the value is still
        // read defensively below (the worker's own `isPageContextResponse`
        // guard has already validated it field by field before it got here),
        // so this asserts the contract rather than trusting the sender.
        response = (await chrome.runtime.sendMessage(request)) as
          | RuntimeGetPageContextResponse
          | undefined;
      } catch (err) {
        // The worker being asleep, the extension context invalidated
        // mid-call, the panel closing under the request: all "ask again
        // later", none of them a statement about the page.
        return fail(
          new PageContextError(
            "Unreachable",
            "The page-context request did not reach the worker.",
            {
              cause: err,
            },
          ),
        );
      }

      if (!response) {
        return fail(
          new PageContextError(
            "Unreachable",
            "No response from the extension's background worker.",
          ),
        );
      }

      if (!response.ok || !response.context) {
        // `restricted` is the worker's authoritative "there is no content
        // script in this tab at all" claim (card 31) — a chrome://,
        // chrome-extension://, Web Store or PDF-viewer tab. decisions/40 says
        // those pages behave as they do today, and this is the kind that lets
        // a surface say so instead of showing a retry.
        return fail(
          response.restricted
            ? new PageContextError(
                "Restricted",
                `Tab ${tabId} allows no content script, so its page cannot be read.`,
              )
            : new PageContextError(
                "Unreachable",
                response.error ?? "The page could not be read right now.",
              ),
        );
      }

      return ok(response.context);
    },
  };
}
