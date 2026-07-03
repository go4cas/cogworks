/**
 * F-5 vector search hardening: the in-process KNN no longer silently caps
 * candidates at 10K — the bound is configurable (`vector.max_candidates`) and a
 * `_vector.truncated` flag surfaces when it bites. Parsed vectors are cached
 * (keyed by a content hash of the raw JSON) so repeated queries don't re-parse,
 * yet any edit is reflected immediately, and `_score` survives a projection.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setLogsDir } from "../core/file-logger.ts";
import { createCollection } from "../core/collections.ts";
import { createRecord, updateRecord, vectorSearch } from "../core/records.ts";
import { setSetting } from "../api/settings.ts";
import { parseVectorCached, clearVectorCache } from "../core/vector.ts";

let tmpDir: string;
const FIELDS = [
  { name: "title", type: "text" },
  { name: "embedding", type: "vector", required: false, options: { dimensions: 3 } },
];

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cogworks-vec-"));
  setLogsDir(tmpDir);
  initDb(":memory:");
  await runMigrations();
  clearVectorCache();
});
afterEach(() => {
  closeDb();
  try {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* swallow */
  }
});

/** Seed docN for each embedding (cosine is direction-based, so vary direction). */
async function seedDocs(embeddings: number[][]) {
  await createCollection({ name: "docs", fields: JSON.stringify(FIELDS) });
  const ids: string[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    const r = await createRecord("docs", { title: `doc${i}`, embedding: embeddings[i] });
    ids.push(r.id as string);
  }
  return ids;
}

// Five distinct directions — doc4 ([1,0,1]) is the unique best match for [1,0,1].
const DIRS = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
];

describe("vectorSearch — candidate cap + truncation", () => {
  it("honors vector.max_candidates and flags truncation (no silent 10K cap)", async () => {
    await seedDocs(DIRS);
    setSetting("vector.max_candidates", "3");
    const res = await vectorSearch("docs", "embedding", [1, 0, 0], { limit: 10 });
    expect(res.scanned).toBe(3); // capped
    expect(res.truncated).toBe(true);

    setSetting("vector.max_candidates", "100");
    const full = await vectorSearch("docs", "embedding", [1, 0, 0], { limit: 10 });
    expect(full.scanned).toBe(5);
    expect(full.truncated).toBe(false);
  });

  it("finds a match beyond the old fixed cap once the cap is raised", async () => {
    // The exact-match doc is the LAST inserted (highest rowid) → excluded by a
    // small cap, included by a large one.
    await seedDocs(DIRS);
    const query = [1, 0, 1]; // doc4's direction

    setSetting("vector.max_candidates", "3");
    const capped = await vectorSearch("docs", "embedding", query, { limit: 1 });
    expect(capped.truncated).toBe(true);
    expect((capped.data[0] as Record<string, unknown>).title).not.toBe("doc4");

    setSetting("vector.max_candidates", "100");
    const full = await vectorSearch("docs", "embedding", query, { limit: 1 });
    expect(full.truncated).toBe(false);
    expect((full.data[0] as Record<string, unknown>).title).toBe("doc4");
    expect((full.data[0] as Record<string, unknown>)._score as number).toBeCloseTo(1, 5);
  });
});

describe("vectorSearch — scoring + projection", () => {
  it("attaches _score and it survives a fields projection", async () => {
    await seedDocs(DIRS.slice(0, 3));
    const res = await vectorSearch("docs", "embedding", [1, 0, 0], {
      limit: 3,
      fields: "title",
    });
    for (const row of res.data) {
      const r = row as Record<string, unknown>;
      expect(typeof r._score).toBe("number");
      expect(r.title).toBeDefined();
      expect(r.embedding).toBeUndefined(); // projected out
    }
  });

  it("composes with a filter — only filtered rows are ranked", async () => {
    await seedDocs(DIRS.slice(0, 4));
    const res = await vectorSearch("docs", "embedding", [1, 0, 0], {
      filter: "title = 'doc2'",
      limit: 10,
    });
    expect(res.data).toHaveLength(1);
    expect((res.data[0] as Record<string, unknown>).title).toBe("doc2");
  });
});

describe("vectorSearch — reflects writes (cache invalidation)", () => {
  it("re-ranks after a vector is updated", async () => {
    const ids = await seedDocs([
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]); // all on x-axis
    const q = [0, 1, 0];
    // Nothing aligns with [0,1,0] yet → all scores ~0.
    const before = await vectorSearch("docs", "embedding", q, { limit: 1 });
    expect((before.data[0] as Record<string, unknown>)._score as number).toBeLessThan(0.5);

    // Point doc1 straight at the query.
    await updateRecord("docs", ids[1]!, { embedding: [0, 5, 0] });
    const after = await vectorSearch("docs", "embedding", q, { limit: 1 });
    expect((after.data[0] as Record<string, unknown>).title).toBe("doc1");
    expect((after.data[0] as Record<string, unknown>)._score as number).toBeCloseTo(1, 5);
  });
});

describe("parseVectorCached", () => {
  it("reuses the cached Float32Array while the raw JSON is unchanged", () => {
    const a = parseVectorCached("k:f", "id1", "[1,2,3]");
    const b = parseVectorCached("k:f", "id1", "[1,2,3]"); // identical content → cache hit
    expect(a).toBe(b); // same object reference (no re-parse)

    const c = parseVectorCached("k:f", "id1", "[9,9,9]"); // content changed → re-parse
    expect(c).not.toBe(a);
    expect(Array.from(c!)).toEqual([9, 9, 9]);
  });

  it("returns null on malformed / non-numeric vectors", () => {
    expect(parseVectorCached("k:f", "bad1", "not json")).toBeNull();
    expect(parseVectorCached("k:f", "bad2", '{"x":1}')).toBeNull();
    expect(parseVectorCached("k:f", "bad3", '[1,"two",3]')).toBeNull();
  });
});
