/**
 * Format the response time between a decision being created and the most
 * recent inbound message as a short, human-readable duration string.
 *
 * Units emitted by the function:
 * - `ms` — milliseconds, for diffs strictly less than 1 second
 * - `s`  — seconds with one decimal, for diffs from 1 second up to 1 minute
 * - `m`  — minutes with one decimal, for diffs from 1 minute up to 1 hour
 * - `h`  — hours with one decimal, for diffs of 1 hour or more
 *
 * A leading em-dash (`—`) is returned when there is no `lastMessageAt` to
 * compare against, or when the decision timestamp precedes the message
 * timestamp (negative diff).
 *
 * Re-added verbatim from `cb6730a:components/inbox/MessageThread.tsx` (the
 * local helper that was silently removed during the M03 redesign in
 * `9cc5668`). Consumed by the AI Insight tab to render the
 * "Response Time" stat.
 */
export function formatResponseTime(
  decisionCreatedAt: string,
  lastMessageAt: string | null,
): string {
  if (!lastMessageAt) return '—';
  const decisionTime = new Date(decisionCreatedAt).getTime();
  const messageTime = new Date(lastMessageAt).getTime();
  const diffMs = decisionTime - messageTime;
  if (diffMs < 0) return '—';
  if (diffMs < 1000) return `${Math.round(diffMs)}ms`;
  const seconds = diffMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}
