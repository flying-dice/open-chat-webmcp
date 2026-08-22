/**
 * Formats an elapsed duration for display, lifted out of
 * CallLogEntry.svelte's `durationLabel` (card 11) so card 60/61's live
 * "calling…" elapsed-time indicator can share the exact same rule rather
 * than growing a second inlined copy. Sub-second durations are shown in
 * whole milliseconds (no decimal — precision there isn't meaningful to a
 * human), anything at or above one second is shown in seconds to one
 * decimal place.
 */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
