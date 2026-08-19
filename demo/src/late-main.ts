// Variant 2 — "late-assigned polyfill" (decisions/02-mainworld-webmcp-bridge.md,
// the "late adoption" case).
//
// A real polyfill like @mcp-b/global ships as its own script, which often
// executes after the host page has already loaded — the polyfill's own
// module top-level code does `navigator.modelContext = new ModelContext()`
// whenever it happens to run. If the extension's bridge got there first (the
// common case, since it injects at document_start), it will have redefined
// `navigator.modelContext` as an accessor whose *setter* captures exactly
// this kind of late assignment, adopts the polyfill as the new underlying
// implementation, and re-emits the tool list.
//
// This page proves that path: it does NOT touch navigator.modelContext on
// load. Only when the fake polyfill (demo/src/fake-polyfill.ts) is loaded —
// automatically a couple of seconds after page load, or on demand via the
// button — does the assignment happen, deliberately late and deliberately
// via a dynamic import, to mirror an async <script> tag.

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

let polyfillLoaded = false;

async function loadPolyfillAndRegisterTools(): Promise<void> {
  if (polyfillLoaded) return;
  polyfillLoaded = true;

  const loadBtn = document.getElementById("load-polyfill") as HTMLButtonElement;
  loadBtn.disabled = true;
  loadBtn.textContent = "Loading fake polyfill…";

  // Dynamic import, deliberately after a page-load-shaped delay, so the
  // assignment below happens well after this module (and the DOM) is
  // already live — the same timing shape a real async polyfill script has.
  const { FakeModelContextPolyfill } = await import("./fake-polyfill");

  // THE late assignment. If the extension's bridge is installed, its
  // accessor setter on navigator.modelContext fires right here.
  navigator.modelContext = new FakeModelContextPolyfill();

  loadBtn.textContent = "Fake polyfill loaded";
  setStatus("fake polyfill assigned to navigator.modelContext — registering demo tools…", "pending");

  const notesEl = document.getElementById("notes-list") as HTMLUListElement;
  const tasksEl = document.getElementById("tasks-list") as HTMLUListElement;
  for (const tool of createDemoTools({ notesEl, tasksEl })) {
    registerTool(tool);
  }

  setStatus("ready — tools registered against the late-assigned polyfill", "ok");

  const counterEl = document.getElementById("dynamic-counter") as HTMLElement;
  const registerBtn = document.getElementById("register-dynamic") as HTMLButtonElement;
  const unregisterBtn = document.getElementById("unregister-dynamic") as HTMLButtonElement;
  registerBtn.disabled = false;

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

function main(): void {
  setStatus("navigator.modelContext not assigned yet — waiting to imitate a late-loading polyfill…", "pending");

  const loadBtn = document.getElementById("load-polyfill") as HTMLButtonElement;
  loadBtn.addEventListener("click", () => void loadPolyfillAndRegisterTools());

  // Auto-trigger, like a real polyfill script loaded asynchronously would —
  // give the developer a moment to see the "not assigned yet" state first.
  setTimeout(() => void loadPolyfillAndRegisterTools(), 2000);
}

main();
