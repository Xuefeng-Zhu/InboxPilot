/**
 * Shared helper: trigger process-jobs immediately after enqueueing a job.
 *
 * Why: Inbound functions (sms-inbound, email-inbound, webchat-inbound) enqueue
 * a `process_ai_message` job and want it to start running NOW, not on the next
 * cron tick (up to 60s away). The previous implementation used a fire-and-
 * forget `fetch().catch(() => {})`, which is unreliable on serverless runtimes:
 * the function returns its response to the webhook provider, the runtime tears
 * down the worker, and the dangling fetch never goes out.
 *
 * This helper awaits the trigger with a bounded timeout. In the happy path the
 * process-jobs function claims the job and starts AI work in <2s. If something
 * goes wrong (cold start spike, transient 5xx, network blip) the timeout caps
 * the inbound webhook delay at TRIGGER_TIMEOUT_MS so we stay well under Twilio
 * and Postmark's webhook timeouts (~15s typical, 30s hard limit).
 *
 * The cron schedule on process-jobs remains as a safety net for any job whose
 * trigger fails.
 */

const TRIGGER_TIMEOUT_MS = 5_000;

export interface TriggerContext {
  baseUrl: string;
  serviceRoleKey: string;
}

/**
 * Derive the process-jobs function URL from the project base URL.
 *
 * e.g. "https://y39ezar3.us-east.insforge.app"
 *   → "https://y39ezar3.functions.insforge.app"
 *
 * The simpler `.insforge.app` suffix match replaces the regex pattern that
 * required a hyphen in the region (e.g. "us-east"). Any future region naming
 * (or single-word region like "us") continues to work.
 */
export function getProcessJobsUrl(baseUrl: string): string {
  return baseUrl.replace(/\.insforge\.app$/, '.functions.insforge.app');
}

/**
 * Trigger process-jobs to drain the queue immediately.
 *
 * Resolves (without throwing) on:
 * - Successful 2xx response from process-jobs
 * - Timeout (after TRIGGER_TIMEOUT_MS) — the cron will pick up the job
 * - Network/5xx failure — the cron will pick up the job
 *
 * Logs structured errors via console.error so failures are visible in
 * function.logs (whereas the previous .catch(() => {}) silently swallowed).
 */
export async function triggerProcessJobs(ctx: TriggerContext): Promise<void> {
  const url = `${getProcessJobsUrl(ctx.baseUrl)}/process-jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ctx.serviceRoleKey,
        Authorization: `Bearer ${ctx.serviceRoleKey}`,
      },
      body: '{}',
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        `triggerProcessJobs: process-jobs returned HTTP ${res.status} — ` +
          `cron will retry. URL: ${url}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `triggerProcessJobs: failed (${message}) — cron will retry. URL: ${url}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
