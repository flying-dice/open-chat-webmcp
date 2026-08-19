// Shared shapes for the WebMCP demo fixtures.
//
// This file intentionally does NOT import anything from ../../src/lib —
// the demo is a standalone static page the extension is developed against,
// not part of the extension build, and it must not assume anything about
// the bridge's internals. It only assumes the public WebMCP-ish surface
// described in decisions/02-mainworld-webmcp-bridge.md:
//
//   navigator.modelContext.registerTool(descriptor) -> { destroy() }
//   navigator.modelContext.unregisterTool(name)
//   navigator.modelContext.provideContext({ tools })
//   navigator.modelContext.callTool(name, args) -> Promise<result>

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  [key: string]: unknown;
}

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute?: (args: Record<string, unknown>) => unknown;
}

export interface ToolHandle {
  destroy(): void;
}

/** The minimal surface this page depends on. Either the extension's bridge
 * (shim/adopt) or our own fake polyfill (demo/src/fake-polyfill.ts) can
 * satisfy this — the page doesn't know or care which. */
export interface ModelContextLike {
  registerTool(descriptor: ToolDescriptor): ToolHandle;
  unregisterTool(name: string): void;
  provideContext(ctx: { tools: ToolDescriptor[] }): void;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

declare global {
  interface Navigator {
    modelContext?: ModelContextLike;
  }
}
