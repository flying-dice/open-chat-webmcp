// Helpers that drive chrome.* APIs from an extension-origin page (the side
// panel opened as a plain tab, per the card's instruction that MV3 side
// panel UI cannot be opened programmatically). Bypasses the Svelte UI
// entirely so these checks are independent of whatever the panel currently
// renders — another agent is actively editing src/sidepanel/**.

/** Find the tab id of the first open tab whose URL contains `needle`. */
export async function findTabId(extPage, needle) {
  return extPage.evaluate(
    (n) =>
      new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => {
          const tab = tabs.find((t) => typeof t.url === "string" && t.url.includes(n));
          resolve(tab ? tab.id : null);
        });
      }),
    needle,
  );
}

/** Send a chrome.runtime message and await the response, exactly as the
 * panel/relay would, surfacing chrome.runtime.lastError as a rejection. */
export async function sendRuntimeMessage(extPage, msg) {
  return extPage.evaluate(
    (m) =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(m, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(response);
        });
      }),
    msg,
  );
}

export async function getTools(extPage, tabId) {
  const res = await sendRuntimeMessage(extPage, { type: "runtime:get-tools", tabId });
  if (!res || res.type !== "runtime:get-tools-response") {
    throw new Error(`unexpected response to runtime:get-tools: ${JSON.stringify(res)}`);
  }
  return res.tools;
}

export async function callTool(extPage, tabId, name, args = {}) {
  const res = await sendRuntimeMessage(extPage, { type: "runtime:call-tool", tabId, name, args });
  if (!res || res.type !== "runtime:call-tool-response") {
    throw new Error(`unexpected response to runtime:call-tool: ${JSON.stringify(res)}`);
  }
  return res;
}
