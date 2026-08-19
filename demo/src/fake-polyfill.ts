// A tiny stand-in for @mcp-b/global (or any other WebMCP polyfill).
//
// We don't add a real npm dependency for this — the demo card only needs to
// prove that the extension's bridge correctly captures a LATE assignment to
// `navigator.modelContext` (decisions/02-mainworld-webmcp-bridge.md, "late
// adoption"). A real polyfill's job is exactly this: construct an
// implementation and assign it to `navigator.modelContext`, typically from a
// script that runs after the page's own inline scripts. `demo/late.html`
// loads *this* module dynamically, well after page load, and does that same
// assignment — see demo/src/late-main.ts.
//
// This class deliberately implements nothing beyond the public surface in
// types.ts: it is a page-world tool registry, not a WebMCP implementation of
// record. It has no idea whether a bridge is wrapping it or not.

import type { ModelContextLike, ToolDescriptor, ToolHandle } from "./types";

export class FakeModelContextPolyfill implements ModelContextLike {
  private readonly tools = new Map<string, ToolDescriptor>();
  private declarativeNames = new Set<string>();

  registerTool(descriptor: ToolDescriptor): ToolHandle {
    if (!descriptor || typeof descriptor.name !== "string" || descriptor.name.length === 0) {
      throw new TypeError("registerTool: descriptor.name must be a non-empty string");
    }
    this.tools.set(descriptor.name, descriptor);
    this.notify();
    return {
      destroy: () => {
        this.tools.delete(descriptor.name);
        this.notify();
      },
    };
  }

  unregisterTool(name: string): void {
    if (this.tools.delete(name)) this.notify();
  }

  provideContext(ctx: { tools: ToolDescriptor[] }): void {
    const next = Array.isArray(ctx?.tools) ? ctx.tools : [];
    const nextNames = new Set(next.map((t) => t.name));
    for (const name of this.declarativeNames) {
      if (!nextNames.has(name)) this.tools.delete(name);
    }
    this.declarativeNames = nextNames;
    for (const t of next) this.tools.set(t.name, t);
    this.notify();
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool?.execute) throw new Error(`FakeModelContextPolyfill: unknown tool "${name}"`);
    return tool.execute(args);
  }

  private notify(): void {
    window.dispatchEvent(
      new CustomEvent("fake-polyfill:tools-changed", { detail: Array.from(this.tools.keys()) }),
    );
  }
}
