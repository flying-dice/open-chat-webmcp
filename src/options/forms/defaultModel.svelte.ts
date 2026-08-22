// The options page's default-model subsystem (card 113), lifted whole out of
// ProvidersSection.svelte — the larger half of that component's 0.4 SRP
// marker. Two related but separable jobs, one per factory below:
//
//   1. WHAT CAN BE SET. Per provider, the tool-capable models "Set as
//      default" may offer, loaded in parallel and degrading independently
//      (decisions/22's discipline), plus the inline reason the affordance is
//      blocked when there are none (card 41, card 52, decisions/11,
//      decisions/23).
//   2. WHETHER WHAT IS SET STILL HOLDS. Card 41's fourth checklist item: an
//      ALREADY-STORED default whose provider was deleted, or whose model was
//      removed or re-pulled without tools, must surface a reason rather than
//      silently seeding a broken chat.
//
// Both are capability policy applied to a registry, not section layout, and
// neither needs to know anything about the CRUD, the add-provider step
// machine or the permission badges it used to sit beside.
//
// The heavy lifting stays where it already lived: `loadProviderModels`,
// `resolveCapability` and `isSelectable` (src/domain/providers/capability.ts)
// are the shared rule both this surface and the side panel's picker apply, so
// the two can never disagree about which models are safe to send tools to.
// What this module adds is this surface's state shape and its localized
// wording.
//
// A `.svelte.ts` module: both factories own `$state` on the caller's behalf
// (no `$effect`, so both are constructible from a plain unit test).

import {
  isSelectable,
  loadProviderModels,
  resolveCapability,
  resolveSelection,
  type ModelCapabilityEntry,
  type ProviderConfig,
  type ProviderSelection,
} from "../../domain/providers";
// Card 102 (decisions/37-i18n-paraglide.md): the LOCALIZED wrappers — see
// src/ui/providerMessage.ts and src/ui/capabilityMessage.ts's own doc comments
// for why these live UI-side rather than being the domain exports of the
// same-shaped functions.
import { describeProviderError } from "../../ui/providerMessage";
import { capabilityReason } from "../../ui/capabilityMessage";
import { m } from "../../paraglide/messages.js";
import { optionsServices } from "../app-services";

/**
 * One provider's tool-capable model options for the "Set as default"
 * dropdown.
 *
 * `"loaded"`'s `options` is PRE-FILTERED to tool-capable models only
 * (`isSelectable`) — ProviderRow's dropdown never has to re-check capability
 * itself, and an empty `options` array is exactly the "loaded, but nothing
 * tool-capable" blocked state (decisions/11, decisions/23).
 */
export type DefaultModelOptionsState =
  | { status: "loading" }
  | { status: "loaded"; options: ModelCapabilityEntry[] }
  | { status: "error"; message: string }
  | { status: "not-supported"; message: string };

export interface DefaultModelOptions {
  /** Load (or reload) ONE provider's options — the unit of "degrade per provider": callers fire this without awaiting each other, so a slow or unreachable provider never delays another's answer. */
  load(provider: ProviderConfig): Promise<void>;
  /** Reload every listed provider in parallel; each settles and writes its own slot independently. */
  loadAll(providers: ProviderConfig[]): Promise<void>;
  /** Forget every provider not in `liveIds`, so a deleted provider can't leave stale options behind if its id is ever reused. */
  keepOnly(liveIds: Set<string>): void;
  /** Whether this provider's answer is still in flight — the row shows "Checking…", no verdict yet (card 52). */
  isLoading(providerId: string): boolean;
  /** This provider's tool-capable models, or `[]` while loading/blocked — exactly what ProviderRow's dropdown renders. */
  optionsFor(providerId: string): ModelCapabilityEntry[];
  /**
   * The inline reason "Set as default" is blocked right now — `undefined`
   * while still loading (no verdict yet) or once at least one tool-capable
   * model is available. A `not-supported` provider (no model-listing API)
   * points at the side panel's existing seed-once behavior instead of
   * reimplementing manual entry here (decisions/23); a `loaded` provider with
   * zero tool-capable models gets decisions/11's plain "no tool-capable
   * models" wording; any other `listModels()` failure surfaces its own
   * message.
   */
  blockedReason(providerId: string): string | undefined;
}

export function createDefaultModelOptions(): DefaultModelOptions {
  /** Every provider's state, keyed by provider id. Absent key = never (yet) requested. */
  const states = $state<Record<string, DefaultModelOptionsState>>({});
  /** Per-provider load generation, guarding a stale response from a superseded reload for that SAME provider — one token per provider id, never a single shared one, so reloading provider A can never discard an in-flight load for provider B (the same rule src/sidepanel/stores/selection.svelte.ts's `providerTokens` documents). Not `$state` — internal bookkeeping only. */
  const tokens: Record<string, number> = {};

  async function load(provider: ProviderConfig): Promise<void> {
    const token = (tokens[provider.id] ?? 0) + 1;
    tokens[provider.id] = token;
    states[provider.id] = { status: "loading" };

    const client = optionsServices().createProviderClient(provider);
    const load = await loadProviderModels(client, {
      stillCurrent: () => tokens[provider.id] === token,
    });
    if (!load) return; // superseded by a later reload for this provider

    if (load.status !== "loaded") {
      // `describeProviderError` already returns localized copy — nothing
      // here needs to re-wrap it through `m`.
      states[provider.id] = { status: load.status, message: describeProviderError(load.error) };
      return;
    }
    states[provider.id] = {
      status: "loaded",
      options: load.entries.filter((entry) => isSelectable(entry.capability)),
    };
  }

  return {
    load,

    async loadAll(providers: ProviderConfig[]): Promise<void> {
      await Promise.all(providers.map((provider) => load(provider)));
    },

    keepOnly(liveIds: Set<string>): void {
      for (const id of Object.keys(states)) {
        if (!liveIds.has(id)) delete states[id];
      }
    },

    isLoading(providerId: string): boolean {
      const state = states[providerId];
      return state === undefined || state.status === "loading";
    },

    optionsFor(providerId: string): ModelCapabilityEntry[] {
      const state = states[providerId];
      return state?.status === "loaded" ? state.options : [];
    },

    blockedReason(providerId: string): string | undefined {
      const state = states[providerId];
      if (!state || state.status === "loading") return undefined; // still resolving — no verdict to report yet
      if (state.status === "not-supported")
        return m.providersSection_setDefaultBlockedNotSupported();
      if (state.status === "error") return state.message;
      return state.options.length > 0 ? undefined : m.providersSection_setDefaultBlockedNoModels();
    },
  };
}

export interface StaleDefaultCheck {
  /** Why the STORED default no longer holds — `undefined` when it is fine, or when there isn't one. */
  readonly reason: string | undefined;
  /** Re-check `selection` against the live registry and the model's current capability. */
  refresh(selection: ProviderSelection | undefined): Promise<void>;
}

/**
 * Card 41's fourth checklist item: whether the CURRENTLY STORED default is
 * still valid — its provider still registered, its model still resolving to
 * `"tool-capable"` — so a default that went stale after being set surfaces a
 * clear reason instead of quietly seeding new chats.
 */
export function createStaleDefaultCheck(): StaleDefaultCheck {
  let reason = $state<string | undefined>(undefined);

  return {
    get reason() {
      return reason;
    },

    async refresh(selection: ProviderSelection | undefined): Promise<void> {
      if (!selection) {
        reason = undefined;
        return;
      }
      const [resolved, resolveErr] = await resolveSelection(optionsServices().providers, selection);
      if (resolveErr) {
        // Card 92: an unreadable registry is not evidence that the default is
        // stale, so this stays silent rather than accusing a provider that may
        // be perfectly fine.
        reason = undefined;
        return;
      }
      if (resolved.status !== "ok") {
        reason = m.providersSection_providerRemoved();
        return;
      }
      const client = optionsServices().createProviderClient(resolved.config);
      const capability = await resolveCapability(client, {
        id: resolved.model,
        name: resolved.model,
      });
      // `capabilityReason` already supplies a localized fallback for "no
      // detail at all" — the `??` below only ever covers `capability` genuinely
      // being `undefined`, which `resolveCapability` never actually returns;
      // kept as a defensive last resort rather than an `!`.
      reason = isSelectable(capability)
        ? undefined
        : (capabilityReason(capability) ?? m.providersSection_cannotConfirmToolCapable());
    },
  };
}
