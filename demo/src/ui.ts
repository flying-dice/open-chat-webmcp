// Shared DOM plumbing for both demo variants (index.html and late.html).
//
// The point of this page is to be useful while debugging the extension: it
// shows, in the page itself, exactly what a developer should also see in the
// extension's side panel inspector — the live tool list, and every call with
// its arguments and result. If the two disagree, that's a bridge bug.

import type { ToolAnnotations, ToolDescriptor } from "./types";

export type StatusKind = "pending" | "ok" | "error";

export function setStatus(text: string, kind: StatusKind): void {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

function annotationBadges(annotations?: ToolAnnotations): string {
  const badges: string[] = [];
  if (annotations?.readOnlyHint === true) badges.push('<span class="badge badge-readonly">read-only</span>');
  if (annotations?.destructiveHint === true) badges.push('<span class="badge badge-destructive">destructive</span>');
  if (!annotations || (annotations.readOnlyHint !== true && annotations.destructiveHint !== true)) {
    badges.push('<span class="badge badge-mutating">mutating (no hint)</span>');
  }
  return badges.join(" ");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Renders the "currently registered tools" panel from a live registry map.
 * This is the page's own bookkeeping — a developer compares it against what
 * the extension's inspector reports for the same tab. */
export function renderToolsList(tools: Map<string, ToolDescriptor>): void {
  const el = document.getElementById("tools-list");
  if (!el) return;
  if (tools.size === 0) {
    el.innerHTML = '<li class="empty">No tools registered.</li>';
    return;
  }
  el.innerHTML = Array.from(tools.values())
    .map(
      (t) => `
      <li>
        <div class="tool-row">
          <code class="tool-name">${escapeHtml(t.name)}</code>
          ${annotationBadges(t.annotations)}
        </div>
        <div class="tool-desc">${escapeHtml(t.description ?? "")}</div>
      </li>`,
    )
    .join("");
}

let logSeq = 0;

/** Logs the moment a call was made, before its outcome is known — useful for
 * the hanging tool, which never reaches logInvocation's outcome branch. */
export function logPending(name: string, args: unknown): number {
  const el = document.getElementById("log");
  const id = ++logSeq;
  if (!el) return id;
  const time = new Date().toLocaleTimeString();
  const argsJson = escapeHtml(JSON.stringify(args ?? {}, null, 0));
  const entry = document.createElement("li");
  entry.className = "log-entry";
  entry.dataset.id = String(id);
  entry.innerHTML = `
    <div class="log-head"><code>${escapeHtml(name)}</code><span class="log-time">${time}</span></div>
    <div class="log-args">args: <code>${argsJson}</code></div>
    <div class="log-outcome"><span class="outcome-pending">pending…</span></div>
  `;
  el.prepend(entry);
  return id;
}

/** Wraps a tool's execute() so every call — success, throw, or hang — is
 * logged to the on-page activity log with its arguments and result. */
export function withLogging(tool: ToolDescriptor): ToolDescriptor {
  const rawExecute = tool.execute;
  if (!rawExecute) return tool;
  return {
    ...tool,
    execute: (args: Record<string, unknown>) => {
      const pendingId = logPending(tool.name, args);
      try {
        const result = rawExecute(args);
        if (result instanceof Promise) {
          return result.then(
            (value) => {
              replacePending(pendingId, { ok: true, result: value });
              return value;
            },
            (err: unknown) => {
              replacePending(pendingId, { ok: false, error: describeError(err) });
              throw err;
            },
          );
        }
        replacePending(pendingId, { ok: true, result });
        return result;
      } catch (err) {
        replacePending(pendingId, { ok: false, error: describeError(err) });
        throw err;
      }
    },
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function replacePending(id: number, outcome: { ok: true; result: unknown } | { ok: false; error: string }): void {
  const entry = document.querySelector(`.log-entry[data-id="${id}"] .log-outcome`);
  if (!entry) return;
  entry.innerHTML = outcome.ok
    ? `<span class="outcome-ok">ok</span> <code>${escapeHtml(JSON.stringify(outcome.result))}</code>`
    : `<span class="outcome-error">error</span> ${escapeHtml(outcome.error)}`;
}
