// Card 107 (decisions/37-i18n-paraglide.md, decisions/15-custom-headers-are-credentials.md).
//
// The LOCALIZED copy for the two independent reserved-header rules
// (src/domain/providers/provider.ts's `reservedHeaderReason`,
// src/domain/tools/servers.ts's `validateServerHeaders`) — exercises every
// member of both codes, mirroring the sibling ui/*Message.test.ts files.

import { describe, expect, it } from "vitest";
import type { ReservedHeaderReason } from "../domain/providers";
import type { McpReservedHeaderCode } from "../domain/tools";
import { m } from "../paraglide/messages.js";
import { mcpReservedHeaderMessage, providerReservedHeaderMessage } from "./reservedHeaderMessage";

describe("providerReservedHeaderMessage", () => {
  it("renders the wire-format sentence for content-type, with the canonical header name", () => {
    const reason: ReservedHeaderReason = { kind: "content-type", header: "Content-Type" };
    expect(providerReservedHeaderMessage(reason)).toBe(
      m.reservedHeader_wireFormat({ header: "Content-Type" }),
    );
  });

  it("renders the wire-format sentence for accept, with the canonical header name", () => {
    const reason: ReservedHeaderReason = { kind: "accept", header: "Accept" };
    expect(providerReservedHeaderMessage(reason)).toBe(
      m.reservedHeader_wireFormat({ header: "Accept" }),
    );
  });

  it("renders the API-key sentence for authorization-api-key", () => {
    const reason: ReservedHeaderReason = {
      kind: "authorization-api-key",
      header: "Authorization",
    };
    expect(providerReservedHeaderMessage(reason)).toBe(m.reservedHeader_authorizationApiKey());
  });
});

describe("mcpReservedHeaderMessage", () => {
  it("renders the client-controlled sentence with the header name as typed", () => {
    const code: McpReservedHeaderCode = "client-controlled";
    expect(mcpReservedHeaderMessage("content-type", code)).toBe(
      m.reservedHeader_clientControlled({ header: "content-type" }),
    );
    expect(mcpReservedHeaderMessage("Accept", code)).toBe(
      m.reservedHeader_clientControlled({ header: "Accept" }),
    );
  });

  it("renders the bearer-token sentence for authorization-bearer-token", () => {
    const code: McpReservedHeaderCode = "authorization-bearer-token";
    expect(mcpReservedHeaderMessage("Authorization", code)).toBe(
      m.reservedHeader_authorizationBearerToken(),
    );
  });
});
