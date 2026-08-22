// `chat` bounded context — see ./README.md for what lands here and from
// where. Empty until cards 74-79 extract the session aggregate out of
// src/lib/session.ts and the turn policy out of
// src/sidepanel/services/agentLoop.ts.
//
// This barrel is the context's public face: other contexts and the outer
// layers import `src/domain/chat`, never a file inside it.

export {};
