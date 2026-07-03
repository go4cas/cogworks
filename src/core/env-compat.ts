/**
 * Back-compat for the Vaultbase → Cogworks rebrand: honour legacy `VAULTBASE_*`
 * environment variables by aliasing any that don't already have a `COGWORKS_*`
 * equivalent. Runs as an import side-effect so it executes BEFORE any module
 * reads `process.env` at load time — import it first in each entrypoint
 * (`index.ts`, `cluster.ts`). Remove in a future major once operators have
 * migrated their env files/systemd units to `COGWORKS_*`.
 */
for (const key of Object.keys(process.env)) {
  if (!key.startsWith("VAULTBASE_")) continue;
  const renamed = `COGWORKS_${key.slice("VAULTBASE_".length)}`;
  if (process.env[renamed] === undefined) process.env[renamed] = process.env[key];
}
