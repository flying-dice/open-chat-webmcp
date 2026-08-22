// The EDITABLE shape of a custom-header list, shared by both registries on
// this page (decisions/15-custom-headers-are-credentials.md): providers
// (card 22) and MCP servers (card 39) both let a user add arbitrary request
// headers, and both had their own copy of this row model, its CRUD and its
// validation until card 81 merged them.
//
// A row is deliberately NOT a `{ key, value }` pair. Each carries a synthetic
// `id` distinct from `key`/`value` so `{#each ... (row.id)}` stays stable
// while the user is mid-edit on a duplicate or not-yet-valid key — keying on
// `key` itself would make two rows collide, or a row jump position, while its
// name is still being typed. The id is opaque: nothing outside the editor
// reads it, and it never reaches storage. Each form converts its own stored
// shape (providers keep an array of pairs, MCP servers a `Record`) to and
// from these rows at its own edges.
//
// What stays per-form: WHICH headers are reserved. A provider's rule
// (`reservedHeaderReason`, src/domain/providers) and an MCP server's
// (`validateServerHeaders`, src/domain/tools) are different rules from
// different bounded contexts, evaluated against different auth state, so
// each form passes its own `ReservedHeaderCheck` in rather than this module
// picking one. Everything AROUND that check — blank rows, missing halves,
// duplicate names, and which error a caller sees first — is the same
// question in both places and is answered once, here.

export interface HeaderRow {
  id: number;
  key: string;
  value: string;
}

/** A form's own reserved-name rule: the reason this header may not be set by hand, or `undefined` if it's allowed. Called with both halves trimmed. */
export type ReservedHeaderCheck = (key: string, value: string) => string | undefined;

/** Build the editor's rows from a form's stored headers, in the given order. Ids are positional and only need to be unique within one editor. */
export function toHeaderRows(entries: readonly (readonly [string, string])[]): HeaderRow[] {
  return entries.map(([key, value], i) => ({ id: i, key, value }));
}

/**
 * Refuse a reserved header, or a name duplicated across `rows`, right where
 * it's being typed — decision 15's "refused visibly at edit time, not dropped
 * silently at request time." A row with both fields still blank (the
 * just-added, not-yet-filled-in row) is not an error.
 */
export function headerRowError(
  row: HeaderRow,
  rows: readonly HeaderRow[],
  isReserved: ReservedHeaderCheck,
): string | undefined {
  const key = row.key.trim();
  const value = row.value.trim();
  if (key.length === 0 && value.length === 0) return undefined;
  if (key.length === 0) return "Enter a header name, or remove this row.";
  if (value.length === 0) return "Enter a value, or remove this row.";

  const reserved = isReserved(key, value);
  if (reserved) return reserved;

  const lower = key.toLowerCase();
  const duplicates = rows.filter((h) => h.key.trim().toLowerCase() === lower).length;
  if (duplicates > 1) return `"${key}" is already set on another row above.`;

  return undefined;
}

/** First validation failure across every row, or `undefined` if all are clean — used by "Test connection" and by submit so neither sends a request built from an invalid header. */
export function firstHeaderError(
  rows: readonly HeaderRow[],
  isReserved: ReservedHeaderCheck,
): string | undefined {
  for (const row of rows) {
    const err = headerRowError(row, rows, isReserved);
    if (err) return `Header "${row.key.trim() || "(empty)"}": ${err}`;
  }
  return undefined;
}
