// Typed readers for the untrusted, page-supplied JSON the tool inspector
// renders — a tool's `inputSchema` (ToolSchema.svelte → SchemaProperty.svelte)
// and a call's argument values (ToolArgValue.svelte).
//
// decisions/02-mainworld-webmcp-bridge.md: "treat every tool descriptor... as
// untrusted input". In practice these payloads are only LOOSELY
// JSON-Schema-shaped, so every field read has to be defensive and degrade to
// "no further detail" rather than throwing.
//
// Card 96 (the strict-safety final audit) is why this module exists rather
// than the reads staying inline. Written inline, each one was a
// check-then-assert pair — `typeof rec?.type === "string" ? (rec.type as
// string) : undefined` — eleven of which were the whole population of
// uncommented `as` casts in the side panel. The check and the assertion are
// the same fact stated twice, and a function is where TypeScript will state
// it once: `readString` narrows a local, so the return type is proved rather
// than asserted. Three copies of `isRecord` and three copies of the
// string-array filter collapsed with them (the 0.3 DRY markers those three
// components carried).
//
// Deliberately NOT in src/ui: src/ui/README.md's bar is "presentation BOTH
// Svelte surfaces render through", and the options page renders no tool
// schemas. It sits beside the panel's other presentation helpers instead.

/** `typeof v === "object" && v !== null && !Array.isArray(v)` — the shape check every defensive read below starts from, and the one the inspector components use directly to decide whether a value renders as a nested object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `rec[key]` when it is a string, else `undefined`. `rec` itself may be `undefined` so a caller can chain off an optional parent without a guard of its own. */
export function readString(
  rec: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = rec?.[key];
  return typeof value === "string" ? value : undefined;
}

/** `rec[key]` when it is a record, else `undefined`. */
export function readRecord(
  rec: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = rec?.[key];
  return isRecord(value) ? value : undefined;
}

/** `rec[key]` when it is an array, else `undefined`. Elements stay `unknown` — this says the container is a list, nothing about what is in it. */
export function readArray(
  rec: Record<string, unknown> | undefined,
  key: string,
): readonly unknown[] | undefined {
  const value = rec?.[key];
  // `Array.isArray` narrows `unknown` to `any[]`, which would hand every
  // caller an implicit `any` per element. The annotated local is what stops
  // that at the source (no `as` needed: `any[]` is assignable to it).
  if (!Array.isArray(value)) return undefined;
  const items: readonly unknown[] = value;
  return items;
}

/** The string elements of `rec[key]`, or `[]` when it is absent or not an array. Non-string elements are dropped rather than stringified: these feed `required`-name lookups, where a wrong name is worse than a missing one. */
export function readStringArray(rec: Record<string, unknown> | undefined, key: string): string[] {
  const items = readArray(rec, key);
  return items ? items.filter((item): item is string => typeof item === "string") : [];
}
