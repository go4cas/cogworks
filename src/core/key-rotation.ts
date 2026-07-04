/**
 * Encryption key rotation (F-13).
 *
 * Re-encrypts every stored encrypted value — collection `encrypted` fields and
 * encrypted settings — under the current primary `COGWORKS_ENCRYPTION_KEY`.
 * Decryption falls back to `COGWORKS_ENCRYPTION_KEY_OLD` (see `encryption.ts`),
 * so the flow is:
 *
 *   1. Generate a new key. Set `COGWORKS_ENCRYPTION_KEY=<new>` and
 *      `COGWORKS_ENCRYPTION_KEY_OLD=<previous>`.
 *   2. Run `cogworks rotate-key`.
 *   3. Once backups + record history written under the old key are no longer
 *      needed, drop `COGWORKS_ENCRYPTION_KEY_OLD`.
 *
 * The whole re-encrypt runs in one SQLite transaction. If it's interrupted it's
 * safe to re-run: values already moved to the new key still decrypt (primary
 * key), and any left on the old key decrypt via `_OLD`.
 *
 * Not rotated here: record-history snapshots (append-only audit). They keep
 * decrypting via `_OLD` — retain the old key as long as you need that history.
 */
import { listCollections, parseFields, userTableName } from "./collections.ts";
import { getRawClient } from "../db/client.ts";
import { isEncrypted, encryptValueSync, decryptValueSync, ENCRYPTED_PREFIX } from "./encryption.ts";

export interface RotationResult {
  /** Collection-field values re-encrypted. */
  fields: number;
  /** Settings re-encrypted. */
  settings: number;
}

/** SQLite identifier quoting (escape embedded double-quotes). */
function q(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** Re-encrypt all encrypted values under the primary key. Returns the counts. */
export async function rotateEncryptionKey(): Promise<RotationResult> {
  const collections = await listCollections();
  const db = getRawClient();
  const like = `${ENCRYPTED_PREFIX}%`;
  let fields = 0;
  let settings = 0;

  const tx = db.transaction(() => {
    for (const col of collections) {
      if (col.type === "view") continue;
      const encFields = parseFields(col.fields).filter((f) => f.options?.encrypted);
      if (encFields.length === 0) continue;
      const table = userTableName(col.name);
      for (const f of encFields) {
        const rows = db
          .prepare(`SELECT id, ${q(f.name)} AS v FROM ${q(table)} WHERE ${q(f.name)} LIKE ?`)
          .all(like) as Array<{ id: string; v: string | null }>;
        const upd = db.prepare(`UPDATE ${q(table)} SET ${q(f.name)} = ? WHERE id = ?`);
        for (const r of rows) {
          if (typeof r.v !== "string" || !isEncrypted(r.v)) continue;
          upd.run(encryptValueSync(decryptValueSync(r.v)), r.id);
          fields++;
        }
      }
    }

    const srows = db
      .prepare(`SELECT key, value FROM cogworks_settings WHERE value LIKE ?`)
      .all(like) as Array<{ key: string; value: string }>;
    const supd = db.prepare(`UPDATE cogworks_settings SET value = ? WHERE key = ?`);
    for (const s of srows) {
      if (!isEncrypted(s.value)) continue;
      supd.run(encryptValueSync(decryptValueSync(s.value)), s.key);
      settings++;
    }
  });
  tx();

  return { fields, settings };
}
