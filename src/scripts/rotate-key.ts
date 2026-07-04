/**
 * `cogworks rotate-key` — re-encrypt every stored encrypted value under the
 * current `COGWORKS_ENCRYPTION_KEY` (F-13). Runs offline against the DB file,
 * no server boot. Set the new key as `COGWORKS_ENCRYPTION_KEY` and the previous
 * one as `COGWORKS_ENCRYPTION_KEY_OLD` before running.
 */
import { initDb, closeDb } from "../db/client.ts";
import { isEncryptionAvailable } from "../core/encryption.ts";
import { rotateEncryptionKey } from "../core/key-rotation.ts";

export async function runRotateKeyCli(_argv: string[], dbPath: string): Promise<void> {
  if (!isEncryptionAvailable()) {
    throw new Error("COGWORKS_ENCRYPTION_KEY is not set — nothing to rotate");
  }
  initDb(`file:${dbPath}`);
  try {
    process.stdout.write("Re-encrypting all encrypted values under COGWORKS_ENCRYPTION_KEY…\n");
    const { fields, settings } = await rotateEncryptionKey();
    process.stdout.write(
      `Done: re-encrypted ${fields} field value(s) and ${settings} setting(s).\n`,
    );
    if (process.env.COGWORKS_ENCRYPTION_KEY_OLD) {
      process.stdout.write(
        "Keep COGWORKS_ENCRYPTION_KEY_OLD set until backups + record history under the old key are no longer needed, then remove it.\n",
      );
    }
  } finally {
    closeDb();
  }
}
