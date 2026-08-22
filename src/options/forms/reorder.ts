// The one-step list reorder both options-page registries do (card 113).
//
// ProvidersSection.svelte and McpServersSection.svelte each had a
// byte-identical `handleMove(index, direction)` — the bounds check, the
// in-range-but-still-defensive element lookup that satisfies
// `noUncheckedIndexedAccess`, and the copy-and-swap — before persisting the
// new id order through their own registry port. That swap is the part with no
// registry in it at all, so it lives here, pure and testable, and each
// section keeps the halves that ARE its own: which port it writes to and what
// it says when the write fails.
//
// Deliberately NOT in src/domain: "swap two adjacent array elements" is not a
// rule about providers or MCP servers, it is a list mechanic this surface's
// two lists share. Putting it in a bounded context would give the domain a
// vocabulary word it has no use for.

/**
 * `items` with the element at `index` swapped one step in `direction`, or
 * `undefined` when that step would run off either end — the caller's cue to
 * do nothing at all (no optimistic render, no write).
 *
 * Returns a NEW array; the input is never mutated, so a caller can hand the
 * result straight to reactive state and keep the previous value to fall back
 * on.
 */
export function reorderStep<T>(items: T[], index: number, direction: -1 | 1): T[] | undefined {
  const target = index + direction;
  if (target < 0 || target >= items.length) return undefined;
  const current = items[index];
  const swapped = items[target];
  // Both indices are in range (checked above), so neither lookup can actually
  // miss — this is what makes that provable to `noUncheckedIndexedAccess`
  // rather than asserted past it with a `!`.
  if (!current || !swapped) return undefined;
  const next = [...items];
  next[index] = swapped;
  next[target] = current;
  return next;
}
