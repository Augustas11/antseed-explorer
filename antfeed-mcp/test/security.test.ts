import { describe, expect, it } from "vitest";
import { sanitizeMessage } from "../src/sanitize.js";

describe("sanitizeMessage", () => {
  it("redacts unix paths to <path>", () => {
    expect(sanitizeMessage("error at /home/alice/code/foo.ts:12:5 — boom")).toContain("<path>");
    expect(sanitizeMessage("error at /home/alice/code/foo.ts:12:5 — boom")).not.toContain("/home/alice");
  });

  it("redacts windows paths to <path>", () => {
    const out = sanitizeMessage("ENOENT at C:\\Users\\Bob\\.env");
    expect(out).toContain("<path>");
    expect(out).not.toContain("Bob");
  });

  it("redacts IPv4 addresses to <ip>", () => {
    expect(sanitizeMessage("ECONNREFUSED 192.168.1.42:5432")).toContain("<ip>");
    expect(sanitizeMessage("ECONNREFUSED 192.168.1.42:5432")).not.toContain("192.168.1.42");
  });

  it("redacts env-var values but keeps the variable name", () => {
    const out = sanitizeMessage("missing API_KEY=sk-secretvalue123");
    expect(out).toContain("API_KEY=<redacted>");
    expect(out).not.toContain("sk-secretvalue123");
  });

  it("truncates to 300 chars", () => {
    const long = "x".repeat(1000);
    expect(sanitizeMessage(long).length).toBe(300);
  });

  it("leaves clean messages intact", () => {
    expect(sanitizeMessage("simple message no secrets")).toBe("simple message no secrets");
  });

  it("redacts .json and .env paths too", () => {
    const out = sanitizeMessage("read /etc/secrets/keys.json failed");
    expect(out).toContain("<path>");
  });
});
