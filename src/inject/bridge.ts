// MAIN-world WebMCP bridge (decisions/02-mainworld-webmcp-bridge.md).
//
// Runs in the *page's* JS world, injected at document_start via
// `world: "MAIN"` in the manifest. Installs an adopt-or-provide shim on
// `navigator.modelContext`:
//
//   - PROVIDE: nothing is there -> the shim *is* the implementation.
//   - ADOPT:   a native or polyfilled implementation is already there -> the
//              shim records registrations, then forwards them to it.
//   - LATE ADOPT: `navigator.modelContext` is redefined as an accessor whose
//              setter captures a later assignment (e.g. a polyfill script
//              that runs after us), adopts it, and re-emits the tool list.
//
// Everything the page hands us is untrusted: a malformed schema, a throwing
// `execute`, a hung promise, or a non-serialisable result must never take
// this script down or wedge the bridge for other tools.
//
// The bridge only talks to the ISOLATED-world relay (src/content/relay.ts)
// via CustomEvents on `document` (BRIDGE_OUT_EVENT / BRIDGE_IN_EVENT) whose
// `detail` is always a JSON *string* — never a live object/closure, since
// page globals do not cross the world boundary (only DOM events do).

import {
  BRIDGE_IN_EVENT,
  BRIDGE_OUT_EVENT,
  isBridgeInEvent,
  type BridgeCallRequestEvent,
  type BridgeOutEvent,
  type SerializedTool,
  type ToolAnnotations,
  type ToolSource,
} from "../lib/protocol";

// Let TS know about the (non-standard / not-yet-universal) property without
// resorting to `any` anywhere below.
declare global {
  interface Navigator {
    modelContext?: unknown;
  }
  interface Window {
    __webmcpBridgeInstalled?: {
      at: number;
      source: "main-world-bridge";
    };
  }
}

// How long we give a tool's `execute` before we give up on it and report a
// timeout error back through the relay. This is the INNERMOST layer of a
// deliberate 3-layer timeout ladder (call chain: worker -> relay -> bridge):
//
//   src/inject/bridge.ts  EXECUTE_TIMEOUT_MS    = 20_000  (this constant)
//   src/content/relay.ts  RELAY_CALL_TIMEOUT_MS = 25_000
//   src/background/sw.ts  CALL_TIMEOUT_MS       = 30_000  (outermost)
//
// Each outer layer is deliberately longer, with margin, so this timeout —
// the most specific, most useful error — is the one that actually reaches
// the caller instead of being masked by a generic "did not respond in time"
// from further out. verify/run.mjs's "hangs-forever" check hardcodes both
// this exact value (in the expected error text) and an elapsed-time window
// around it, so changing this number requires updating that check too.
const EXECUTE_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Local (page-facing) shapes. These are richer than protocol.ts's
// SerializedTool because they carry the live `execute` closure, which never
// leaves this world.
// ---------------------------------------------------------------------------

interface PageToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute?: (args: Record<string, unknown>) => unknown;
}

interface RegistryEntry {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute?: (args: Record<string, unknown>) => unknown;
  source: ToolSource;
  /** Registered via provideContext() rather than an explicit registerTool() call. */
  declarative: boolean;
  /** Handle returned by the underlying (adopted) implementation, if any. */
  underlyingHandle?: { destroy?: () => void };
}

interface UnderlyingImpl {
  registerTool?: (descriptor: PageToolDescriptor) => unknown;
  unregisterTool?: (name: string) => void;
  provideContext?: (ctx: { tools: PageToolDescriptor[] }) => void;
  callTool?: (name: string, args: Record<string, unknown>) => unknown;
}

interface ToolHandle {
  destroy(): void;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const registry = new Map<string, RegistryEntry>();
let declarativeNames = new Set<string>();

let underlying: UnderlyingImpl | undefined;
let underlyingSource: "native" | "polyfill" | undefined;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isImplementation(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && typeof v.registerTool === "function";
}

/** Best-effort heuristic: Chrome's native binding stringifies as `[native code]`. */
function looksNative(fn: unknown): boolean {
  if (typeof fn !== "function") return false;
  try {
    return /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "Unknown error";
  }
}

/** Strip a value down to something JSON-safe, or `undefined` if it can't be. */
function safeJson<T>(v: unknown): T | undefined {
  if (v === undefined) return undefined;
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return undefined;
    return JSON.parse(s) as T;
  } catch (err) {
    console.warn("[webmcp][bridge] dropping non-JSON-serialisable value", v, err);
    return undefined;
  }
}

function validateToolDescriptor(v: unknown): PageToolDescriptor {
  if (!isRecord(v) || typeof v.name !== "string" || v.name.length === 0) {
    throw new TypeError(
      "WebMCP tool descriptor must be an object with a non-empty string `name`",
    );
  }
  return {
    name: v.name,
    description: typeof v.description === "string" ? v.description : undefined,
    inputSchema: safeJson<Record<string, unknown>>(v.inputSchema),
    annotations: safeJson<ToolAnnotations>(v.annotations),
    execute: typeof v.execute === "function" ? (v.execute as (args: Record<string, unknown>) => unknown) : undefined,
  };
}

function callWithTimeout<T>(factory: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Wording deliberately matches the relay's own backstop message
      // (src/content/relay.ts, "Timed out after Xms ...") so the two read as
      // one family of error and so verify/run.mjs's hardcoded substring
      // check for the bridge's specific error keeps working.
      reject(new Error(`Timed out after ${timeoutMs}ms running the tool.`));
    }, timeoutMs);

    Promise.resolve()
      .then(factory)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(describeError(err)));
      });
  });
}

// ---------------------------------------------------------------------------
// Outgoing events (bridge -> relay)
// ---------------------------------------------------------------------------

function emitOut(event: BridgeOutEvent) {
  let detail: string;
  try {
    detail = JSON.stringify(event);
  } catch (err) {
    console.error("[webmcp][bridge] failed to serialise outgoing event; dropping", event, err);
    return;
  }
  document.dispatchEvent(new CustomEvent(BRIDGE_OUT_EVENT, { detail }));
}

function emitReady() {
  emitOut({ type: "bridge:ready" });
}

function emitTools() {
  const tools: SerializedTool[] = Array.from(registry.values()).map((e) => ({
    name: e.name,
    description: e.description,
    inputSchema: e.inputSchema,
    annotations: e.annotations,
    source: e.source,
  }));
  emitOut({ type: "bridge:tools", tools });
}

// ---------------------------------------------------------------------------
// Registration internals — the single path every registerTool /
// provideContext / late-adopt migration goes through.
// ---------------------------------------------------------------------------

function registerInternal(descriptor: PageToolDescriptor, declarative: boolean): void {
  const entry: RegistryEntry = {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    annotations: descriptor.annotations,
    execute: descriptor.execute,
    source: underlying ? (underlyingSource ?? "polyfill") : "shim",
    declarative,
  };

  if (underlying?.registerTool) {
    try {
      const handle = underlying.registerTool({
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
        annotations: entry.annotations,
        execute: descriptor.execute,
      });
      if (isRecord(handle) && typeof handle.destroy === "function") {
        entry.underlyingHandle = handle as unknown as ToolHandle;
      }
    } catch (err) {
      console.warn(
        `[webmcp][bridge] underlying registerTool("${entry.name}") failed; keeping local registration only`,
        err,
      );
    }
  }

  registry.set(entry.name, entry);
  emitTools();
}

function unregisterInternal(name: string): void {
  const entry = registry.get(name);
  if (!entry) return;
  registry.delete(name);

  if (underlying?.unregisterTool) {
    try {
      underlying.unregisterTool(name);
    } catch (err) {
      console.warn(`[webmcp][bridge] underlying unregisterTool("${name}") failed`, err);
    }
  }
  if (entry.underlyingHandle?.destroy) {
    try {
      entry.underlyingHandle.destroy();
    } catch (err) {
      console.warn(`[webmcp][bridge] underlying handle destroy() for "${name}" failed`, err);
    }
  }

  emitTools();
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const entry = registry.get(name);
  if (entry?.execute) {
    return callWithTimeout(() => entry.execute!(args), EXECUTE_TIMEOUT_MS);
  }
  if (underlying?.callTool) {
    const fn = underlying.callTool;
    return callWithTimeout(() => fn(name, args), EXECUTE_TIMEOUT_MS);
  }
  throw new Error(`Unknown tool: "${name}"`);
}

// ---------------------------------------------------------------------------
// Adopt-or-provide
// ---------------------------------------------------------------------------

/** Adopt `candidate` as the underlying implementation, forwarding any tools
 * we were holding locally (provide-mode registrations) into it. */
function adopt(candidate: unknown): void {
  if (!isImplementation(candidate)) {
    console.warn(
      "[webmcp][bridge] ignoring navigator.modelContext assignment: not a usable implementation",
      candidate,
    );
    return;
  }

  const obj = candidate;
  const bind = <F>(fn: unknown): F | undefined => {
    if (typeof fn !== "function") return undefined;
    try {
      return fn.bind(obj) as F;
    } catch {
      return undefined;
    }
  };

  // Snapshot bound references to the *original* methods now, rather than
  // holding `obj` itself — if we later have to patch methods in place on
  // this same object (see patchInPlace), reading through a live reference
  // to `obj.registerTool` etc. would recurse into our own patched wrapper.
  underlying = {
    registerTool: bind(obj.registerTool),
    unregisterTool: bind(obj.unregisterTool),
    provideContext: bind(obj.provideContext),
    callTool: bind(obj.callTool),
  };
  underlyingSource = looksNative(obj.registerTool) ? "native" : "polyfill";

  // Migrate anything we were holding as the provider so far into the newly
  // adopted implementation, and reclassify it accordingly.
  for (const entry of registry.values()) {
    if (entry.source !== "shim") continue;
    if (underlying.registerTool) {
      try {
        const handle = underlying.registerTool({
          name: entry.name,
          description: entry.description,
          inputSchema: entry.inputSchema,
          annotations: entry.annotations,
          execute: entry.execute,
        });
        if (isRecord(handle) && typeof handle.destroy === "function") {
          entry.underlyingHandle = handle as unknown as ToolHandle;
        }
      } catch (err) {
        console.warn(
          `[webmcp][bridge] failed to migrate tool "${entry.name}" into newly-adopted implementation`,
          err,
        );
      }
    }
    entry.source = underlyingSource;
  }

  emitTools();
}

function tryDefineAccessor(): boolean {
  try {
    Object.defineProperty(navigator, "modelContext", {
      configurable: true,
      enumerable: true,
      get() {
        return shim;
      },
      set(value: unknown) {
        adopt(value);
      },
    });
    return true;
  } catch (err) {
    console.warn("[webmcp][bridge] could not redefine navigator.modelContext as an accessor", err);
    return false;
  }
}

/** Fallback used only when the property could not be redefined (e.g. a
 * non-configurable native descriptor). We patch the existing object's own
 * methods so registrations still funnel through us. NOTE: late reassignment
 * of `navigator.modelContext` cannot be captured in this fallback path,
 * because we never got to install the accessor's setter. */
function patchInPlace(existing: Record<string, unknown>): void {
  try {
    existing.registerTool = (descriptor: unknown) => shim.registerTool(descriptor);
    existing.unregisterTool = (name: unknown) => shim.unregisterTool(name);
    existing.provideContext = (ctx: unknown) => shim.provideContext(ctx);
    existing.callTool = (name: unknown, args?: unknown) => shim.callTool(name, args);
    console.warn(
      "[webmcp][bridge] navigator.modelContext was not configurable; patched its methods in place. " +
        "Late reassignment of navigator.modelContext will NOT be captured in this mode.",
    );
  } catch (err) {
    console.error(
      "[webmcp][bridge] could not patch navigator.modelContext methods in place; bridge cannot observe this page's tools",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// The shim itself — this is what `navigator.modelContext` resolves to from
// here on, for every page script, forever (barring the patch-in-place
// fallback above).
// ---------------------------------------------------------------------------

const shim = {
  registerTool(descriptor: unknown): ToolHandle {
    const d = validateToolDescriptor(descriptor);
    registerInternal(d, false);
    return {
      destroy() {
        unregisterInternal(d.name);
      },
    };
  },

  unregisterTool(name: unknown): void {
    if (typeof name !== "string") return;
    unregisterInternal(name);
  },

  provideContext(ctx: unknown): void {
    const rawTools =
      isRecord(ctx) && Array.isArray((ctx as { tools?: unknown }).tools)
        ? (ctx as { tools: unknown[] }).tools
        : [];

    const validTools: PageToolDescriptor[] = [];
    for (const t of rawTools) {
      try {
        validTools.push(validateToolDescriptor(t));
      } catch (err) {
        console.warn("[webmcp][bridge] provideContext: skipping invalid tool descriptor", t, err);
      }
    }

    const newNames = new Set(validTools.map((t) => t.name));
    for (const name of declarativeNames) {
      if (!newNames.has(name)) unregisterInternal(name);
    }
    declarativeNames = newNames;
    for (const d of validTools) registerInternal(d, true);
  },

  callTool(name: unknown, args?: unknown): Promise<unknown> {
    if (typeof name !== "string" || name.length === 0) {
      return Promise.reject(new TypeError("callTool: name must be a non-empty string"));
    }
    const callArgs = isRecord(args) ? args : {};
    return executeTool(name, callArgs);
  },
};

// ---------------------------------------------------------------------------
// Incoming events (relay -> bridge)
// ---------------------------------------------------------------------------

async function handleCallRequest(req: BridgeCallRequestEvent): Promise<void> {
  try {
    const result = await executeTool(req.name, isRecord(req.args) ? req.args : {});
    const serialisable = safeJson<unknown>(result);
    if (result !== undefined && serialisable === undefined) {
      emitOut({
        type: "bridge:call-result",
        id: req.id,
        ok: false,
        error:
          "Tool result could not be serialised (it contains functions, circular references, or other non-JSON values).",
      });
      return;
    }
    emitOut({ type: "bridge:call-result", id: req.id, ok: true, result: serialisable });
  } catch (err) {
    emitOut({ type: "bridge:call-result", id: req.id, ok: false, error: describeError(err) });
  }
}

document.addEventListener(BRIDGE_IN_EVENT, (evt) => {
  const raw = (evt as CustomEvent<unknown>).detail;
  if (typeof raw !== "string") return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn("[webmcp][bridge] ignoring malformed bridge:in payload", err);
    return;
  }
  if (!isBridgeInEvent(parsed)) return;

  switch (parsed.type) {
    case "bridge:call-request":
      void handleCallRequest(parsed);
      break;
    case "bridge:get-tools":
      emitTools();
      break;
    default: {
      const _exhaustive: never = parsed;
      void _exhaustive;
    }
  }
});

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

function currentDescriptorValue(): unknown {
  try {
    return navigator.modelContext;
  } catch {
    return undefined;
  }
}

function install(): void {
  const existing = currentDescriptorValue();
  if (isImplementation(existing)) {
    adopt(existing);
  }

  const defined = tryDefineAccessor();
  if (!defined && isImplementation(existing)) {
    patchInPlace(existing);
  } else if (!defined) {
    console.error(
      "[webmcp][bridge] navigator.modelContext could not be installed as an accessor and there is no " +
        "existing implementation to patch; the bridge is inert on this page.",
    );
  }

  window.__webmcpBridgeInstalled = { at: Date.now(), source: "main-world-bridge" };

  emitReady();
  emitTools();
}

install();

export {};
