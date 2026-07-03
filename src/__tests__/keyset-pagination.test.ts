/**
 * E-1 keyset (cursor) pagination. Opt-in via `cursor` (absent = existing offset
 * behavior). Seeks by (sort-key, id) — O(log n), no OFFSET / COUNT. Verifies
 * full coverage with no dupes/gaps (incl. across tie groups via the id
 * tiebreaker), equivalence with offset ordering on a unique key, cursor
 * round-tripping, and the error paths.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setLogsDir } from "../core/file-logger.ts";
import { createCollection } from "../core/collections.ts";
import { createRecord, listRecords } from "../core/records.ts";
import { makeRecordsPlugin } from "../api/records.ts";

const SECRET = "test-secret-keyset";
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cogworks-keyset-"));
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

const FIELDS = [{ name: "n", type: "number" }];

async function seed(count: number, nFor: (i: number) => number) {
  await createCollection({ name: "items", fields: JSON.stringify(FIELDS) });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await createRecord("items", { n: nFor(i) });
    ids.push(r.id as string);
  }
  return ids;
}

/** Walk every keyset page, returning ids in order. */
async function walkKeyset(opts: { perPage: number; sort?: string; filter?: string }) {
  const ids: string[] = [];
  let cursor = "";
  let pages = 0;
  for (;;) {
    const res = await listRecords("items", {
      cursor,
      perPage: opts.perPage,
      ...(opts.sort ? { sort: opts.sort } : {}),
      ...(opts.filter ? { filter: opts.filter } : {}),
    });
    ids.push(...res.data.map((r) => r.id));
    pages++;
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
    if (pages > 1000) throw new Error("runaway keyset loop");
  }
  return { ids, pages };
}

describe("keyset pagination — coverage", () => {
  it("covers every row exactly once with no dupes/gaps (unique sort key)", async () => {
    const all = await seed(10, (i) => i); // distinct n
    const { ids } = await walkKeyset({ perPage: 3, sort: "n" });
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    // Equivalent to offset ordering on the same unique key.
    const offset = (await listRecords("items", { perPage: 1000, sort: "n" })).data.map((r) => r.id);
    expect(ids).toEqual(offset);
    expect(new Set(ids)).toEqual(new Set(all));
  });

  it("handles ties on the sort column (id tiebreaker prevents dupes/skips)", async () => {
    // All identical n → the entire order is decided by the id tiebreaker.
    const all = await seed(12, () => 42);
    const { ids } = await walkKeyset({ perPage: 5, sort: "n" });
    expect(ids).toHaveLength(12);
    expect(new Set(ids)).toEqual(new Set(all)); // every id exactly once
  });

  it("terminates with nextCursor=null when the last page is exactly full", async () => {
    await seed(4, (i) => i);
    const p1 = await listRecords("items", { cursor: "", perPage: 2, sort: "n" });
    expect(p1.data).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await listRecords("items", { cursor: p1.nextCursor!, perPage: 2, sort: "n" });
    expect(p2.data).toHaveLength(2);
    expect(p2.nextCursor).toBeNull(); // exact end → no phantom extra page
  });

  it("descending sort paginates correctly", async () => {
    await seed(7, (i) => i);
    const { ids } = await walkKeyset({ perPage: 2, sort: "-n" });
    const offset = (await listRecords("items", { perPage: 1000, sort: "-n" })).data.map(
      (r) => r.id,
    );
    expect(ids).toEqual(offset);
  });

  it("composes with a filter", async () => {
    await seed(10, (i) => i);
    const { ids } = await walkKeyset({ perPage: 2, sort: "n", filter: "n >= 5" });
    expect(ids).toHaveLength(5); // n = 5..9
    const offset = (
      await listRecords("items", { perPage: 1000, sort: "n", filter: "n >= 5" })
    ).data.map((r) => r.id);
    expect(ids).toEqual(offset);
  });

  it("keysets on id itself", async () => {
    const all = await seed(6, (i) => i);
    const { ids } = await walkKeyset({ perPage: 2, sort: "id" });
    expect(new Set(ids)).toEqual(new Set(all));
    expect(ids).toHaveLength(6);
  });
});

describe("keyset pagination — HTTP contract + errors", () => {
  it("returns { data, perPage, nextCursor } and no totalItems", async () => {
    await seed(5, (i) => i);
    const app = makeRecordsPlugin(SECRET);
    const res = await app.request(new Request("http://localhost/items?cursor=&perPage=2&sort=n"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.perPage).toBe(2);
    expect(typeof body.nextCursor).toBe("string");
    expect(body.totalItems).toBeUndefined(); // no COUNT in keyset mode
    expect(body.page).toBeUndefined();
  });

  it("absent cursor keeps the classic offset response (backward compatible)", async () => {
    await seed(5, (i) => i);
    const app = makeRecordsPlugin(SECRET);
    const res = await app.request(new Request("http://localhost/items?perPage=2&sort=n"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totalItems).toBe(5);
    expect(body.page).toBe(1);
    expect(body.nextCursor).toBeUndefined();
  });

  it("400 on an invalid cursor", async () => {
    await seed(3, (i) => i);
    const app = makeRecordsPlugin(SECRET);
    const res = await app.request(
      new Request("http://localhost/items?cursor=not-a-valid-cursor&sort=n"),
    );
    expect(res.status).toBe(400);
  });

  it("400 on multi-column sort with a cursor", async () => {
    await seed(3, (i) => i);
    const app = makeRecordsPlugin(SECRET);
    const res = await app.request(new Request("http://localhost/items?cursor=&sort=n,id"));
    expect(res.status).toBe(400);
  });
});
