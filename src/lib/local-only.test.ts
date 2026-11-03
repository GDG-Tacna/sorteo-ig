import { describe, expect, it } from "vitest";
import { isLocalRequest } from "./local-only";

describe("isLocalRequest", () => {
  it("accepts requests from the app itself on this machine", () => {
    expect(
      isLocalRequest("localhost:3000", "http://localhost:3000")
    ).toBe(true);
    expect(
      isLocalRequest("127.0.0.1:3000", "http://127.0.0.1:3000")
    ).toBe(true);
    expect(isLocalRequest("[::1]:3000", "http://[::1]:3000")).toBe(true);
  });

  it("accepts same-machine requests without an Origin header", () => {
    expect(isLocalRequest("localhost:3000", null)).toBe(true);
  });

  it("rejects other websites calling localhost from the browser", () => {
    expect(isLocalRequest("localhost:3000", "https://evil.example")).toBe(false);
    expect(isLocalRequest("localhost:3000", "http://localhost:4000")).toBe(false);
    expect(isLocalRequest("localhost:3000", "null")).toBe(false);
  });

  it("rejects public hostnames, DNS rebinding and network addresses", () => {
    expect(isLocalRequest("sorteos.gdgtacna.com", null)).toBe(false);
    expect(isLocalRequest("evil.example:3000", "http://evil.example:3000")).toBe(
      false
    );
    expect(isLocalRequest("192.168.1.20:3000", null)).toBe(false);
    expect(isLocalRequest(null, null)).toBe(false);
  });
});
