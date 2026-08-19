// The demo tool set, shared by both variants (index.html registers these
// immediately; late.html registers the same set against a fake polyfill
// assigned after page load). Covers every case
// boards/project-backlog/15-webmcp-demo-page.md asks for:
//
//   - read-page-state   readOnlyHint: true, reads visible page state
//   - add-note          mutating, visibly changes the DOM
//   - clear-notes       destructiveHint: true
//   - create-task       rich input schema: enum, nested object, required
//   - always-throws     throws, for error-path testing
//   - hangs-forever     never resolves, for timeout-path testing
//
// (Dynamic register/unregister of an extra tool at runtime lives in
// main.ts/late-main.ts, since it's driven by page buttons rather than being
// part of the fixed set registered on load.)

import type { ToolDescriptor } from "./types";

export interface DemoPageState {
  notesEl: HTMLUListElement;
  tasksEl: HTMLUListElement;
}

let taskSeq = 0;

/** Removes the static "no X yet" placeholder <li> the HTML ships with, the
 * first time a tool actually adds something real to that list. */
function clearPlaceholder(list: HTMLUListElement): void {
  list.querySelector("li.empty")?.remove();
}

export function createDemoTools(state: DemoPageState): ToolDescriptor[] {
  const { notesEl, tasksEl } = state;

  const readPageState: ToolDescriptor = {
    name: "read-page-state",
    description: "Read the demo page's currently visible state (title, URL, note count, task count).",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => ({
      title: document.title,
      url: location.href,
      noteCount: notesEl.querySelectorAll("li:not(.empty)").length,
      taskCount: tasksEl.querySelectorAll("li:not(.empty)").length,
      timestamp: new Date().toISOString(),
    }),
  };

  const addNote: ToolDescriptor = {
    name: "add-note",
    description: "Append a visible note to the page's note list. Mutates the DOM so a human can see the model act.",
    // No annotations at all -> treated as mutating per decisions/05-tool-approval-policy.md.
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Note text to display" } },
      required: ["text"],
      additionalProperties: false,
    },
    execute: (args) => {
      const text = typeof args.text === "string" && args.text.length > 0 ? args.text : "(empty note)";
      clearPlaceholder(notesEl);
      const li = document.createElement("li");
      li.textContent = text;
      notesEl.appendChild(li);
      return { added: text, totalNotes: notesEl.children.length };
    },
  };

  const clearNotes: ToolDescriptor = {
    name: "clear-notes",
    description: "Delete every note from the page. Irreversible — exercises the destructive-hint approval path.",
    annotations: { destructiveHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const removed = notesEl.querySelectorAll("li:not(.empty)").length;
      notesEl.innerHTML = '<li class="empty">No notes yet.</li>';
      return { removed };
    },
  };

  const createTask: ToolDescriptor = {
    name: "create-task",
    description:
      "Create a task with a priority and an assignee. Demonstrates a rich input schema (enum, nested object, required fields).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Task priority" },
        assignee: {
          type: "object",
          description: "Who the task is assigned to",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
          },
          required: ["name"],
          additionalProperties: false,
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional free-form labels",
        },
      },
      required: ["title", "priority", "assignee"],
      additionalProperties: false,
    },
    execute: (args) => {
      const title = typeof args.title === "string" ? args.title : "(untitled)";
      const priority = typeof args.priority === "string" ? args.priority : "medium";
      const assignee =
        typeof args.assignee === "object" && args.assignee !== null
          ? (args.assignee as Record<string, unknown>)
          : {};
      const assigneeName = typeof assignee.name === "string" ? assignee.name : "unassigned";
      const id = ++taskSeq;

      clearPlaceholder(tasksEl);
      const li = document.createElement("li");
      li.className = `task task-${priority}`;
      li.dataset.taskId = String(id);
      li.textContent = `#${id} [${priority}] ${title} — ${assigneeName}`;
      tasksEl.appendChild(li);

      return { id, title, priority, assignee: assigneeName };
    },
  };

  const alwaysThrows: ToolDescriptor = {
    name: "always-throws",
    description: "Always throws. Exercises the extension's tool-call error handling.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      throw new Error("Deliberate failure from the always-throws demo tool");
    },
  };

  const hangsForever: ToolDescriptor = {
    name: "hangs-forever",
    description: "Never resolves. Exercises the extension's tool-call timeout handling.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => new Promise<never>(() => {}),
  };

  return [readPageState, addNote, clearNotes, createTask, alwaysThrows, hangsForever];
}

/** The extra tool used to demonstrate live register/unregister at runtime,
 * toggled by a button rather than registered on load. */
export function createDynamicTool(counterEl: HTMLElement): ToolDescriptor {
  return {
    name: "dynamic-echo",
    description: "Registered/unregistered at runtime via the page's controls, to test live tool-list updates.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", description: "Message to echo back" } },
      additionalProperties: false,
    },
    execute: (args) => {
      counterEl.textContent = String(Number(counterEl.textContent ?? "0") + 1);
      return { echo: typeof args.message === "string" ? args.message : null, calls: counterEl.textContent };
    },
  };
}
