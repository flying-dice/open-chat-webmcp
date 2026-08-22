// The one place this repo triggers a browser file download (card 116, chat
// export) — mirrors ./clipboard.ts's "one call site" reasoning: a second
// export feature should reuse this rather than hand-roll a second anchor/
// object-URL dance.
//
// A `data:` URI rather than `Blob` + `URL.createObjectURL`: an exported chat
// transcript is at most a few hundred KB of text, well inside what Chrome
// accepts in a `data:` href, and it means this needs nothing beyond
// `document` — no object-URL lifecycle to create and remember to revoke, and
// nothing jsdom doesn't already implement for this file's own test.

/**
 * Trigger a browser download of `content` as `filename`. A no-op outside a
 * DOM (never expected in practice — this is only ever called from a
 * component's click handler — but matches ./clipboard.ts's defensive
 * posture for an environment that doesn't have one).
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/markdown",
): void {
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  anchor.download = filename;
  anchor.click();
}
