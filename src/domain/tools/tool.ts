// The tool-descriptor vocabulary every layer speaks (card 73,
// decisions/29-ddd-hexagonal-typescript-layout.md).
//
// These two types used to live in src/lib/protocol.ts, which is a
// `chrome.runtime` messaging contract and therefore infrastructure — but
// `SerializedTool` is what `ChatProvider.chat()` takes
// (src/domain/providers/provider.ts) and what `toSerializedTools` produces
// (./merge.ts), so the DOMAIN owns the shape and the protocol adapter merely
// carries it. src/lib/protocol.ts kept a re-export of both names for a
// while so existing importers of `protocol` did not have to change; card 76
// deleted that shim once its last importer was gone, and this barrel is now
// the only place either name comes from.

/**
 * The WebMCP `ToolAnnotations` dictionary has exactly these two members,
 * both defaulting to `false` — confirmed against Chrome 151/152's actual
 * `getTools()` output (decisions/16, decisions/17-spec-annotations-and-untrusted-content.md).
 * There is no `destructiveHint`: it is not in the IDL, and because
 * `ToolAnnotations` is a WebIDL dictionary, WebIDL conversion silently
 * discards any unknown member a page sets — so a page-set `destructiveHint`
 * never reaches us, it isn't merely unused. Do not re-add it.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  /**
   * True when this tool's results may contain attacker-influenced content
   * (e.g. text authored by another user of the page) that gets fed straight
   * back into the model's context. Consumers must fence such results rather
   * than trusting them as instructions — see
   * src/domain/chat's `fenceUntrustedContent` and
   * decisions/17. Like `readOnlyHint`, this is page-supplied and not a
   * security guarantee: a hostile page can omit it.
   */
  untrustedContentHint?: boolean;
  [key: string]: unknown;
}

/**
 * A WebMCP tool descriptor as reported to the rest of the extension.
 *
 * This is always plain JSON — never a live object/closure. The relay builds
 * it from the native `ModelContextToolInfo` Chrome hands back from
 * `document.modelContext.getTools()`, which additionally carries a live
 * `window` reference and a JSON-*string* `inputSchema`
 * (decisions/16-native-webmcp-client.md); the relay strips the former and
 * parses the latter before anything crosses to the service worker, since
 * `window` is not structured-cloneable.
 *
 * There is no `source` field any more (native/polyfill/shim) — decision 16
 * deleted the MAIN-world bridge that made that distinction meaningful. Every
 * tool reported from here on is native, or it isn't reported at all.
 */
export interface SerializedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
}
