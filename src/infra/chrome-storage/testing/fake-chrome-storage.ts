// Test-only in-memory `chrome.storage` fake (card 83,
// decisions/30-vitest-test-pyramid.md).
//
// Every repository in src/infra/chrome-storage goes through
// `StorageAreaGateway` (../area.ts), which is the ONLY thing this fake needs
// to stand in for: `chrome.storage.sync`/`.local`'s promise-form `get`/
// `set`/`remove`, plus `chrome.storage.onChanged`. Recreates the 33 ad-hoc
// Node assertions card 74's journal describes as one committed, reusable
// helper rather than one-off fakes per test file.
//
// Never imported by production code — only by `*.test.ts` files, which are
// excluded outright from both `npm run guard:boundaries` (dependency-cruiser
// only scans production edges; the exclude list also drops `\.test\.ts$`
// entirely) and `scripts/guard-boundaries.mjs` (scoped to `src/domain` only).
// This file itself is real, non-test-suffixed TypeScript living in a tech
// folder, so it is still typechecked by `npm run check` — everything below
// is written to satisfy that, not just to compile inside a test.
//
// Deliberately reimplements the promise form only (never the callback form
// with `chrome.runtime.lastError`): ../area.ts's own header explains why —
// "catching the rejection IS catching lastError" — so a fake that rejects a
// promise on `failNext` is faithful to what a repository actually observes.

import { vi } from "vitest";

export type FakeStorageOp = "get" | "set" | "remove";

/**
 * One `chrome.storage` area's raw key/value map, plus the test-only controls
 * this suite needs: seeding, reading the exact bytes back out (used to prove
 * a credential never reaches the `sync` map — see
 * ../../provider-registry.test.ts and ../../mcp-server-registry.test.ts), and
 * injecting a rejection that stands in for a quota `DOMException` or a
 * `chrome.runtime.lastError`-driven rejection on the NEXT matching call.
 */
export interface FakeStorageArea {
  /** Exact current contents — not a copy of what a repository decoded, the literal stored value. */
  raw(): Record<string, unknown>;
  /** Seed the area directly, bypassing `set` (and any injected failure/notification). */
  seed(data: Record<string, unknown>): void;
  /** The next call to `op` rejects with `error` instead of running; consumed after firing once. */
  failNext(op: FakeStorageOp, error: Error): void;
  /** Convenience for `failNext("set", ...)` with a message ../area.ts's `classify()` recognises as quota exhaustion. */
  failNextSetWithQuotaExceeded(): void;
  /** Total calls made to `op` so far — e.g. for asserting a debounced write landed once, not once per keystroke. */
  callCount(op: FakeStorageOp): number;
}

export interface FakeChromeStorage {
  /** Cast-ready stand-in for the global `chrome` object — install with `vi.stubGlobal("chrome", fake.chrome)`, or use {@link installFakeChromeStorage}. */
  chrome: typeof chrome;
  sync: FakeStorageArea;
  local: FakeStorageArea;
}

interface PendingFailure {
  op: FakeStorageOp;
  error: Error;
}

type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
) => void;

function createArea(notify: (changes: Record<string, chrome.storage.StorageChange>) => void): {
  area: FakeStorageArea;
  api: chrome.storage.StorageArea;
} {
  const data = new Map<string, unknown>();
  const pending: PendingFailure[] = [];
  const counts: Record<FakeStorageOp, number> = { get: 0, set: 0, remove: 0 };

  function takeFailure(op: FakeStorageOp): Error | undefined {
    const index = pending.findIndex((p) => p.op === op);
    if (index === -1) return undefined;
    // splice(index, 1) with a valid index always returns a one-element array.
    return pending.splice(index, 1)[0]!.error;
  }

  async function get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    counts.get++;
    const failure = takeFailure("get");
    if (failure) throw failure;

    if (keys === null || keys === undefined) {
      return Object.fromEntries(data.entries());
    }
    const keyList =
      typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out: Record<string, unknown> = {};
    for (const key of keyList) {
      if (data.has(key)) out[key] = data.get(key);
    }
    return out;
  }

  async function set(items: Record<string, unknown>): Promise<void> {
    counts.set++;
    const failure = takeFailure("set");
    if (failure) throw failure;

    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: data.get(key), newValue: value };
      data.set(key, value);
    }
    notify(changes);
  }

  async function remove(keys: string | string[]): Promise<void> {
    counts.remove++;
    const failure = takeFailure("remove");
    if (failure) throw failure;

    const keyList = typeof keys === "string" ? [keys] : keys;
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const key of keyList) {
      if (data.has(key)) {
        changes[key] = { oldValue: data.get(key), newValue: undefined };
        data.delete(key);
      }
    }
    if (Object.keys(changes).length > 0) notify(changes);
  }

  // Cast rather than a structurally-complete `chrome.storage.StorageArea` —
  // every repository in this folder only ever calls `get`/`set`/`remove`
  // (../area.ts's `StorageAreaGateway` is deliberately just as thin), so
  // implementing `clear`/`getBytesInUse`/`setAccessLevel`/the per-area
  // `onChanged` MV3 also declares would be dead weight no test exercises.
  const api = { get, set, remove } as unknown as chrome.storage.StorageArea;

  const area: FakeStorageArea = {
    raw: () => Object.fromEntries(data.entries()),
    seed: (seedData) => {
      for (const [key, value] of Object.entries(seedData)) data.set(key, value);
    },
    failNext: (op, error) => pending.push({ op, error }),
    failNextSetWithQuotaExceeded: () =>
      pending.push({ op: "set", error: new Error("QUOTA_BYTES quota exceeded") }),
    callCount: (op) => counts[op],
  };

  return { area, api };
}

/** Build a fresh fake — independent `sync`/`local` maps, its own `onChanged` listener set. */
export function createFakeChromeStorage(): FakeChromeStorage {
  const listeners = new Set<ChangeListener>();

  const { area: sync, api: syncApi } = createArea((changes) => {
    for (const listener of listeners) listener(changes, "sync");
  });
  const { area: local, api: localApi } = createArea((changes) => {
    for (const listener of listeners) listener(changes, "local");
  });

  const fakeChrome = {
    storage: {
      sync: syncApi,
      local: localApi,
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.add(listener),
        removeListener: (listener: ChangeListener) => listeners.delete(listener),
      },
    },
    runtime: {
      // ../../ollama/client.ts's `ownExtensionOrigin()` reads this to build
      // its 403/origin-rejection message's "consider narrowing the wildcard
      // to just this extension" suggestion.
      id: "fake-extension-id",
    },
  } as unknown as typeof chrome;

  return { chrome: fakeChrome, sync, local };
}

/** {@link createFakeChromeStorage} plus installing it as `globalThis.chrome` via `vi.stubGlobal` — `vi.unstubAllGlobals()` in an `afterEach` undoes it. */
export function installFakeChromeStorage(): FakeChromeStorage {
  const fake = createFakeChromeStorage();
  vi.stubGlobal("chrome", fake.chrome);
  return fake;
}
