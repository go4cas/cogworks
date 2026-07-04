/**
 * Realtime presence (Supabase-style). Verifies the table-backed join/update/leave
 * lifecycle, the snapshot shape, disconnect cleanup, and the stale-row reaper.
 * Delivery is exercised through the real manager: an observer subscribes to the
 * channel's presence topic and must receive each event.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb, getRawClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { subscribe, _reset } from "../realtime/manager.ts";
import {
  trackPresence,
  untrackPresence,
  dropConnPresence,
  presenceState,
  presenceTopic,
  reapStalePresence,
  clearWorkerPresence,
} from "../realtime/presence.ts";

/** Minimal WSLike that records what it was sent. */
function fakeWs(connId: string) {
  const got: Array<Record<string, unknown>> = [];
  return {
    data: { connId },
    send(data: string) {
      got.push(JSON.parse(data) as Record<string, unknown>);
    },
    got,
    /** Presence events this connection received, in order. */
    presence() {
      return got.filter((m) => m.type === "presence");
    },
  };
}

describe("realtime presence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "presence-"));
    initDb(join(tmpDir, "db.sqlite"));
    await runMigrations();
    _reset();
  });

  afterEach(() => {
    closeDb();
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      /* swallow */
    }
  });

  it("join → snapshot → update → leave, delivered to an observer", () => {
    const observer = fakeWs("obs");
    subscribe(observer, [presenceTopic("room")]);

    // join
    const first = trackPresence(
      "connA",
      "room",
      "alice",
      { typing: true },
      { id: "u1", type: "user" },
    );
    expect(first).toBe("join");
    const evs = observer.presence();
    expect(evs.length).toBe(1);
    expect(evs[0]!.event).toBe("join");
    expect((evs[0]!.meta as Record<string, unknown>).key).toBe("alice");

    // snapshot shape: key → [meta]
    const snap = presenceState("room");
    expect(Object.keys(snap)).toEqual(["alice"]);
    expect(snap.alice!.length).toBe(1);
    expect(snap.alice![0]!.state).toEqual({ typing: true });
    expect(snap.alice![0]!.identity).toEqual({ id: "u1", type: "user" });

    // update (same conn, new state)
    const second = trackPresence(
      "connA",
      "room",
      "alice",
      { typing: false },
      { id: "u1", type: "user" },
    );
    expect(second).toBe("update");
    expect(observer.presence().at(-1)!.event).toBe("update");
    expect(presenceState("room").alice![0]!.state).toEqual({ typing: false });

    // leave
    expect(untrackPresence("connA", "room")).toBe(true);
    expect(observer.presence().at(-1)!.event).toBe("leave");
    expect(presenceState("room")).toEqual({});
  });

  it("rejects oversize state and too-long channel", () => {
    const big = "x".repeat(5000);
    expect(trackPresence("c", "room", "k", { blob: big }, null)).toBeNull();
    expect(trackPresence("c", "z".repeat(200), "k", {}, null)).toBeNull();
    expect(presenceState("room")).toEqual({});
  });

  it("dropConnPresence leaves every channel the connection was on", () => {
    const obsA = fakeWs("oa");
    const obsB = fakeWs("ob");
    subscribe(obsA, [presenceTopic("roomA")]);
    subscribe(obsB, [presenceTopic("roomB")]);
    trackPresence("connX", "roomA", "x", {}, null);
    trackPresence("connX", "roomB", "x", {}, null);

    dropConnPresence("connX");

    expect(obsA.presence().at(-1)!.event).toBe("leave");
    expect(obsB.presence().at(-1)!.event).toBe("leave");
    expect(presenceState("roomA")).toEqual({});
    expect(presenceState("roomB")).toEqual({});
  });

  it("reaper culls stale rows and emits leave", () => {
    const observer = fakeWs("obs");
    subscribe(observer, [presenceTopic("room")]);
    trackPresence("dead", "room", "ghost", {}, null);
    // Age the row past the TTL as if its worker crashed.
    getRawClient()
      .prepare(`UPDATE cogworks_presence SET updated_at = unixepoch() - 100 WHERE conn_id = 'dead'`)
      .run();

    const culled = reapStalePresence(60);
    expect(culled).toBe(1);
    expect(observer.presence().at(-1)!.event).toBe("leave");
    expect(presenceState("room")).toEqual({});
  });

  it("clearWorkerPresence wipes this worker's rows (boot cleanup)", () => {
    trackPresence("c1", "room", "k1", {}, null);
    trackPresence("c2", "room", "k2", {}, null);
    clearWorkerPresence();
    expect(presenceState("room")).toEqual({});
  });
});
