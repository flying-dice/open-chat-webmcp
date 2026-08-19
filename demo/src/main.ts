// WebMCP demo — registers tools against the real `document.modelContext`
// (decisions/16-native-webmcp-client.md). This is the page the extension is
// developed and tested against (demo/vite.config.ts), and the API it targets
// is the ISOLATED-world content script's own dependency — if tools
// registered here aren't visible to the official inspector, the extension
// won't see them either.
//
// WebMCP is OFF by default in Chrome. `document.modelContext` is simply
// undefined unless the user enabled chrome://flags/#enable-webmcp-testing
// (or launched with --enable-features=WebMCP), or the page carries an
// origin-trial token. There is nothing to poll for — the feature is either
// compiled in and enabled at load, or it isn't — so this checks once and
// tells the user exactly what to do instead of spinning.

import { createDemoTools, createDynamicTool, type Fixture } from "./tools";
import { renderToolsList, setStatus, withLogging } from "./ui";

const ENABLE_FLAG_URL = "chrome://flags/#enable-webmcp-testing";

const registered = new Map<string, Fixture>();

async function registerTool(tool: Fixture, signal?: AbortSignal): Promise<void> {
  await document.modelContext.registerTool(withLogging(tool), signal ? { signal } : undefined);
  registered.set(tool.name, tool);
  renderToolsList(registered);
}

/** There is no `unregisterTool` in the real API — unregistration is
 * `AbortController.abort()` on the signal passed at registration time. This
 * only updates the page's own bookkeeping map; the actual removal already
 * happened the moment `abort()` was called above it in the caller. */
function forgetTool(name: string): void {
  registered.delete(name);
  renderToolsList(registered);
}

async function main(): Promise<void> {
  if (!document.modelContext) {
    setStatus(
      `document.modelContext not found — enable WebMCP via ${ENABLE_FLAG_URL} ` +
        `(or launch Chrome with --enable-features=WebMCP), then reload this page.`,
      "error",
    );
    return;
  }

  setStatus("document.modelContext found — registering demo tools…", "pending");

  const notesEl = document.getElementById("notes-list") as HTMLUListElement;
  const tasksEl = document.getElementById("tasks-list") as HTMLUListElement;
  for (const tool of createDemoTools({ notesEl, tasksEl })) {
    await registerTool(tool);
  }

  setStatus("ready — tools registered against document.modelContext", "ok");

  // --- dynamic register/unregister controls, for live tool-list updates ---
  const counterEl = document.getElementById("dynamic-counter") as HTMLElement;
  const registerBtn = document.getElementById("register-dynamic") as HTMLButtonElement;
  const unregisterBtn = document.getElementById("unregister-dynamic") as HTMLButtonElement;

  let dynamicController: AbortController | null = null;

  registerBtn.addEventListener("click", () => {
    dynamicController = new AbortController();
    registerBtn.disabled = true;
    void registerTool(createDynamicTool(counterEl), dynamicController.signal).then(() => {
      unregisterBtn.disabled = false;
    });
  });
  unregisterBtn.addEventListener("click", () => {
    dynamicController?.abort();
    dynamicController = null;
    forgetTool("dynamic-echo");
    registerBtn.disabled = false;
    unregisterBtn.disabled = true;
  });
}

void main();
