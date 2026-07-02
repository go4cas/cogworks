import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDb, initDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setSetting } from "../api/settings.ts";
import { isOriginAllowed } from "../server.ts";

// The realtime (WS/SSE) origin gate: a present Origin must be allowlisted
// (blocks cross-site browsers, which always send one); an absent Origin is
// allowed (non-browser clients — server-side SDK, mobile, CLI — never send one
// and auth by explicit bearer token, so they can't ride a cross-site session).
describe("isOriginAllowed", () => {
  beforeEach(async () => {
    initDb(":memory:");
    await runMigrations();
  });
  afterEach(() => closeDb());

  it("allows an absent Origin even with a specific allowlist", () => {
    setSetting("cors.origins", "https://app.example.com");
    expect(isOriginAllowed(null)).toBe(true);
    expect(isOriginAllowed("")).toBe(true);
  });

  it("rejects a present, non-allowlisted Origin (cross-site browser)", () => {
    setSetting("cors.origins", "https://app.example.com");
    expect(isOriginAllowed("https://evil.example.com")).toBe(false);
  });

  it("allows a present, allowlisted Origin", () => {
    setSetting("cors.origins", "https://app.example.com");
    expect(isOriginAllowed("https://app.example.com")).toBe(true);
  });

  it("wildcard allowlist permits any present Origin", () => {
    setSetting("cors.origins", "*");
    expect(isOriginAllowed("https://anything.example.com")).toBe(true);
  });

  it("with no allowlist, rejects a present Origin but still allows absent", () => {
    expect(isOriginAllowed("https://app.example.com")).toBe(false);
    expect(isOriginAllowed(null)).toBe(true);
  });
});
