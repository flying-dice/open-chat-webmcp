// Predefined backend presets for the options page's "add provider" flow
// (decisions/21-provider-presets.md, card 50). Static metadata only — a
// preset pre-fills the SAME `ProviderForm.svelte` the existing "Custom"
// flow always used; it is not a new provider type, a new transport, or a
// new code path. Every field a preset fills in stays editable afterwards.
//
// `baseUrl` here is NOT the "base_url" value most providers' own docs quote
// for the OpenAI SDK. Those docs' `base_url` is whatever the SDK appends a
// bare `/chat/completions` to, so it already ends in the provider's own
// "v1" segment (`.../v1`, `.../openai/v1`, `.../v1beta/openai`, ...). This
// project's OpenAI-compatible client (src/infra/openai) instead
// treats `config.baseUrl` as HOST-ONLY and always appends its own
// `/v1/models` / `/v1/chat/completions` (same convention as Ollama's
// `/api/...` client) — so every `baseUrl` below has that trailing "v1"
// segment already stripped off the documented SDK `base_url`, precisely so
// `${baseUrl}/v1/chat/completions` reconstructs the real endpoint.
//
// Every base URL below was checked twice before being committed here
// (2026-08-20): once by reading that provider's own current docs, and once
// by sending a real HTTP request to `${baseUrl}/v1/models` (a fake bearer
// token) and confirming the response is that provider's real
// authentication-error body, not a generic 404 — i.e. the request actually
// reached the intended handler. Getting a wrong base URL here doesn't fail
// loudly; it surfaces as `unreachable-or-cors`, which reads exactly like a
// user misconfiguration, so this was worth doing for real rather than
// trusting any single source (docs, memory, or this catalog's own history).
//
// A base URL can drift after a provider ships a docs change. That's exactly
// why `presetId` exists on `ProviderConfig` (registry.ts) — so a later
// correction here can be surfaced to (or applied for) anyone who added a
// provider from this preset and never edited the field themselves.

// Card 73 (decisions/29) moved this catalogue into the `providers` bounded
// context and cut its last outward edge: `icon` used to be typed `IconName`
// from src/lib/icons.ts, i.e. the domain depended on which glyphs the UI
// happens to ship. It is now a plain icon KEY — a stable name this catalogue
// chooses — and the UI resolves it against its own icon set
// (src/lib/providerIcon.ts). Renaming or restyling a glyph is now a UI-only
// change; adding a preset here needs no icon-set edit to typecheck.

import type { ProviderType } from "./provider";

export interface ProviderPreset {
  /** Stable; stored on `ProviderConfig.presetId` (registry.ts) when a provider is added from this preset. Never reuse an id for a different backend. */
  id: string;
  /** Display name shown on the "choose a backend" tile and, via `ProviderRow`, on every provider added from it. */
  label: string;
  /** Which `ChatProvider` client this backend speaks — reuses the existing type union; there is no new provider type or transport here. */
  type: ProviderType;
  /**
   * Pre-filled into the form's base URL field, still fully editable
   * afterwards. HOST-ONLY for `type: "openai"` presets — see the module
   * doc above for why this differs from the `base_url` most providers'
   * own docs quote.
   */
  baseUrl: string;
  /** Whether this backend normally needs an API key. Drives whether the form shows the key field by default; the field can still be added/edited regardless (a "local" backend can sit behind a gateway that wants one too — see the custom-headers section, decisions/15). */
  requiresKey: boolean;
  /** A localhost runtime (Ollama, LM Studio, llama.cpp): no key needed by default, and its host permission is already covered by the extension's baked-in `http://localhost/*`/`http://127.0.0.1/*` grant (decisions/09) rather than a runtime request. */
  local: boolean;
  /** Where to get an API key (hosted backends) or set up the local server (local backends). Shown as a link next to the key field / in the picker tile. */
  docsUrl: string;
  /** Anything surprising about this backend worth a one-line callout in the form (decisions/21). */
  note?: string;
  /**
   * Shown next to this backend's models (picker rows, transcript header) so
   * a reply visibly comes from the vendor that answered it, not from
   * whichever provider happens to be selected today. A deliberately generic
   * glyph, not that vendor's real mark — same trademark-avoidance rule as
   * `sparkle` in src/lib/icons.ts, just applied per-vendor instead of once.
   *
   * An opaque KEY, not a glyph: the UI maps it to something drawable
   * (src/lib/providerIcon.ts) and falls back if it doesn't recognise one.
   */
  icon: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ---- Local runtimes: no key, default ports, host permission already
  // baked in (decisions/09) --------------------------------------------
  {
    id: "ollama",
    label: "Ollama",
    type: "ollama",
    baseUrl: "http://localhost:11434",
    requiresKey: false,
    local: true,
    docsUrl: "https://ollama.com/download",
    icon: "ollama",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    type: "openai",
    baseUrl: "http://localhost:1234",
    requiresKey: false,
    local: true,
    docsUrl: "https://lmstudio.ai/docs/app/api",
    note: "Start LM Studio's local server (Developer tab → Start Server) before connecting.",
    icon: "widgets",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    type: "openai",
    baseUrl: "http://localhost:8080",
    requiresKey: false,
    local: true,
    docsUrl: "https://github.com/ggml-org/llama.cpp/tree/master/tools/server",
    note: "Start llama.cpp's server (llama-server) before connecting; it must already be running.",
    icon: "terminal",
  },

  // ---- Hosted OpenAI-compatible backends ------------------------------
  {
    id: "openai",
    label: "OpenAI",
    type: "openai",
    baseUrl: "https://api.openai.com",
    requiresKey: true,
    local: false,
    docsUrl: "https://platform.openai.com/api-keys",
    icon: "hexagon",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    type: "openai",
    baseUrl: "https://api.anthropic.com",
    requiresKey: true,
    local: false,
    docsUrl: "https://platform.claude.com/settings/keys",
    note: "Uses Anthropic's OpenAI SDK compatibility layer — some OpenAI-only request fields (response_format, logprobs, and others) are silently ignored rather than erroring.",
    icon: "diamond",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    type: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    requiresKey: true,
    local: false,
    docsUrl: "https://aistudio.google.com/app/apikey",
    note: "Uses Gemini's OpenAI-compatible endpoint.",
    icon: "sparkle",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    type: "openai",
    baseUrl: "https://openrouter.ai/api",
    requiresKey: true,
    local: false,
    docsUrl: "https://openrouter.ai/keys",
    icon: "alt_route",
  },
  {
    id: "groq",
    label: "Groq",
    type: "openai",
    baseUrl: "https://api.groq.com/openai",
    requiresKey: true,
    local: false,
    docsUrl: "https://console.groq.com/keys",
    icon: "bolt",
  },
  {
    id: "mistral",
    label: "Mistral",
    type: "openai",
    baseUrl: "https://api.mistral.ai",
    requiresKey: true,
    local: false,
    docsUrl: "https://console.mistral.ai/api-keys",
    icon: "air",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    type: "openai",
    baseUrl: "https://api.deepseek.com",
    requiresKey: true,
    local: false,
    docsUrl: "https://platform.deepseek.com/api_keys",
    icon: "explore",
  },
  {
    id: "xai",
    label: "xAI",
    type: "openai",
    baseUrl: "https://api.x.ai",
    requiresKey: true,
    local: false,
    docsUrl: "https://console.x.ai/team/default/api-keys",
    icon: "close",
  },
  {
    id: "together",
    label: "Together",
    type: "openai",
    baseUrl: "https://api.together.ai",
    requiresKey: true,
    local: false,
    docsUrl: "https://api.together.ai/settings/api-keys",
    icon: "group",
  },
];

/** Fallback for a provider with no matching preset — a hand-added "Custom (OpenAI-compatible)" provider, or a `presetId` that no longer matches this catalog. See {@link iconKeyForProvider}. */
const DEFAULT_PROVIDER_ICON_KEY = "smart_toy";

/**
 * The icon KEY to show next to a provider's models (picker rows, transcript
 * header) — {@link getPreset}'s icon when `presetId` still matches a known
 * backend, else a type-appropriate fallback so an unrecognized provider
 * still reads as "local runtime" vs. "some OpenAI-compatible API" rather
 * than defaulting to one specific vendor's glyph.
 *
 * Returns a key, never a glyph: `iconForProvider` in src/lib/providerIcon.ts
 * is the UI-layer resolver that turns it into something Icon.svelte can draw.
 */
export function iconKeyForProvider(provider: { type: ProviderType; presetId?: string }): string {
  const preset = getPreset(provider.presetId);
  if (preset) return preset.icon;
  return provider.type === "ollama" ? "ollama" : DEFAULT_PROVIDER_ICON_KEY;
}

/** Look up a preset by its stored `ProviderConfig.presetId`. `undefined` for an id that doesn't (or no longer) matches any catalog entry — e.g. a since-removed preset, or absence meaning Custom (decisions/21: "no migration required, absence is a valid state"). Callers must treat that the same as "no preset" rather than erroring. */
export function getPreset(id: string | undefined): ProviderPreset | undefined {
  if (!id) return undefined;
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
