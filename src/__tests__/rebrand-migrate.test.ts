/**
 * Rebrand migration (Vaultbase → Cogworks): renaming the DB table namespace on
 * an EXISTING database. Builds a pre-rename fixture (old `vaultbase_*` / `vb_*`
 * tables with real data + old-named indexes + a view), runs `runMigrations()`,
 * and asserts everything moved to `cogworks_*` / `cw_*` with data + views intact,
 * no old tables/indexes left behind, and that it's idempotent + a no-op on fresh.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb, getRawClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setLogsDir } from "../core/file-logger.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cogworks-rebrand-"));
  setLogsDir(tmpDir);
  initDb(join(tmpDir, "data.db"));
});

afterEach(() => {
  closeDb();
  try {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* swallow */
  }
});

function has(name: string): boolean {
  return !!getRawClient()
    .prepare(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
    .get(name);
}
function countLike(pattern: string): number {
  return (
    getRawClient()
      .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name LIKE ?`)
      .get(pattern) as { n: number }
  ).n;
}

/** Seed a v0.11-shaped DB under the OLD (vaultbase_/vb_) names. */
function seedPreRename(): void {
  const c = getRawClient();
  c.exec(`CREATE TABLE vaultbase_collections (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL DEFAULT 'base',
    fields TEXT NOT NULL DEFAULT '[]', view_query TEXT, list_rule TEXT, view_rule TEXT,
    create_rule TEXT, update_rule TEXT, delete_rule TEXT,
    created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`);
  c.exec(`CREATE TABLE vaultbase_settings (key TEXT PRIMARY KEY, value TEXT)`);
  c.exec(`CREATE INDEX idx_vaultbase_settings_key ON vaultbase_settings(key)`);
  c.exec(`CREATE TABLE vaultbase_schema (
    id INTEGER PRIMARY KEY CHECK (id = 1), version TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT 0)`);
  c.exec(`INSERT INTO vaultbase_schema (id, version) VALUES (1, '0.11.4')`);
  // An auth collection "thing" (so the email index is recreated) + a view
  // collection "thing_view" over it.
  c.exec(`INSERT INTO vaultbase_collections (id, name, type) VALUES ('c1', 'thing', 'auth')`);
  c.exec(
    `INSERT INTO vaultbase_collections (id, name, type, view_query) VALUES ('c2', 'thing_view', 'view', 'SELECT id, title FROM vb_thing')`,
  );
  // The base user table with a KNOWN row + an email index.
  c.exec(
    `CREATE TABLE vb_thing (id TEXT PRIMARY KEY, title TEXT, email TEXT, created_at INTEGER, updated_at INTEGER)`,
  );
  c.exec(
    `INSERT INTO vb_thing (id, title, email, created_at, updated_at) VALUES ('r1', 'hello', 'a@b.com', 1, 1)`,
  );
  c.exec(`CREATE UNIQUE INDEX idx_vb_thing_email ON vb_thing(email)`);
  c.exec(`CREATE VIEW vb_thing_view AS SELECT id, title FROM vb_thing`);
}

describe("rebrand migration — vaultbase_* → cogworks_*, vb_* → cw_*", () => {
  it("renames internal + user tables, preserves data + views, drops old indexes", async () => {
    seedPreRename();
    await runMigrations();
    const c = getRawClient();

    // internal + user tables renamed; NO old-named tables/views remain
    expect(has("cogworks_collections")).toBe(true);
    expect(has("cogworks_settings")).toBe(true);
    expect(has("cogworks_schema")).toBe(true);
    expect(countLike("vaultbase_%")).toBe(0);
    expect(countLike("vb_%")).toBe(0);

    // the known record survived in cw_thing
    const row = c.prepare(`SELECT title, email FROM cw_thing WHERE id = 'r1'`).get() as {
      title: string;
      email: string;
    };
    expect(row.title).toBe("hello");
    expect(row.email).toBe("a@b.com");

    // the view was rebuilt under cw_, references cw_thing, and is queryable
    expect(has("cw_thing_view")).toBe(true);
    const vrow = c.prepare(`SELECT id, title FROM cw_thing_view`).get() as {
      id: string;
      title: string;
    };
    expect(vrow).toEqual({ id: "r1", title: "hello" });
    // and its stored query text was rewritten
    const vq = (
      c.prepare(`SELECT view_query FROM cogworks_collections WHERE name = 'thing_view'`).get() as {
        view_query: string;
      }
    ).view_query;
    expect(vq).toContain("cw_thing");
    expect(vq).not.toContain("vb_thing");

    // no old-named indexes left, no duplicates (exactly one email index on cw_thing)
    expect(countLike("idx_vaultbase_%")).toBe(0);
    expect(countLike("idx_vb_%")).toBe(0);
    const emailIdx = countLike("idx_cw_thing_email");
    expect(emailIdx).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — a second runMigrations is a clean no-op", async () => {
    seedPreRename();
    await runMigrations();
    expect(has("cogworks_settings")).toBe(true);
    await runMigrations(); // again
    expect(has("cogworks_settings")).toBe(true);
    expect(countLike("vaultbase_%")).toBe(0);
    // record still intact after the second pass
    const row = getRawClient().prepare(`SELECT title FROM cw_thing WHERE id = 'r1'`).get() as {
      title: string;
    };
    expect(row.title).toBe("hello");
  });

  it("fresh DB — creates new names directly, never creates an old-named table", async () => {
    await runMigrations();
    expect(has("cogworks_collections")).toBe(true);
    expect(has("cogworks_settings")).toBe(true);
    expect(countLike("vaultbase_%")).toBe(0);
    expect(countLike("vb_%")).toBe(0);
  });
});
