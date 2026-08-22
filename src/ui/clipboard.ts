// The one `navigator.clipboard` call site (card 95,
// decisions/34-errors-as-values.md).
//
// Four components each had their own `try { await
// navigator.clipboard.writeText(...) } catch { /* never mind */ }`: the copy
// button on a code block (src/ui/components/Markdown.svelte), on an assistant
// message (src/sidepanel/components/MessageActions.svelte), on a tool-call log
// entry (src/sidepanel/components/CallLogEntry.svelte) and on the OAuth
// redirect URI (src/options/components/McpServerForm.svelte). Each catch was
// correct and each was in the wrong layer: decision 34 leaves catch-alls at a
// PLATFORM BOUNDARY and in never-throws wrappers, not in a component. This is
// that wrapper, and it is the only one this repo needs for the clipboard.
//
// WHY A BOOLEAN AND NOT A `Result`. There is exactly one failure — the browser
// refused — and it arrives for reasons no caller can distinguish or act on
// differently (no user gesture, an insecure context, a permissions policy, a
// document that is not focused). Every caller does the same thing with it:
// skip the "Copied!" confirmation and leave the text on screen to select by
// hand. An error VOCABULARY here would be invented rather than modelled, which
// decision 34 is explicit about not wanting.

/**
 * Copy `text` to the clipboard. Never throws and never rejects: `true` when
 * the browser took it, `false` when it refused or the API is missing
 * altogether (an older or locked-down context).
 *
 * A `false` is not worth a notice — the copy button simply doesn't confirm.
 * Callers should never gate anything important on it.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
