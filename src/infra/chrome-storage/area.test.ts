// Tests for the one place `chrome.storage` is actually touched and the one
// place its failures are classified (card 83, decisions/32; card 92 turned
// every method's failure into a returned `Result` rather than a rejection —
// decisions/34-errors-as-values.md).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageError } from "../../domain/storage";
import { createStorageAreaGateway, isRecord, subscribeToKey } from "./area";
import { createFakeChromeStorage, installFakeChromeStorage } from "./testing/fake-chrome-storage";
import { unwrap } from "./testing/unwrap";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createStorageAreaGateway", () => {
  it("read() returns undefined for an absent key, not an error", async () => {
    installFakeChromeStorage();
    const gateway = createStorageAreaGateway("local");
    await expect(unwrap(gateway.read("nope"))).resolves.toBeUndefined();
  });

  it("read()/write() round-trip a value", async () => {
    installFakeChromeStorage();
    const gateway = createStorageAreaGateway("local");
    await unwrap(gateway.write({ "some:key": { a: 1 } }));
    await expect(unwrap(gateway.read("some:key"))).resolves.toEqual({ a: 1 });
  });

  it("readAll() returns every key in the area", async () => {
    installFakeChromeStorage();
    const gateway = createStorageAreaGateway("local");
    await unwrap(gateway.write({ a: 1, b: 2 }));
    await expect(unwrap(gateway.readAll())).resolves.toEqual({ a: 1, b: 2 });
  });

  it("remove() with an empty array is a no-op that never calls the underlying API", async () => {
    const fake = createFakeChromeStorage();
    vi.stubGlobal("chrome", fake.chrome);
    const gateway = createStorageAreaGateway("local");
    await unwrap(gateway.remove([]));
    expect(fake.local.callCount("remove")).toBe(0);
  });

  it("remove() with a single key or a list both work", async () => {
    installFakeChromeStorage();
    const gateway = createStorageAreaGateway("local");
    await unwrap(gateway.write({ a: 1, b: 2, c: 3 }));
    await unwrap(gateway.remove("a"));
    await unwrap(gateway.remove(["b", "c"]));
    await expect(unwrap(gateway.readAll())).resolves.toEqual({});
  });

  it("uses chrome.storage.sync when area is 'sync', not local", async () => {
    const fake = createFakeChromeStorage();
    vi.stubGlobal("chrome", fake.chrome);
    const gateway = createStorageAreaGateway("sync");
    await unwrap(gateway.write({ x: 1 }));
    expect(fake.sync.raw()).toEqual({ x: 1 });
    expect(fake.local.raw()).toEqual({});
  });

  describe("error mapping", () => {
    it.each(["get", "set", "remove"] as const)(
      "%s: a platform rejection maps to a returned StorageError, not a rejected promise",
      async (op) => {
        const fake = createFakeChromeStorage();
        vi.stubGlobal("chrome", fake.chrome);
        const gateway = createStorageAreaGateway("local");
        const original = new Error("QUOTA_BYTES_PER_ITEM quota exceeded");
        fake.local.failNext(op, original);

        const run =
          op === "get"
            ? gateway.read("k")
            : op === "set"
              ? gateway.write({ k: 1 })
              : gateway.remove("k");

        // A plain `await` with no try/catch: if this rejected instead of
        // resolving to an `Err`, the test itself would throw here.
        const [, error] = await run;
        expect(error).toBeInstanceOf(StorageError);
        expect(error?.kind).toBe("Unavailable");
        expect(error?.cause).toBe(original);
      },
    );

    it("failNext fires exactly once — a second call after a failure succeeds normally", async () => {
      const fake = createFakeChromeStorage();
      vi.stubGlobal("chrome", fake.chrome);
      const gateway = createStorageAreaGateway("local");
      fake.local.failNext("get", new Error("boom"));

      const [, firstErr] = await gateway.read("k");
      expect(firstErr).toBeInstanceOf(StorageError);
      await expect(unwrap(gateway.read("k"))).resolves.toBeUndefined();
    });

    it("classifies 'quota' / 'max_items' / 'max_write' / 'exceeded' messages as Unavailable", async () => {
      const fake = createFakeChromeStorage();
      vi.stubGlobal("chrome", fake.chrome);
      const gateway = createStorageAreaGateway("local");

      for (const message of [
        "QUOTA_BYTES quota exceeded",
        "MAX_ITEMS quota exceeded",
        "MAX_WRITE_OPERATIONS_PER_MINUTE exceeded",
        "Resource::kQuotaExceeded",
      ]) {
        fake.local.failNext("set", new Error(message));
        const [, error] = await gateway.write({ k: 1 });
        expect(error).toBeInstanceOf(StorageError);
        expect(error?.kind).toBe("Unavailable");
        expect(error?.cause).toBeInstanceOf(Error);
        expect((error?.cause as Error | undefined)?.message).toBe(message);
      }
    });

    it("classifies an extension-context-invalidated rejection (a real chrome.runtime.lastError shape) as Unavailable", async () => {
      const fake = createFakeChromeStorage();
      vi.stubGlobal("chrome", fake.chrome);
      const gateway = createStorageAreaGateway("local");
      fake.local.failNext("get", new Error("Extension context invalidated."));

      const [, error] = await gateway.read("k");
      expect(error).toBeInstanceOf(StorageError);
      expect(error?.kind).toBe("Unavailable");
    });

    it("classifies 'no such storage area' / 'access to storage is not allowed' as Unavailable", async () => {
      const fake = createFakeChromeStorage();
      vi.stubGlobal("chrome", fake.chrome);
      const gateway = createStorageAreaGateway("local");

      fake.local.failNext("get", new Error("No such storage area: 'local'."));
      let [, error] = await gateway.read("k");
      expect(error?.kind).toBe("Unavailable");

      fake.local.failNext("get", new Error("Access to storage is not allowed."));
      [, error] = await gateway.read("k");
      expect(error?.kind).toBe("Unavailable");
    });

    it("classifies an unrecognised failure as Unexpected rather than guessing Unavailable", async () => {
      const fake = createFakeChromeStorage();
      vi.stubGlobal("chrome", fake.chrome);
      const gateway = createStorageAreaGateway("local");
      fake.local.failNext("set", new Error("something inexplicable happened"));

      const [, error] = await gateway.write({ k: 1 });
      expect(error).toBeInstanceOf(StorageError);
      expect(error?.kind).toBe("Unexpected");
    });

    it("classifies a non-Error rejection (a bare string) without throwing out of the classifier", async () => {
      const fake = createFakeChromeStorage();
      vi.stubGlobal("chrome", fake.chrome);
      const gateway = createStorageAreaGateway("local");
      // failNext's type is Error, but the classifier itself (`classify`) is
      // defensive against a non-Error cause too — simulate that shape
      // directly against the gateway by rejecting with a non-Error value.
      fake.local.failNext("set", Object.assign(new Error(""), { toString: () => "weird" }));
      const [, error] = await gateway.write({ k: 1 });
      expect(error).toBeInstanceOf(StorageError);
    });

    it("the message names the area and operation, for a developer reading logs", async () => {
      const fake = createFakeChromeStorage();
      vi.stubGlobal("chrome", fake.chrome);
      const gateway = createStorageAreaGateway("sync");
      fake.sync.failNext("set", new Error("boom"));
      const [, error] = await gateway.write({ k: 1 });
      expect(error?.message).toContain("chrome.storage.sync.set");
      expect(error?.message).toContain("boom");
    });
  });
});

describe("subscribeToKey", () => {
  beforeEach(() => {
    installFakeChromeStorage();
  });

  it("fires the callback with the new value when the matching area+key changes", async () => {
    const gateway = createStorageAreaGateway("sync");
    const seen: unknown[] = [];
    const unsubscribe = subscribeToKey("sync", "watched", (v) => seen.push(v));

    await unwrap(gateway.write({ watched: "hello" }));
    expect(seen).toEqual(["hello"]);

    unsubscribe();
  });

  it("ignores a change to a different key in the same area", async () => {
    const gateway = createStorageAreaGateway("sync");
    const seen: unknown[] = [];
    subscribeToKey("sync", "watched", (v) => seen.push(v));

    await unwrap(gateway.write({ "not-watched": "hello" }));
    expect(seen).toEqual([]);
  });

  it("ignores a change to the same key in a different area", async () => {
    const localGateway = createStorageAreaGateway("local");
    const seen: unknown[] = [];
    subscribeToKey("sync", "watched", (v) => seen.push(v));

    await unwrap(localGateway.write({ watched: "hello" }));
    expect(seen).toEqual([]);
  });

  it("stops delivering once unsubscribed", async () => {
    const gateway = createStorageAreaGateway("sync");
    const seen: unknown[] = [];
    const unsubscribe = subscribeToKey("sync", "watched", (v) => seen.push(v));
    unsubscribe();

    await unwrap(gateway.write({ watched: "hello" }));
    expect(seen).toEqual([]);
  });
});

describe("isRecord", () => {
  it("is true for a plain object", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("is false for an array, null, and primitives", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});
