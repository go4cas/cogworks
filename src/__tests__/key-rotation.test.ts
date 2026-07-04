/**
 * F-13 encryption key rotation. Decryption falls back to
 * `COGWORKS_ENCRYPTION_KEY_OLD` during a rotation (multi-key trial-decrypt), and
 * `rotateEncryptionKey()` re-encrypts every stored value (collection fields +
 * settings) under the new primary key so the old key can be retired.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setLogsDir } from "../core/file-logger.ts";
import { createCollection } from "../core/collections.ts";
import { createRecord, getRecord } from "../core/records.ts";
import { setSetting, getSetting } from "../api/settings.ts";
import {
  encryptValue,
  decryptValue,
  encryptValueSync,
  decryptValueSync,
} from "../core/encryption.ts";
import { rotateEncryptionKey } from "../core/key-rotation.ts";

const KEY_A = "A".repeat(32); // 32-byte UTF-8 keys
const KEY_B = "B".repeat(32);
const KEY_C = "C".repeat(32);

let savedKey: string | undefined;
let savedOld: string | undefined;

beforeEach(() => {
  savedKey = process.env.COGWORKS_ENCRYPTION_KEY;
  savedOld = process.env.COGWORKS_ENCRYPTION_KEY_OLD;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.COGWORKS_ENCRYPTION_KEY;
  else process.env.COGWORKS_ENCRYPTION_KEY = savedKey;
  if (savedOld === undefined) delete process.env.COGWORKS_ENCRYPTION_KEY_OLD;
  else process.env.COGWORKS_ENCRYPTION_KEY_OLD = savedOld;
});

describe("multi-key decrypt", () => {
  it("decrypts old-key values via COGWORKS_ENCRYPTION_KEY_OLD (sync + async)", async () => {
    process.env.COGWORKS_ENCRYPTION_KEY = KEY_A;
    delete process.env.COGWORKS_ENCRYPTION_KEY_OLD;
    const encSync = encryptValueSync("secret-1");
    const encAsync = await encryptValue("secret-2");

    // Rotate primary → B, keep A as the old key.
    process.env.COGWORKS_ENCRYPTION_KEY = KEY_B;
    process.env.COGWORKS_ENCRYPTION_KEY_OLD = KEY_A;
    expect(decryptValueSync(encSync)).toBe("secret-1");
    expect(await decryptValue(encAsync)).toBe("secret-2");
  });

  it("fails when the value matches neither the primary nor any old key", async () => {
    process.env.COGWORKS_ENCRYPTION_KEY = KEY_A;
    delete process.env.COGWORKS_ENCRYPTION_KEY_OLD;
    const enc = encryptValueSync("secret");
    process.env.COGWORKS_ENCRYPTION_KEY = KEY_B; // no old key configured
    expect(() => decryptValueSync(enc)).toThrow(/Decryption failed/);
  });
});

describe("rotateEncryptionKey", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cogworks-rotate-"));
    setLogsDir(tmpDir);
    initDb(":memory:");
    await runMigrations();
    process.env.COGWORKS_ENCRYPTION_KEY = KEY_A;
    delete process.env.COGWORKS_ENCRYPTION_KEY_OLD;
  });
  afterEach(() => {
    closeDb();
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      /* swallow */
    }
  });

  it("re-encrypts fields + settings so the old key can be retired", async () => {
    await createCollection({
      name: "secrets",
      fields: JSON.stringify([{ name: "token", type: "text", options: { encrypted: true } }]),
    });
    const rec = await createRecord("secrets", { token: "shhh" });
    setSetting("smtp.password", "hunter2"); // `.password` suffix → encrypted at rest

    // Rotate primary → B (A available as fallback for the decrypt half of rotation).
    process.env.COGWORKS_ENCRYPTION_KEY = KEY_B;
    process.env.COGWORKS_ENCRYPTION_KEY_OLD = KEY_A;
    const res = await rotateEncryptionKey();
    expect(res.fields).toBe(1);
    expect(res.settings).toBeGreaterThanOrEqual(1);

    // Drop the old key entirely — everything must still decrypt under B alone.
    delete process.env.COGWORKS_ENCRYPTION_KEY_OLD;
    const got = await getRecord("secrets", rec.id);
    expect(got?.token).toBe("shhh");
    expect(getSetting("smtp.password", "")).toBe("hunter2");
  });

  it("is safe to re-run and rotates again to a third key", async () => {
    await createCollection({
      name: "secrets",
      fields: JSON.stringify([{ name: "token", type: "text", options: { encrypted: true } }]),
    });
    const rec = await createRecord("secrets", { token: "value" });

    process.env.COGWORKS_ENCRYPTION_KEY = KEY_B;
    process.env.COGWORKS_ENCRYPTION_KEY_OLD = KEY_A;
    await rotateEncryptionKey();
    // Idempotent second pass under the same key set — no error, still decrypts.
    await rotateEncryptionKey();

    // Rotate again B → C.
    process.env.COGWORKS_ENCRYPTION_KEY = KEY_C;
    process.env.COGWORKS_ENCRYPTION_KEY_OLD = KEY_B;
    await rotateEncryptionKey();
    delete process.env.COGWORKS_ENCRYPTION_KEY_OLD;
    expect((await getRecord("secrets", rec.id))?.token).toBe("value");
  });
});
