/**
 * E-6 execution-timeout budget for admin-authored code. `runWithTimeout` races a
 * user-code promise against a budget (setting `execution.timeout_ms`); a hung
 * `await` in a hook rejects instead of blocking the request forever. (Only
 * async-yielding hangs are interruptible — a sync busy-loop can't be, by design.)
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb, getDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setLogsDir } from "../core/file-logger.ts";
import { hooks as hooksTable } from "../db/schema.ts";
import { invalidateHookCache } from "../core/hooks.ts";
import { createCollection } from "../core/collections.ts";
import { createRecord } from "../core/records.ts";
import { setSetting } from "../api/settings.ts";
import { runWithTimeout, userCodeTimeoutMs } from "../core/user-code.ts";
import { ValidationError } from "../core/validate.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cogworks-timeout-"));
  setLogsDir(tmpDir);
  initDb(":memory:");
  await runMigrations();
});
afterEach(() => {
  invalidateHookCache();
  closeDb();
  try {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* swallow */
  }
});

async function installHook(collection: string, event: string, code: string) {
  const now = Math.floor(Date.now() / 1000);
  await getDb()
    .insert(hooksTable)
    .values({
      id: crypto.randomUUID(),
      name: `${collection}-${event}`,
      collection_name: collection,
      event,
      code,
      enabled: 1,
      created_at: now,
      updated_at: now,
    });
  invalidateHookCache();
}

describe("runWithTimeout", () => {
  it("resolves a fast promise with its value", async () => {
    await expect(runWithTimeout(() => Promise.resolve(42), 1000, "t")).resolves.toBe(42);
  });

  it("rejects when the promise overruns the budget", async () => {
    // Never-resolving but event-loop-yielding → the timer fires.
    await expect(runWithTimeout(() => new Promise(() => {}), 30, "task")).rejects.toThrow(
      /task exceeded 30ms timeout/,
    );
  });

  it("propagates the underlying rejection unchanged", async () => {
    await expect(
      runWithTimeout(() => Promise.reject(new Error("boom")), 1000, "t"),
    ).rejects.toThrow("boom");
  });

  it("disables the timeout when ms <= 0", async () => {
    await expect(runWithTimeout(() => Promise.resolve("ok"), 0, "t")).resolves.toBe("ok");
  });

  it("reads the budget from the execution.timeout_ms setting", () => {
    expect(userCodeTimeoutMs()).toBe(5000); // default
    setSetting("execution.timeout_ms", "250");
    expect(userCodeTimeoutMs()).toBe(250);
    setSetting("execution.timeout_ms", "garbage");
    expect(userCodeTimeoutMs()).toBe(5000); // invalid → default
  });
});

describe("hook execution budget", () => {
  it("aborts a hung before-hook and surfaces a timeout validation error", async () => {
    await createCollection({
      name: "items",
      fields: JSON.stringify([{ name: "n", type: "number" }]),
    });
    setSetting("execution.timeout_ms", "50");
    // Hook yields to the loop and never returns → must be timed out.
    await installHook("items", "beforeCreate", "await new Promise(() => {});");

    let err: unknown;
    try {
      await createRecord("items", { n: 1 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details._hook).toMatch(/timeout/);
  });

  it("lets a fast hook complete within budget", async () => {
    await createCollection({
      name: "items",
      fields: JSON.stringify([{ name: "n", type: "number" }]),
    });
    setSetting("execution.timeout_ms", "1000");
    await installHook("items", "beforeCreate", "await Promise.resolve();");
    const rec = await createRecord("items", { n: 7 });
    expect(rec.n).toBe(7);
  });
});
