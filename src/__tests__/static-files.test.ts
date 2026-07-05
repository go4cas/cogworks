/**
 * Static-site serving (COGWORKS_PUBLIC_DIR). Resolution order, directory index,
 * extensionless→.html, SPA fallback, path-traversal guard, and content types.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setPublicDir, servePublicFile, publicServingEnabled } from "../core/static-files.ts";

describe("static-files", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pub-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>home</title>");
    writeFileSync(join(dir, "about.html"), "<h1>about</h1>");
    writeFileSync(join(dir, "style.css"), "body{color:red}");
    mkdirSync(join(dir, "blog"));
    writeFileSync(join(dir, "blog", "index.html"), "<h1>blog</h1>");
    writeFileSync(join(dir, "secret-sibling.txt"), "SHOULD NOT LEAK");
    setPublicDir(dir);
  });

  afterEach(() => {
    setPublicDir("");
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      /* swallow */
    }
  });

  async function body(res: Response | null): Promise<string | null> {
    return res ? await res.text() : null;
  }

  it("is disabled when no dir is set", () => {
    setPublicDir("");
    expect(publicServingEnabled()).toBe(false);
    expect(servePublicFile("/index.html")).toBeNull();
  });

  it("serves the root index for / and empty path", async () => {
    expect(await body(servePublicFile("/"))).toContain("home");
    expect(await body(servePublicFile(""))).toContain("home");
  });

  it("serves an exact file with inferred content-type", async () => {
    const res = servePublicFile("/style.css");
    expect(await body(res)).toBe("body{color:red}");
    expect(res!.headers.get("content-type")).toContain("text/css");
    expect(res!.headers.get("cache-control")).toContain("max-age");
  });

  it("resolves an extensionless path to .html (no-cache)", async () => {
    const res = servePublicFile("/about");
    expect(await body(res)).toContain("about");
    expect(res!.headers.get("content-type")).toContain("text/html");
    expect(res!.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves a directory index (with and without trailing slash)", async () => {
    expect(await body(servePublicFile("/blog/"))).toContain("blog");
    expect(await body(servePublicFile("/blog"))).toContain("blog");
  });

  it("returns null for a missing file", () => {
    expect(servePublicFile("/nope")).toBeNull();
    expect(servePublicFile("/deep/missing.js")).toBeNull();
  });

  it("blocks path traversal", () => {
    expect(servePublicFile("/../secret-sibling.txt")).toBeNull();
    expect(servePublicFile("/../../etc/passwd")).toBeNull();
    expect(servePublicFile("/%2e%2e/secret-sibling.txt")).toBeNull();
  });

  it("SPA fallback serves root index for unmatched extensionless paths only when enabled", async () => {
    // off by default
    expect(servePublicFile("/app/deep/route")).toBeNull();
    // on
    setPublicDir(dir, true);
    expect(await body(servePublicFile("/app/deep/route"))).toContain("home");
    // still 404s a missing asset (has an extension)
    expect(servePublicFile("/app/missing.js")).toBeNull();
  });
});
