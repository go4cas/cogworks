/**
 * E-5 — uploads stream the multipart Blob straight to storage (no second
 * full-file ArrayBuffer copy in the handler). This verifies the write path
 * end-to-end: a POST upload stores the exact bytes and reports the right meta.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as jose from "jose";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb, getDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setLogsDir } from "../core/file-logger.ts";
import { setUploadDir, invalidateStorageCache } from "../core/storage.ts";
import { createCollection, type FieldDef } from "../core/collections.ts";
import { createRecord } from "../core/records.ts";
import { admin } from "../db/schema.ts";
import { makeFilesPlugin } from "../api/files.ts";

const SECRET = "test-secret-file-upload";
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cogworks-file-upload-"));
  setLogsDir(tmpDir);
  setUploadDir(tmpDir);
  invalidateStorageCache(); // drop any driver/config cached by another test file
  initDb(":memory:");
  await runMigrations();
});
afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

async function adminToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  await getDb()
    .insert(admin)
    .values({ id: "a1", email: "a@x.com", password_hash: "x", role: "owner", created_at: now });
  return new jose.SignJWT({ id: "a1", email: "a@x.com", jti: crypto.randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("cogworks")
    .setAudience("admin")
    .setIssuedAt(now)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

describe("streaming upload (E-5)", () => {
  it("stores the exact uploaded bytes and returns file metadata", async () => {
    const fields: FieldDef[] = [{ name: "attachment", type: "file" }];
    const col = await createCollection({
      name: "notes",
      type: "base",
      fields: JSON.stringify(fields),
    });
    void col;
    const rec = await createRecord("notes", {}, null);
    const tok = await adminToken();

    const content = "hello streaming upload — ✔ 中文 bytes";
    const form = new FormData();
    form.append("file", new File([content], "note.bin", { type: "application/octet-stream" }));

    const app = makeFilesPlugin(tmpDir, SECRET);
    const res = await app.request(`http://localhost/files/notes/${rec.id}/attachment`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}` },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { filename: string; mimeType: string; size: number };
    };
    expect(body.data.filename).toMatch(/\.bin$/);
    expect(body.data.mimeType).toBe("application/octet-stream");

    // The bytes on disk match exactly (UTF-8 length, not char length).
    const stored = readFileSync(join(tmpDir, body.data.filename), "utf8");
    expect(stored).toBe(content);
    expect(body.data.size).toBe(Buffer.byteLength(content, "utf8"));
  });
});
