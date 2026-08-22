// The mechanic BOTH registries are (card 74: "the near-duplicate is written
// once and both registries configure it").
//
// `src/lib/providers/registry.ts` and `src/lib/mcp/registry.ts` were 398 and
// 395 lines of the same idea, and the second one's own header comment said
// so ("Deliberately mirrors the shape and storage split of
// src/lib/providers/registry.ts... nothing here imports from it — this is a
// parallel module, not an extension of it"). That parallelism was not
// cosmetic: list/get/add/update/remove/reorder, defensive parse on read,
// generated ids, and — the part that actually matters — the sync/local
// CREDENTIAL SPLIT (decisions/10, decisions/15) were duplicated line for
// line, which means the rule "no secret ever reaches `chrome.storage.sync`"
// was implemented twice and could be broken independently in either copy.
//
// Here it is implemented once. A record has:
//
//   - a CORE, the fields that are not credentials, held as one ordered array
//     under a single key in `chrome.storage.sync`. Order is display order.
//   - zero or more CREDENTIAL PARTS, each held per-record under its own key
//     in `chrome.storage.local`, keyed `<prefix><id>`.
//
// A part never touches the sync area, structurally: `partArea` and
// `listArea` are separate gateways and the split is not a convention this
// module follows but the only shape it can express. Adding a credential to
// either registry is now a `parts` entry, not a new pair of read/write
// helpers that has to remember which area it belongs in.
//
// What is NOT here is anything either registry does on TOP of the mechanic —
// providers clearing the default selection when the selected provider goes
// away, MCP servers defaulting `enabled`/`transport`. Those are genuinely
// different, and pushing them down into a shared "hooks" plumbing would
// re-create the duplication one layer lower.

// CARD 92: every method returns `Result<T, StorageError>`
// (decisions/34-errors-as-values.md). Nothing here maps or classifies a
// failure — ../area.ts already did that — so what the tuple checks below
// actually buy is ORDERING: an `if (err) return fail(err)` after each write
// is the explicit statement that a half-applied record (the core list
// written, its credential parts not) stops there rather than being papered
// over by a `Promise.all` whose rejection nobody was awaiting.

import type { StorageError } from "../../domain/storage";
import { allOk, fail, ok, type Result } from "../../domain/result";
import type { StorageAreaGateway } from "./area";

/**
 * One credential field of a record: where it lives, how to read it back
 * defensively, and what counts as "nothing to store".
 *
 * `decode` returning `undefined` means "absent or unreadable" — the same
 * defensive drop-it-and-carry-on posture both registries always had. It is
 * not a {@link import("../../domain/storage").StorageError}: a single
 * malformed credential should leave the record usable without its
 * credential, not fail the whole listing.
 */
export interface CredentialPart<TValue> {
  /** Local-storage key prefix, e.g. `"providers:apiKey:"`. The full key is `` `${keyPrefix}${id}` ``. */
  readonly keyPrefix: string;
  /** Read a raw stored value back, or `undefined` if it is absent, malformed, or empty. */
  decode(raw: unknown): TValue | undefined;
  /** Whether a value should CLEAR the key rather than be written. An empty string, an empty array, an empty map — storing those is indistinguishable from storing nothing, so they are stored as nothing. */
  isEmpty(value: TValue): boolean;
}

/** Helper that pins `TValue` from the spec's own callbacks, so a `parts` map can be written inline without spelling out each type argument. */
export function credentialPart<TValue>(part: CredentialPart<TValue>): CredentialPart<TValue> {
  return part;
}

export interface KeyedRecordStoreSpec<TCore extends { id: string }, TParts> {
  /** The single `chrome.storage.sync` key holding the ordered core array. */
  readonly listKey: string;
  /** Where the ordered core array lives. */
  readonly listArea: StorageAreaGateway;
  /** Where every credential part lives. MUST be a local area — see this module's header. */
  readonly partArea: StorageAreaGateway;
  /** Defensive parse of one entry of the stored array. Anything that fails is DROPPED from the listing rather than crashing a consumer downstream. */
  decodeCore(raw: unknown): TCore | undefined;
  generateId(): string;
  readonly parts: { [K in keyof TParts]-?: CredentialPart<NonNullable<TParts[K]>> };
}

/** A whole record: its non-credential core plus whichever credentials are present. */
export type KeyedRecord<TCore, TParts> = TCore & TParts;

export interface KeyedRecordStore<TCore extends { id: string }, TParts> {
  /** The ordered core array with no credential reads at all — for operations that only rewrite ordering or membership. */
  listCore(): Promise<Result<TCore[], StorageError>>;
  /** Replace the ordered core array wholesale. */
  writeCore(list: TCore[]): Promise<Result<void, StorageError>>;
  list(): Promise<Result<KeyedRecord<TCore, TParts>[], StorageError>>;
  get(id: string): Promise<Result<KeyedRecord<TCore, TParts> | undefined, StorageError>>;
  /** Append a record with a freshly generated id. Credentials go to the part area; nothing but the core reaches the list area. */
  add(
    input: Omit<TCore, "id"> & Partial<TParts>,
  ): Promise<Result<KeyedRecord<TCore, TParts>, StorageError>>;
  /**
   * Patch a record. A part is written only when its name is PRESENT in
   * `patch` — so `{}` leaves credentials alone while `{apiKey: undefined}`
   * clears one, which is the distinction both registries always drew and the
   * reason this takes `patch` rather than a whole record.
   *
   * An `id` that is not registered is `ok(undefined)`, not a failure: it is
   * an ordinary lookup miss, and `NotFound` is reserved for the case where
   * absence genuinely stops the caller (src/domain/storage).
   */
  update(
    id: string,
    patch: Partial<Omit<TCore, "id">> & Partial<TParts>,
  ): Promise<Result<KeyedRecord<TCore, TParts> | undefined, StorageError>>;
  /** Drop a record and every credential part filed under its id. */
  remove(id: string): Promise<Result<void, StorageError>>;
  /** Reorder to match `orderedIds`. Any id it omits is DROPPED — reordering is not a way to delete, so callers pass every current id back. */
  reorder(orderedIds: string[]): Promise<Result<void, StorageError>>;
}

export function createKeyedRecordStore<TCore extends { id: string }, TParts>(
  spec: KeyedRecordStoreSpec<TCore, TParts>,
): KeyedRecordStore<TCore, TParts> {
  const partNames = Object.keys(spec.parts) as (keyof TParts & string)[];

  function partFor(name: keyof TParts & string): CredentialPart<unknown> {
    return spec.parts[name] as CredentialPart<unknown>;
  }

  function partStorageKey(name: keyof TParts & string, id: string): string {
    return `${partFor(name).keyPrefix}${id}`;
  }

  type PartEntry = readonly [name: string, value: unknown];

  async function readParts(id: string): Promise<Result<Partial<TParts>, StorageError>> {
    const [entries, err] = allOk<PartEntry, StorageError>(
      await Promise.all(
        partNames.map(async (name): Promise<Result<PartEntry, StorageError>> => {
          const [raw, readErr] = await spec.partArea.read(partStorageKey(name, id));
          if (readErr) return fail(readErr);
          return ok([name, partFor(name).decode(raw)] as const);
        }),
      ),
    );
    if (err) return fail(err);

    const merged: Record<string, unknown> = {};
    for (const [name, value] of entries) {
      if (value !== undefined) merged[name] = value;
    }
    return ok(merged as Partial<TParts>);
  }

  /** Write one credential part, or CLEAR it when the value is absent or empty. The two are the same outcome on purpose — see {@link CredentialPart.isEmpty}. */
  function writePart(
    name: keyof TParts & string,
    id: string,
    value: unknown,
  ): Promise<Result<void, StorageError>> {
    const part = partFor(name);
    const key = partStorageKey(name, id);
    return value === undefined || part.isEmpty(value)
      ? spec.partArea.remove(key)
      : spec.partArea.write({ [key]: value });
  }

  /** Write every part of one patch concurrently, reporting the first failure. */
  async function writeParts(
    id: string,
    parts: readonly { name: keyof TParts & string; value: unknown }[],
  ): Promise<Result<void, StorageError>> {
    const [, err] = allOk(
      await Promise.all(parts.map(({ name, value }) => writePart(name, id, value))),
    );
    return err ? fail(err) : ok();
  }

  async function withParts(core: TCore): Promise<Result<KeyedRecord<TCore, TParts>, StorageError>> {
    const [parts, err] = await readParts(core.id);
    if (err) return fail(err);
    return ok({ ...core, ...parts } as KeyedRecord<TCore, TParts>);
  }

  async function listCore(): Promise<Result<TCore[], StorageError>> {
    const [value, err] = await spec.listArea.read(spec.listKey);
    if (err) return fail(err);
    if (!Array.isArray(value)) return ok([]);
    const out: TCore[] = [];
    for (const raw of value) {
      const decoded = spec.decodeCore(raw);
      if (decoded) out.push(decoded);
    }
    return ok(out);
  }

  function writeCore(list: TCore[]): Promise<Result<void, StorageError>> {
    return spec.listArea.write({ [spec.listKey]: list });
  }

  /** Splits a patch into "core fields" and "credential parts" by the part names the spec declared — the one place the two halves of a record are told apart. */
  function splitPatch(patch: Record<string, unknown>): {
    core: Record<string, unknown>;
    parts: { name: keyof TParts & string; value: unknown }[];
  } {
    const core: Record<string, unknown> = {};
    const parts: { name: keyof TParts & string; value: unknown }[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if ((partNames as string[]).includes(key)) {
        parts.push({ name: key as keyof TParts & string, value });
      } else {
        core[key] = value;
      }
    }
    return { core, parts };
  }

  return {
    listCore,
    writeCore,

    async list() {
      const [core, err] = await listCore();
      if (err) return fail(err);
      return allOk(await Promise.all(core.map(withParts)));
    },

    async get(id) {
      const [core, err] = await listCore();
      if (err) return fail(err);
      const found = core.find((c) => c.id === id);
      return found ? withParts(found) : ok(undefined);
    },

    async add(input) {
      const id = spec.generateId();
      const { core, parts } = splitPatch(input as Record<string, unknown>);
      const record = { ...core, id } as TCore;

      const [existing, listErr] = await listCore();
      if (listErr) return fail(listErr);
      const [, coreErr] = await writeCore([...existing, record]);
      if (coreErr) return fail(coreErr);
      const [, partsErr] = await writeParts(id, parts);
      if (partsErr) return fail(partsErr);

      return withParts(record);
    },

    async update(id, patch) {
      const [list, listErr] = await listCore();
      if (listErr) return fail(listErr);
      const index = list.findIndex((c) => c.id === id);
      if (index === -1) return ok(undefined);

      const { core, parts } = splitPatch(patch as Record<string, unknown>);
      const updated = { ...list[index], ...core } as TCore;
      const next = [...list];
      next[index] = updated;
      const [, coreErr] = await writeCore(next);
      if (coreErr) return fail(coreErr);

      const [, partsErr] = await writeParts(id, parts);
      if (partsErr) return fail(partsErr);

      return withParts(updated);
    },

    async remove(id) {
      const [list, listErr] = await listCore();
      if (listErr) return fail(listErr);
      const [, coreErr] = await writeCore(list.filter((c) => c.id !== id));
      if (coreErr) return fail(coreErr);
      return spec.partArea.remove(partNames.map((name) => partStorageKey(name, id)));
    },

    async reorder(orderedIds) {
      const [list, err] = await listCore();
      if (err) return fail(err);
      const byId = new Map(list.map((c) => [c.id, c] as const));
      const reordered = orderedIds
        .map((id) => byId.get(id))
        .filter((c): c is TCore => c !== undefined);
      return writeCore(reordered);
    },
  };
}
