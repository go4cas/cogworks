/**
 * Cross-worker realtime fan-out over a shared SQLite table
 * (`cogworks_realtime_events`). Active ONLY under `cogworks cluster`
 * (COGWORKS_WORKER_ID set) — single-process deployments never read or write
 * the table, so this whole module is a set of no-ops there.
 *
 * Flow: a `broadcast()` on worker A delivers to A's own local subscribers AND
 * calls `publishRecord`/`publishSystem` to append the event here. Every worker
 * (incl. A) runs `startRealtimeTail`, which polls for events from OTHER workers
 * (`origin <> self`) and re-delivers them to that worker's local subscribers.
 * So a record written on any worker reaches subscribers on every worker.
 */
import type { Statement } from "bun:sqlite";
import { getRawClient } from "../db/client.ts";

const WORKER_ID = process.env.COGWORKS_WORKER_ID ?? null;

/** True when running as a cluster worker (multiple processes share the DB). */
export function isClusterWorker(): boolean {
  return WORKER_ID !== null;
}

let insertStmt: Statement | null = null;
function publish(kind: "record" | "system", payload: string): void {
  if (WORKER_ID === null) return;
  try {
    if (!insertStmt) {
      insertStmt = getRawClient().prepare(
        `INSERT INTO cogworks_realtime_events (kind, payload, origin, created_at)
         VALUES (?, ?, ?, unixepoch())`,
      );
    }
    insertStmt.run(kind, payload, WORKER_ID);
  } catch {
    // Best-effort: realtime is not durable. A dropped cross-worker event is no
    // worse than the pre-fix behavior (never delivered cross-worker at all).
    insertStmt = null; // force re-prepare next time (e.g. after a DB reinit)
  }
}

export function publishRecord(collection: string, event: unknown, opts: unknown): void {
  publish("record", JSON.stringify({ collection, event, opts: opts ?? null }));
}

export function publishSystem(topic: string, message: unknown): void {
  publish("system", JSON.stringify({ topic, message }));
}

export interface TailHandlers {
  onRecord(collection: string, event: unknown, opts: unknown): void;
  onSystem(topic: string, message: unknown): void;
}

const POLL_MS = 200;
let tailTimer: ReturnType<typeof setInterval> | null = null;
let lastSeq = 0;

/**
 * Start the tail loop (idempotent, no-op in single-process mode). Polls for
 * events from other workers and hands each to the local delivery handlers.
 */
export function startRealtimeTail(handlers: TailHandlers): void {
  if (WORKER_ID === null || tailTimer) return;
  const db = getRawClient();
  // A respawned worker must not replay history — start after the current max.
  try {
    const row = db
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM cogworks_realtime_events`)
      .get() as { m: number } | undefined;
    lastSeq = row?.m ?? 0;
  } catch {
    lastSeq = 0;
  }
  const sel = db.prepare(
    `SELECT seq, kind, payload FROM cogworks_realtime_events
     WHERE seq > ? AND origin <> ? ORDER BY seq LIMIT 500`,
  );
  tailTimer = setInterval(() => {
    try {
      const rows = sel.all(lastSeq, WORKER_ID) as Array<{
        seq: number;
        kind: string;
        payload: string;
      }>;
      for (const r of rows) {
        lastSeq = r.seq;
        try {
          const data = JSON.parse(r.payload) as Record<string, unknown>;
          if (r.kind === "record") {
            handlers.onRecord(data.collection as string, data.event, data.opts ?? undefined);
          } else if (r.kind === "system") {
            handlers.onSystem(data.topic as string, data.message);
          }
        } catch {
          /* skip a malformed row */
        }
      }
    } catch {
      /* transient DB error — retry next tick */
    }
  }, POLL_MS);
  tailTimer.unref?.();
}

export function stopRealtimeTail(): void {
  if (tailTimer) {
    clearInterval(tailTimer);
    tailTimer = null;
  }
}

/** Delete events older than `retentionSec` (leader-only housekeeping). */
export function pruneRealtimeEvents(retentionSec = 30): number {
  if (WORKER_ID === null) return 0;
  try {
    const res = getRawClient()
      .prepare(`DELETE FROM cogworks_realtime_events WHERE created_at < unixepoch() - ?`)
      .run(retentionSec);
    return (res as unknown as { changes?: number }).changes ?? 0;
  } catch {
    return 0;
  }
}
