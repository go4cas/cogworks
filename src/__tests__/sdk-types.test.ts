/**
 * F-3 typed SDK generator. Derived from collection field defs — one type per
 * collection (record/create/update), a `CogworksSchema` registry, and a thin
 * typed client. Field inclusion mirrors F-2 (openapi): password/system dropped
 * from read, autodate/system dropped from write. Plus the `/sdk/types.ts`
 * endpoint and its `docs.enabled` gate.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setLogsDir } from "../core/file-logger.ts";
import { createCollection, listCollections } from "../core/collections.ts";
import { setSetting } from "./../api/settings.ts";
import { buildSdkTypes } from "../core/sdk-types.ts";
import { makeOpenApiPlugin } from "../api/openapi.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cogworks-sdk-"));
  setLogsDir(tmpDir);
  initDb(":memory:");
  await runMigrations();
});
afterEach(() => {
  closeDb();
  try {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* swallow */
  }
});

async function seed() {
  await createCollection({
    name: "posts",
    fields: JSON.stringify([
      { name: "title", type: "text", required: true },
      { name: "views", type: "number" },
      { name: "published", type: "bool" },
      { name: "status", type: "select", options: { values: ["draft", "published"] } },
      { name: "tags", type: "select", options: { multiple: true, values: ["a", "b"] } },
      { name: "cover", type: "file", options: { multiple: true } },
      { name: "author", type: "relation", collection: "posts" },
      { name: "secret", type: "password" },
    ]),
  });
  await createCollection({
    name: "pview",
    type: "view",
    view_query: "SELECT id, title FROM cw_posts",
  } as never);
}

const build = async () =>
  buildSdkTypes(await listCollections(), { serverUrl: "", version: "1.2.3" });

describe("buildSdkTypes", () => {
  it("emits a record interface with meta + typed fields; drops password", async () => {
    await seed();
    const ts = await build();
    expect(ts).toContain("export interface Posts {");
    expect(ts).toContain("  id: string;");
    expect(ts).toContain("  created: number;");
    expect(ts).toContain("  title: string;");
    expect(ts).toContain("  views: number;");
    expect(ts).toContain("  published: boolean;");
    // password field is never in the read type
    expect(ts).not.toContain("secret:");
  });

  it("maps select to unions and multiple to arrays", async () => {
    await seed();
    const ts = await build();
    expect(ts).toContain('status: "draft" | "published";');
    expect(ts).toContain('tags: ("a" | "b")[];');
    expect(ts).toContain("cover: string[];"); // multiple file
    expect(ts).toContain("author: string;"); // single relation
  });

  it("create requires required fields; update makes all optional; create keeps password", async () => {
    await seed();
    const ts = await build();
    const create = ts.slice(ts.indexOf("export interface PostsCreate"));
    expect(create).toContain("  title: string;"); // required → no `?`
    expect(create).toContain("  views?: number;"); // optional
    expect(create).toContain("  secret?: string;"); // password writable on create
    const update = ts.slice(ts.indexOf("export interface PostsUpdate"));
    expect(update).toContain("  title?: string;"); // update optional-all
  });

  it("views are read-only in the registry; base collections carry create/update", async () => {
    await seed();
    const ts = await build();
    expect(ts).toContain("export interface CogworksSchema {");
    expect(ts).toContain("posts: { record: Posts; create: PostsCreate; update: PostsUpdate };");
    expect(ts).toContain("pview: { record: Pview; create: never; update: never };");
    // no create/update interfaces for a view
    expect(ts).not.toContain("export interface PviewCreate");
  });

  it("includes a thin typed client", async () => {
    await seed();
    const ts = await build();
    expect(ts).toContain("export class Cogworks {");
    expect(ts).toContain("collection<K extends keyof CogworksSchema>");
    expect(ts).toContain("export class CogworksError");
  });
});

describe("GET /sdk/types.ts", () => {
  it("serves TypeScript when docs enabled", async () => {
    await seed();
    const app = makeOpenApiPlugin();
    const res = await app.request("/sdk/types.ts");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/typescript");
    const body = await res.text();
    expect(body).toContain("export interface Posts {");
    expect(body).toContain("export class Cogworks {");
  });

  it("404s when docs.enabled is off", async () => {
    await seed();
    setSetting("docs.enabled", "0");
    const app = makeOpenApiPlugin();
    const res = await app.request("/sdk/types.ts");
    expect(res.status).toBe(404);
  });
});
