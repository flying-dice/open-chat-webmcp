// Variant 1 — "shim / native discovery" (decisions/02-mainworld-webmcp-bridge.md).
//
// This page does the boring, correct thing a real WebMCP site does: it
// feature-detects `navigator.modelContext` and calls `registerTool` on
// whatever it finds there. If the extension is loaded, its MAIN-world bridge
// runs at document_start — before this module ever executes — and has
// already either provided a shim (nothing was there) or adopted whatever
// was. This page never assigns navigator.modelContext itself; that's what
// late.html is for.

import type { ToolDescriptor, ToolHandle } from "./types";
import { createDemoTools, createDynamicTool } from "./tools";
import { renderToolsList, setStatus, withLogging } from "./ui";

const registered = new Map<string, ToolDescriptor>();
const handles = new Map<string, ToolHandle>();

function registerTool(tool: ToolDescriptor): void {
  const handle = navigator.modelContext!.registerTool(withLogging(tool));
  registered.set(tool.name, tool);
  handles.set(tool.name, handle);
  renderToolsList(registered);
}

function unregisterTool(name: string): void {
  handles.get(name)?.destroy();
  handles.delete(name);
  registered.delete(name);
  renderToolsList(registered);
}

function waitForModelContext(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (navigator.modelContext) {
        resolve(true);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function main(): Promise<void> {
  setStatus("checking navigator.modelContext…", "pending");

  const found = await waitForModelContext(5000);
  if (!found) {
    setStatus(
      "navigator.modelContext not found — install/enable the extension, then reload this page.",
      "error",
    );
    return;
  }

  setStatus("navigator.modelContext found — registering demo tools…", "pending");

  const notesEl = document.getElementById("notes-list") as HTMLUListElement;
  const tasksEl = document.getElementById("tasks-list") as HTMLUListElement;
  for (const tool of createDemoTools({ notesEl, tasksEl })) {
    registerTool(tool);
  }

  setStatus("ready — tools registered against navigator.modelContext", "ok");

  // --- dynamic register/unregister controls, for live tool-list updates ---
  const counterEl = document.getElementById("dynamic-counter") as HTMLElement;
  const registerBtn = document.getElementById("register-dynamic") as HTMLButtonElement;
  const unregisterBtn = document.getElementById("unregister-dynamic") as HTMLButtonElement;

  registerBtn.addEventListener("click", () => {
    registerTool(createDynamicTool(counterEl));
    registerBtn.disabled = true;
    unregisterBtn.disabled = false;
  });
  unregisterBtn.addEventListener("click", () => {
    unregisterTool("dynamic-echo");
    registerBtn.disabled = false;
    unregisterBtn.disabled = true;
  });
}

void main();
