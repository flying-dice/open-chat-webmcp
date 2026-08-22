// Tests for the predefined-backend catalogue logic in ./presets.ts
// (decisions/21-provider-presets.md): getPreset's lookup and
// iconKeyForProvider's fallback rule. PROVIDER_PRESETS itself is static
// data; the one invariant test below (unique ids) guards the id-lookup
// contract getPreset depends on, not the data's content.
import { describe, expect, it } from "vitest";
import { getPreset, iconKeyForProvider, PROVIDER_PRESETS } from "./presets";

describe("PROVIDER_PRESETS", () => {
  it("has a unique id for every preset — getPreset's lookup depends on it", () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getPreset", () => {
  it("returns undefined when no id is given", () => {
    expect(getPreset(undefined)).toBeUndefined();
  });

  it("returns undefined for an id that doesn't match any catalog entry", () => {
    expect(getPreset("not-a-real-preset")).toBeUndefined();
  });

  it("returns the matching preset for a known id", () => {
    expect(getPreset("ollama")).toEqual(expect.objectContaining({ id: "ollama", type: "ollama", local: true }));
  });
});

describe("iconKeyForProvider", () => {
  it("uses the preset's own icon when presetId still matches a known backend", () => {
    expect(iconKeyForProvider({ type: "openai", presetId: "openai" })).toBe(getPreset("openai")?.icon);
    expect(iconKeyForProvider({ type: "ollama", presetId: "ollama" })).toBe(getPreset("ollama")?.icon);
  });

  it("falls back to the ollama glyph for an ollama-type provider with no matching preset", () => {
    expect(iconKeyForProvider({ type: "ollama", presetId: undefined })).toBe("ollama");
    expect(iconKeyForProvider({ type: "ollama", presetId: "since-removed-preset" })).toBe("ollama");
  });

  it("falls back to the generic glyph for an openai-type provider with no matching preset", () => {
    expect(iconKeyForProvider({ type: "openai", presetId: undefined })).toBe("smart_toy");
    expect(iconKeyForProvider({ type: "openai", presetId: "since-removed-preset" })).toBe("smart_toy");
  });

  it("never lets an unrecognized presetId of the wrong type borrow another backend's icon", () => {
    // A dangling presetId (deleted from the catalog since this provider was
    // added, decisions/21) must fall back by *type*, not silently resolve to
    // whatever preset happens to sort first.
    const openaiFallback = iconKeyForProvider({ type: "openai", presetId: "gone" });
    const ollamaFallback = iconKeyForProvider({ type: "ollama", presetId: "gone" });
    expect(openaiFallback).not.toBe(ollamaFallback);
  });
});
