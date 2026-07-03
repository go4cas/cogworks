/**
 * Execution-timeout budget for admin-authored code — hooks, custom routes, cron
 * jobs, queue workers. All four compile to an in-process `AsyncFunction(ctx)`;
 * without a budget a hung `await` (a slow/stuck external call) blocks the
 * request or an event-loop tick indefinitely.
 */
import { getSetting } from "../api/settings.ts";

/** Timeout budget (ms) for one user-code invocation. 0 disables. Setting: `execution.timeout_ms`. */
export function userCodeTimeoutMs(): number {
  const n = parseInt(getSetting("execution.timeout_ms", "5000"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 5000;
}

/**
 * Race a user-code promise against a timeout budget, rejecting with a clear
 * error when it overruns.
 *
 * IMPORTANT — this only interrupts code that YIELDS to the event loop (a hung
 * `await`: a slow fetch, a stuck promise). A *synchronous* busy-loop
 * (`while (true) {}`) blocks the loop so the timer never fires; terminating that
 * needs a Worker with `terminate()`, a much larger change. This is the
 * `Promise.race` budget the roadmap calls for — async-hang protection, which
 * covers the common failure (a hook awaiting an unresponsive service).
 */
export function runWithTimeout<T>(run: () => Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return run();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} exceeded ${ms}ms timeout`));
    }, ms);
    timer.unref?.();
    run().then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
