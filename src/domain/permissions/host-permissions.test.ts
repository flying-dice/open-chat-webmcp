// Tests for `originPatternForUrl` (card 78) — the RULE half of
// ./host-permissions.ts. `HostPermissions` itself is a driven port with no
// implementation in the domain (the adapter lives in
// src/infra/chrome-runtime/permissions.ts), so there is nothing pure to unit
// test there; this suite covers the URL -> match-pattern parsing only.

import { describe, expect, it } from "vitest";
import { originPatternForUrl } from "./host-permissions";

describe("originPatternForUrl", () => {
  it("turns a plain https URL into an origin-only match pattern", () => {
    expect(originPatternForUrl("https://example.com")).toBe("https://example.com/*");
  });

  it("turns a plain http URL into an origin-only match pattern", () => {
    expect(originPatternForUrl("http://example.com")).toBe("http://example.com/*");
  });

  it("keeps an explicit port as part of the host", () => {
    expect(originPatternForUrl("http://example.com:8080")).toBe("http://example.com:8080/*");
  });

  it("strips a path, query string and fragment down to the origin", () => {
    expect(originPatternForUrl("https://example.com/api/v1/tools?x=1&y=2#frag")).toBe(
      "https://example.com/*",
    );
  });

  it("strips a path while keeping a port", () => {
    expect(originPatternForUrl("http://example.com:11434/api/generate")).toBe(
      "http://example.com:11434/*",
    );
  });

  it("accepts an IPv4-literal host", () => {
    expect(originPatternForUrl("http://192.168.1.5:11434/api")).toBe(
      "http://192.168.1.5:11434/*",
    );
  });

  it("accepts an IPv6-literal host, keeping the bracket syntax", () => {
    expect(originPatternForUrl("http://[::1]:8080/path")).toBe("http://[::1]:8080/*");
  });

  it("accepts localhost", () => {
    expect(originPatternForUrl("http://localhost:11434")).toBe("http://localhost:11434/*");
  });

  it("accepts 127.0.0.1", () => {
    expect(originPatternForUrl("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/*");
  });

  it("lowercases scheme and host the way URL parsing normally does", () => {
    expect(originPatternForUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/*");
  });

  it.each([
    ["ftp://example.com/file"],
    ["file:///etc/passwd"],
    ["ws://example.com"],
    ["wss://example.com"],
    ["chrome-extension://abcdefg/page.html"],
    ["data:text/plain,hello"],
    ["mailto:someone@example.com"],
  ])("returns undefined for a non-http(s) scheme: %s", (url) => {
    expect(originPatternForUrl(url)).toBeUndefined();
  });

  it.each([
    ["not a url at all"],
    [""],
    ["http://"],
    ["   "],
    ["://missing-scheme"],
  ])("returns undefined rather than throwing for unparseable input: %j", (url) => {
    expect(() => originPatternForUrl(url)).not.toThrow();
    expect(originPatternForUrl(url)).toBeUndefined();
  });

  it("treats a bare host with no scheme as unparseable, not as implicitly http", () => {
    expect(originPatternForUrl("example.com")).toBeUndefined();
  });
});
