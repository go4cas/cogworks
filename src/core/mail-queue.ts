/**
 * Durable transactional email (E-8).
 *
 * System emails (verification, password reset, OTP) were fire-and-forget: an
 * SMTP blip or a crash between "user created" and "mail sent" dropped the mail
 * silently. `enqueueEmail` instead persists the send as a job on the built-in
 * `_mail` queue, so it inherits the queue's retry + backoff + dead-letter (and
 * the P1-1 reaper), giving at-least-once delivery.
 *
 * Kept in its own module (not in `email.ts`) to avoid an import cycle:
 * `email.ts` ← `hooks.ts` ← `queues.ts`, so `email.ts` must not import queues.
 */
import { enqueue, registerBuiltinWorker, type JobContext } from "./queues.ts";
import { sendMailRich, type RichEmailOptions } from "./email.ts";
import { log } from "./log.ts";

export const MAIL_QUEUE = "_mail";

/** Enqueue an email for durable, at-least-once delivery via the `_mail` queue. */
export async function enqueueEmail(
  opts: RichEmailOptions & { uniqueKey?: string },
): Promise<{ jobId: string }> {
  const { uniqueKey, ...payload } = opts;
  const { jobId } = await enqueue(MAIL_QUEUE, payload, uniqueKey ? { uniqueKey } : {});
  return { jobId };
}

async function mailWorker(ctx: JobContext): Promise<void> {
  const p = ctx.payload as RichEmailOptions;
  if (!p || typeof p.to !== "string" || !p.to) {
    throw new Error("mail job payload missing `to`");
  }
  await sendMailRich(p); // throws → job retries per the queue's backoff, then dead-letters
  log.info("mail sent", { scope: "mail", to: p.to, subject: p.subject });
}

let registered = false;
/** Register the built-in `_mail` worker. Call once at boot before the scheduler. */
export function registerMailWorker(): void {
  if (registered) return;
  registerBuiltinWorker({
    queue: MAIL_QUEUE,
    name: "mail",
    concurrency: 2,
    retry_max: 5,
    retry_backoff: "exponential",
    retry_delay_ms: 3000,
    fn: mailWorker,
  });
  registered = true;
}
