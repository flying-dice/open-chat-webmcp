# domain/storage — the driven-port shared kernel

Not a bounded context. `chat`, `providers`, `tools` and `settings` are;
this is the one thing all four of their **storage** ports need to agree on
so an adapter has a single target to map platform failures into
(decisions/32-storage-ports-and-error-vocabulary.md).

| Lives here | Why |
| --- | --- |
| `StorageErrorKind` (`Unavailable` / `NotFound` / `Conflict` / `Corrupt` / `Unexpected`) and the `StorageError` it tags | every repository port reports exactly this, so `chrome.runtime.lastError`, a quota `DOMException` and a malformed record all stop at the adapter boundary — the domain never sees them |

It travels as a VALUE, not a `throw`: a storage port returns
`Result<T, StorageError>` from the OTHER shared kernel, `../result.ts`
(decisions/34-errors-as-values.md, card 92). Decision 32 originally had these
ports throw; only the delivery changed, and the vocabulary above is exactly as
that decision left it.

Nothing else belongs here. If something feels like it wants to live in
"shared domain", it is almost always a rule that belongs to one of the four
real contexts — put it there and let the others import that context's
barrel.

Nothing here may import `chrome.*`, `fetch`, the DOM, or Svelte. `index.ts`
is its only public face.
