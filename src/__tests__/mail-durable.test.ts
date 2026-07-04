/**
 * E-8 durable email + F-14 provider drivers.
 *   - enqueueEmail persists the send as a `_mail` queue job (survives crashes).
 *   - mail.transport selects SMTP vs the HTTP (Resend) driver; isMailConfigured
 *     reflects the active transport.
 *   - the HTTP driver POSTs the right shape and surfaces provider errors.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, closeDb, getDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { setLogsDir } from "../core/file-logger.ts";
import { jobsLog } from "../db/schema.ts";
import { setSetting } from "../api/settings.ts";
import { isMailConfigured, sendMailRich, invalidateEmailCache } from "../core/email.ts";
import { enqueueEmail, MAIL_QUEUE } from "../core/mail-queue.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cogworks-mail-"));
  setLogsDir(tmpDir);
  initDb(":memory:");
  await runMigrations();
  invalidateEmailCache();
});
afterEach(() => {
  closeDb();
  try {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* swallow */
  }
});

describe("enqueueEmail (E-8 durability)", () => {
  it("persists the send as a _mail queue job", async () => {
    const { jobId } = await enqueueEmail({ to: "a@x.com", subject: "Hi", text: "body" });
    const rows = await getDb().select().from(jobsLog).where(eq(jobsLog.id, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.queue).toBe(MAIL_QUEUE);
    expect(rows[0]!.status).toBe("queued");
    const payload = JSON.parse(rows[0]!.payload) as { to: string; subject: string };
    expect(payload.to).toBe("a@x.com");
    expect(payload.subject).toBe("Hi");
  });
});

describe("mail transport selection (F-14)", () => {
  it("isMailConfigured tracks the active transport", () => {
    // Default = smtp, nothing configured.
    expect(isMailConfigured()).toBe(false);

    // HTTP transport needs an api key + a from address.
    setSetting("mail.transport", "http");
    invalidateEmailCache();
    expect(isMailConfigured()).toBe(false);
    setSetting("mail.http.api_key", "re_test");
    setSetting("smtp.from", "no-reply@x.com");
    invalidateEmailCache();
    expect(isMailConfigured()).toBe(true);
  });
});

describe("HTTP (Resend) driver (F-14)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function configureHttp() {
    setSetting("mail.transport", "http");
    setSetting("mail.http.api_key", "re_test");
    setSetting("smtp.from", "no-reply@x.com");
    invalidateEmailCache();
  }

  it("POSTs to Resend with the right shape and returns the message id", async () => {
    configureHttp();
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await sendMailRich({ to: "a@x.com", subject: "Hi", html: "<p>hi</p>" });
    expect(res.messageId).toBe("re_123");
    expect(captured!.url).toBe("https://api.resend.com/emails");
    expect((captured!.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toMatchObject({
      from: "no-reply@x.com",
      to: "a@x.com",
      subject: "Hi",
      html: "<p>hi</p>",
    });
  });

  it("throws on a provider error response", async () => {
    configureHttp();
    globalThis.fetch = (async () =>
      new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    await expect(sendMailRich({ to: "a@x.com", subject: "Hi", text: "x" })).rejects.toThrow(
      /Resend send failed: 401/,
    );
  });
});
