// Tests for the tool-capability resolution/presentation policy in
// ./capability.ts (decisions/11-provider-capability-detection.md):
// resolveCapability, resolveCapabilities, isSelectable, reasonForCapability.
// The only fake here is an in-memory ChatProvider — no chrome/fetch/DOM.
import { describe, expect, it } from "vitest";
import {
  isSelectable,
  reasonForCapability,
  resolveCapabilities,
  resolveCapability,
} from "./capability";
import {
  describeProviderError,
  type ChatProvider,
  type ModelCapabilities,
  type ProviderError,
  type ProviderModel,
  type ProviderType,
} from "./provider";
import { fail, ok, type Result } from "../result";

function model(id: string): ProviderModel {
  return { id, name: id };
}

/** A ChatProvider whose getCapabilities is driven by a fixed id -> result table. Every other method is unused by these tests and throws if called. */
function fakeClient(
  responses: Record<string, Result<ModelCapabilities, ProviderError>>,
  type: ProviderType = "ollama",
): ChatProvider {
  return {
    type,
    async listModels() {
      throw new Error("listModels not used in these tests");
    },
    async getCapabilities(queried) {
      const result = responses[queried.id];
      if (!result) throw new Error(`no fixture registered for model "${queried.id}"`);
      return result;
    },
    async *chat() {
      throw new Error("chat not used in these tests");
    },
  };
}

describe("resolveCapability", () => {
  it("returns the resolved capability when the lookup succeeds", async () => {
    const capability: ModelCapabilities = { status: "tool-capable" };
    const client = fakeClient({ llama3: ok(capability) });
    await expect(resolveCapability(client, model("llama3"))).resolves.toEqual(capability);
  });

  it("folds a failed lookup into status 'unknown' carrying the described error as detail", async () => {
    const error: ProviderError = { kind: "http", status: 500, statusText: "Internal Server Error" };
    const client = fakeClient({ llama3: fail(error) });
    await expect(resolveCapability(client, model("llama3"))).resolves.toEqual({
      status: "unknown",
      detail: [describeProviderError(error)],
    });
  });

  it("never treats a failed lookup as tool-capable or no-tools", async () => {
    const error: ProviderError = { kind: "aborted" };
    const client = fakeClient({ m: fail(error) });
    const resolved = await resolveCapability(client, model("m"));
    expect(resolved.status).toBe("unknown");
  });
});

describe("resolveCapabilities", () => {
  it("returns an empty array for an empty model list", async () => {
    const client = fakeClient({});
    await expect(resolveCapabilities(client, [])).resolves.toEqual([]);
  });

  it("resolves every model's capability, pairing each result with its own model", async () => {
    const a: ModelCapabilities = { status: "tool-capable" };
    const b: ModelCapabilities = { status: "no-tools", detail: ["no tools field in /api/show"] };
    const client = fakeClient({
      a: ok(a),
      b: ok(b),
    });
    const result = await resolveCapabilities(client, [model("a"), model("b")]);
    expect(result).toEqual([
      { model: model("a"), capability: a },
      { model: model("b"), capability: b },
    ]);
  });

  it("resolves a mix of successful and failed lookups independently, in list order", async () => {
    const toolCapable: ModelCapabilities = { status: "tool-capable" };
    const error: ProviderError = { kind: "auth", status: 401, message: "bad key" };
    const client = fakeClient({
      good: ok(toolCapable),
      bad: fail(error),
    });
    const result = await resolveCapabilities(client, [model("good"), model("bad")]);
    expect(result).toEqual([
      { model: model("good"), capability: toolCapable },
      {
        model: model("bad"),
        capability: { status: "unknown", detail: [describeProviderError(error)] },
      },
    ]);
  });

  it("treats all-unselectable and all-selectable lists identically as far as resolution — every entry gets its own answer", async () => {
    const noTools: ModelCapabilities = { status: "no-tools" };
    const client = fakeClient({
      a: ok(noTools),
      b: ok(noTools),
    });
    const result = await resolveCapabilities(client, [model("a"), model("b")]);
    expect(result.every((r) => r.capability.status === "no-tools")).toBe(true);
  });
});

describe("isSelectable", () => {
  it.each<[string, ModelCapabilities | undefined, boolean]>([
    ["undefined (never checked / still loading)", undefined, false],
    ["tool-capable", { status: "tool-capable" }, true],
    ["no-tools", { status: "no-tools" }, false],
    ["unknown", { status: "unknown" }, false],
  ])("%s -> %s", (_name, capability, expected) => {
    expect(isSelectable(capability)).toBe(expected);
  });
});

describe("reasonForCapability", () => {
  // Card 102 (decisions/37-i18n-paraglide.md): the "no detail at all" English
  // fallback sentences this function used to invent moved UI-side —
  // src/ui/capabilityMessage.ts's `capabilityReason` (own test file) is what
  // now supplies them. This domain function is data-only: no detail means
  // `undefined`, full stop.
  it("returns undefined when there is no capability yet", () => {
    expect(reasonForCapability(undefined)).toBeUndefined();
  });

  it("uses the detail text when status is unknown and detail is present", () => {
    expect(reasonForCapability({ status: "unknown", detail: ["Provider returned 500."] })).toBe(
      "Provider returned 500.",
    );
  });

  it("returns undefined when status is unknown with no detail (no English fallback)", () => {
    expect(reasonForCapability({ status: "unknown" })).toBeUndefined();
  });

  it("uses the detail text when status is no-tools and detail is present", () => {
    expect(
      reasonForCapability({ status: "no-tools", detail: ["no tools capability reported"] }),
    ).toBe("no tools capability reported");
  });

  it("returns undefined when status is no-tools with no detail (no English fallback)", () => {
    expect(reasonForCapability({ status: "no-tools" })).toBeUndefined();
  });

  it("returns the joined detail for tool-capable when present, else undefined", () => {
    expect(
      reasonForCapability({ status: "tool-capable", detail: ["confirmed via /api/show"] }),
    ).toBe("confirmed via /api/show");
    expect(reasonForCapability({ status: "tool-capable" })).toBeUndefined();
  });

  it("joins a multi-entry detail array with a space", () => {
    expect(reasonForCapability({ status: "no-tools", detail: ["line one", "line two"] })).toBe(
      "line one line two",
    );
  });
});
