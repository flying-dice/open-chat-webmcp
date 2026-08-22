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
  listCore(): Promise<TCore[]>;
  /** Replace the ordered core array wholesale. */
  writeCore(list: TCore[]): Promise<void>;
  list(): Promise<KeyedRecord<TCore, TParts>[]>;
  get(id: string): Promise<KeyedRecord<TCore, TParts> | undefined>;
  /** Append a record with a freshly generated id. Credentials go to the part area; nothing but the core reaches the list area. */
  add(input: Omit<TCore, "id"> & Partial<TParts>): Promise<KeyedRecord<TCore, TParts>>;
  /**
   * Patch a record. A part is written only when its name is PRESENT in
   * `patch` — so `{}` leaves credentials alone while `{apiKey: undefined}`
   * clears one, which is the distinction both registries always drew and the
   * reason this takes `patch` rather than a whole record.
   */
  update(
    id: string,
    patch: Partial<Omit<TCore, "id">> & Partial<TParts>,
  ): Promise<KeyedRecord<TCore, TParts> | undefined>;
  /** Drop a record and every credential part filed under its id. */
  remove(id: string): Promise<void>;
  /** Reorder to match `orderedIds`. Any id it omits is DROPPED — reordering is not a way to delete, so callers pass every current id back. */
  reorder(orderedIds: string[]): Promise<void>;
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

  async function readParts(id: string): Promise<Partial<TParts>> {
    const entries = await Promise.all(
      partNames.map(async (name) => {
        const raw = await spec.partArea.read(partStorageKey(name, id));
        return [name, partFor(name).decode(raw)] as const;
      }),
    );
    const merged: Record<string, unknown> = {};
    for (const [name, value] of entries) {
      if (value !== undefined) merged[name] = value;
    }
    return merged as Partial<TParts>;
  }

  /** Write one credential part, or CLEAR it when the value is absent or empty. The two are the same outcome on purpose — see {@link CredentialPart.isEmpty}. */
  async function writePart(
    name: keyof TParts & string,
    id: string,
    value: unknown,
  ): Promise<void> {
    const part = partFor(name);
    const key = partStorageKey(name, id);
    if (value === undefined || part.isEmpty(value)) {
      await spec.partArea.remove(key);
    } else {
      await spec.partArea.write({ [key]: value });
    }
  }

  async function withParts(core: TCore): Promise<KeyedRecord<TCore, TParts>> {
    const parts = await readParts(core.id);
    return { ...core, ...parts } as KeyedRecord<TCore, TParts>;
  }

  async function listCore(): Promise<TCore[]> {
    const value = await spec.listArea.read(spec.listKey);
    if (!Array.isArray(value)) return [];
    const out: TCore[] = [];
    for (const raw of value) {
      const decoded = spec.decodeCore(raw);
      if (decoded) out.push(decoded);
    }
    return out;
  }

  async function writeCore(list: TCore[]): Promise<void> {
    await spec.listArea.write({ [spec.listKey]: list });
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
      const core = await listCore();
      return Promise.all(core.map(withParts));
    },

    async get(id) {
      const core = await listCore();
      const found = core.find((c) => c.id === id);
      return found ? withParts(found) : undefined;
    },

    async add(input) {
      const id = spec.generateId();
      const { core, parts } = splitPatch(input as Record<string, unknown>);
      const record = { ...core, id } as TCore;
      await writeCore([...(await listCore()), record]);
      await Promise.all(parts.map(({ name, value }) => writePart(name, id, value)));
      return withParts(record);
    },

    async update(id, patch) {
      const list = await listCore();
      const index = list.findIndex((c) => c.id === id);
      if (index === -1) return undefined;

      const { core, parts } = splitPatch(patch as Record<string, unknown>);
      const updated = { ...list[index], ...core } as TCore;
      const next = [...list];
      next[index] = updated;
      await writeCore(next);

      await Promise.all(parts.map(({ name, value }) => writePart(name, id, value)));
      return withParts(updated);
    },

    async remove(id) {
      const list = await listCore();
      await writeCore(list.filter((c) => c.id !== id));
      await spec.partArea.remove(partNames.map((name) => partStorageKey(name, id)));
    },

    async reorder(orderedIds) {
      const list = await listCore();
      const byId = new Map(list.map((c) => [c.id, c] as const));
      const reordered = orderedIds
        .map((id) => byId.get(id))
        .filter((c): c is TCore => c !== undefined);
      await writeCore(reordered);
    },
  };
}
