// `ChatProvider` adapter for the raw Ollama REST client in ./client.ts —
// translates between Ollama's wire habits (NDJSON, no auth, no call ids)
// and the shared vocabulary in src/domain/providers/provider.ts
// (decisions/09-provider-agnostic-chat-transport.md,
// decisions/11-provider-capability-detection.md). Ollama is the one
// adapting here, not the other way round — see src/domain/providers/provider.ts's header
// comment for why the interface is shaped the way it is.

import type { Result } from "../../domain/result";
import { fail, ok } from "../../domain/result";
import type {
  ChatMessage,
  ChatParams,
  ChatProvider,
  ChatStreamEvent,
  ModelCapabilityCache,
  ProviderConfig,
  ProviderDefaultsStore,
  ProviderError,
  ProviderModel,
  ToolCall,
} from "../../domain/providers";
import {
  chat as ollamaChat,
  getCapabilities as ollamaGetCapabilities,
  listModels as ollamaListModels,
  type OllamaChatMessage,
  type OllamaModel,
  type OllamaToolCall,
} from "./client";

function toProviderModel(model: OllamaModel): ProviderModel {
  return { id: model.name, name: model.name, cacheKey: model.digest };
}

function toOllamaToolCall(call: ToolCall): OllamaToolCall {
  // Outbound only (replaying history back to Ollama) — no `id`, since
  // Ollama's wire format has no concept of one to send.
  return { function: { name: call.name, arguments: call.arguments } };
}

function toOllamaMessage(message: ChatMessage): OllamaChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls && message.toolCalls.length > 0
      ? { tool_calls: message.toolCalls.map(toOllamaToolCall) }
      : {}),
    ...(message.toolName ? { tool_name: message.toolName } : {}),
  };
}

function toChatToolCall(call: OllamaToolCall): ToolCall {
  return {
    // Always present on an inbound call — synthesized by src/lib/ollama.ts's
    // stream parser, since Ollama itself assigns no call ids. The fallback
    // is defensive only; it should never be hit in practice.
    id: call.id ?? "",
    name: call.function.name,
    arguments: call.function.arguments,
  };
}

function toChatMessage(message: OllamaChatMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_calls && message.tool_calls.length > 0
      ? { toolCalls: message.tool_calls.map(toChatToolCall) }
      : {}),
  };
}

/**
 * The storage ports the raw client needs (card 74). Supplied by whichever
 * composition-root wiring builds this provider (card 75:
 * the `createProviderClientFactory` map in each composition root)
 * rather than reached for here, so neither this adapter nor ./client.ts
 * imports src/infra/chrome-storage — which is what keeps this folder from
 * breaking `adapters-do-not-import-adapters`.
 */
export interface OllamaProviderStores {
  capabilityCache?: ModelCapabilityCache;
  defaults?: ProviderDefaultsStore;
}

async function* adaptChatStream(
  baseUrl: string,
  headers: ProviderConfig["headers"],
  params: ChatParams,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const stream = ollamaChat({
    model: params.model,
    messages: params.messages.map(toOllamaMessage),
    tools: params.tools,
    signal: params.signal,
    baseUrl,
    headers,
  });

  for await (const event of stream) {
    switch (event.type) {
      case "content":
        yield event;
        break;
      case "tool-calls":
        yield {
          type: "tool-calls",
          toolCalls: event.toolCalls.map(toChatToolCall),
        };
        break;
      case "done":
        yield {
          type: "done",
          message: toChatMessage(event.message),
          stats: {
            // `ChatStats.doneReason` (src/domain/providers/provider.ts, not
            // this folder's to widen) is optional without `| undefined` —
            // conditional spread so an absent reason omits the key instead
            // of assigning it `undefined`.
            ...(event.stats.doneReason !== undefined && { doneReason: event.stats.doneReason }),
            // Ollama's duration breakdown has no cross-provider equivalent
            // (decisions/09) — surfaced as-is for diagnostics under `raw`
            // rather than forced into `promptTokens`/`completionTokens`.
            raw: { ...event.stats },
          },
        };
        break;
      case "error":
        yield { type: "error", error: event.error };
        break;
    }
  }
}

/**
 * Build a `ChatProvider` bound to one resolved Ollama provider config.
 * `config.headers` (decisions/15-custom-headers-are-credentials.md) is
 * threaded through to every wire call below — useful for a user running
 * Ollama behind a gateway that wants its own headers, not just the local,
 * auth-free case this client was originally built for.
 */
export function createOllamaProvider(
  config: ProviderConfig,
  stores: OllamaProviderStores = {},
): ChatProvider {
  const baseUrl = config.baseUrl;
  const headers = config.headers;

  return {
    type: "ollama",

    async listModels(opts): Promise<Result<ProviderModel[], ProviderError>> {
      // `OllamaError` is a subset of `ProviderError` and `Result` is a
      // readonly tuple, so the failure arm widens on its own — there is
      // nothing to map at this boundary, only the value side to translate.
      const [models, err] = await ollamaListModels({ baseUrl, headers, signal: opts?.signal });
      if (err) return fail(err);
      return ok(models.map(toProviderModel));
    },

    // Ollama's `ModelCapabilities` result is already the shared shape
    // (src/lib/ollama.ts imports it from src/domain/providers/provider.ts directly), so
    // there is nothing to convert here beyond supplying the digest cache
    // key from `model.cacheKey`.
    getCapabilities(model, opts) {
      return ollamaGetCapabilities(
        { name: model.id, digest: model.cacheKey ?? model.id },
        {
          baseUrl,
          headers,
          signal: opts?.signal,
          forceRefresh: opts?.forceRefresh,
          capabilityCache: stores.capabilityCache,
          defaults: stores.defaults,
        },
      );
    },

    chat(params: ChatParams) {
      return adaptChatStream(baseUrl, headers, params);
    },
  };
}
