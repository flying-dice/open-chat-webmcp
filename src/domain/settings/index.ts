// `settings` bounded context — see ./README.md for what lands here and from
// where. Empty until cards 74-79 extract the approval policies out of
// src/lib/settings.ts and the auto-run predicates out of
// src/sidepanel/services/agentLoop.ts.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/settings`, never a file inside it.

export {};
