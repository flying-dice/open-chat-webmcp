// Shared DOM plumbing for the demo page (demo/index.html).
//
// The point of this page is to be useful while debugging the extension: it
// shows, in the page itself, exactly what a developer should also see in the
// extension's side panel inspector — the live tool list, and every call with
// its arguments and result. If the two disagree, that's a relay bug.

import type { CallToolResult, ToolAnnotations, ToolDescriptor } from "@mcp-b/webmcp-types";
import type { Fixture } from "./tools";

export type StatusKind = "pending" | "ok" | "error";

export function setStatus(text: string, kind: StatusKind): void {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

// Annotations are exactly `{ readOnlyHint, untrustedContentHint }`
// (decisions/17-spec-annotations-and-untrusted-content.md) — there is no
// `destructiveHint`. The two badges are independent: a tool can be
// read-only AND flagged as returning untrusted content at the same time.
function annotationBadges(annotations?: ToolAnnotations): string {
  const badges: string[] = [];
  if (annotations?.readOnlyHint === true) {
    badges.push('<span class="badge badge-readonly">read-only</span>');
  } else {
    badges.push('<span class="badge badge-mutating">mutating (no hint)</span>');
  }
  if (annotations?.untrustedContentHint === true) {
    badges.push('<span class="badge badge-untrusted">untrusted content</span>');
  }
  return badges.join(" ");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Renders the "currently registered tools" panel from a live registry map.
 * This is the page's own bookkeeping — a developer compares it against what
 * the extension's inspector (or the official model-context-tool-inspector)
 * reports for the same tab. */
export function renderToolsList(tools: Map<string, Fixture>): void {
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
        <div class="tool-desc">${escapeHtml(t.description)}</div>
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
 * logged to the on-page activity log with its arguments and MCP-shaped
 * result (`{ content, isError? }` — decisions/16-native-webmcp-client.md). */
export function withLogging<T extends Fixture>(tool: T): T {
  const rawExecute = tool.execute;
  return {
    ...tool,
    execute: (args: Record<string, unknown>, client) => {
      const pendingId = logPending(tool.name, args);
      try {
        const result = rawExecute(args, client);
        if (result instanceof Promise) {
          return result.then(
            (value) => {
              replacePending(pendingId, { ok: true, result: value as CallToolResult });
              return value;
            },
            (err: unknown) => {
              replacePending(pendingId, { ok: false, error: describeError(err) });
              throw err;
            },
          );
        }
        replacePending(pendingId, { ok: true, result: result as CallToolResult });
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

function replacePending(
  id: number,
  outcome: { ok: true; result: CallToolResult } | { ok: false; error: string },
): void {
  const entry = document.querySelector(`.log-entry[data-id="${id}"] .log-outcome`);
  if (!entry) return;
  if (outcome.ok) {
    const text = outcome.result.content.map((c) => ("text" in c ? c.text : JSON.stringify(c))).join(" ");
    const badge = outcome.result.isError
      ? '<span class="outcome-error">isError</span>'
      : '<span class="outcome-ok">ok</span>';
    entry.innerHTML = `${badge} <code>${escapeHtml(text)}</code>`;
  } else {
    entry.innerHTML = `<span class="outcome-error">threw</span> ${escapeHtml(outcome.error)}`;
  }
}
