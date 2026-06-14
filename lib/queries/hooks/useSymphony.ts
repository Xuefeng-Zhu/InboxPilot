import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys, type ConversationListItem, type ConversationListRow, type MessageListRow } from '../keys';
import {
  attachLatestMessages,
  fetchLatestMessagesForConversations,
  useAuthReady,
} from '../helpers';

// ---------------------------------------------------------------------------
// Zoom windows
//
// A Symphony zoom is one of:
//   - 'today'  → 00:00 → 23:59:59 of the current local day
//   - 'week'   → 00:00 of 6 days ago → end of today (7-day window)
//   - 'month'  → 00:00 of 29 days ago → end of today (30-day window)
//   - 'all'    → windowStart = epoch 0; windowEnd = +1 day (catch the future)
//
// `step` is a signed integer used by the prev/next nav arrows. -1 = previous
// window, 0 = current, +1 = next. Multi-window stepping (e.g. last month) is
// handled by simply letting `step` shift the anchor day.
// ---------------------------------------------------------------------------

export type Zoom = 'today' | 'week' | 'month' | 'all';

export interface SymphonyWindow {
  zoom: Zoom;
  step: number;
  windowStart: Date;
  windowEnd: Date;
  /** Human-readable label, e.g. "Jun 7 — Jun 13". */
  label: string;
  /** Number of conversations seen in this window. */
  conversationCount: number;
  /** Whether the current wall-clock instant falls inside the window. */
  isCurrent: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfLocalDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(23, 59, 59, 999);
  return out;
}

function formatDayMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatHourLabel(date: Date): string {
  const dayMonth = formatDayMonth(date);
  const hour = date.getHours();
  const suffix = hour < 12 ? 'am' : 'pm';
  const hour12 = ((hour + 11) % 12) + 1;
  return `${dayMonth} · ${hour12}${suffix}`;
}

function getAnchor(zoom: Zoom, step: number): Date {
  const now = new Date();
  if (zoom === 'today') {
    const anchor = new Date(now);
    anchor.setDate(anchor.getDate() + step);
    return anchor;
  }
  if (zoom === 'week') {
    // Anchor shifts by 7 days per step
    const anchor = new Date(now);
    anchor.setDate(anchor.getDate() + step * 7);
    return anchor;
  }
  if (zoom === 'month') {
    const anchor = new Date(now);
    anchor.setDate(anchor.getDate() + step * 30);
    return anchor;
  }
  // 'all' ignores step (only one window)
  return now;
}

export function computeSymphonyWindow(zoom: Zoom, step: number = 0): Omit<SymphonyWindow, 'conversationCount'> {
  const anchor = getAnchor(zoom, step);

  if (zoom === 'all') {
    return {
      zoom,
      step,
      windowStart: new Date(0),
      windowEnd: new Date(Date.now() + DAY_MS),
      label: 'All conversations',
      isCurrent: step === 0,
    };
  }

  let windowStart: Date;
  let windowEnd: Date;
  if (zoom === 'today') {
    windowStart = startOfLocalDay(anchor);
    windowEnd = endOfLocalDay(anchor);
  } else if (zoom === 'week') {
    windowEnd = endOfLocalDay(anchor);
    windowStart = startOfLocalDay(anchor);
    windowStart.setDate(windowStart.getDate() - 6);
  } else {
    // 'month' (30 days)
    windowEnd = endOfLocalDay(anchor);
    windowStart = startOfLocalDay(anchor);
    windowStart.setDate(windowStart.getDate() - 29);
  }

  const label =
    zoom === 'today'
      ? formatDayMonth(windowStart)
      : `${formatDayMonth(windowStart)} — ${formatDayMonth(windowEnd)}`;

  const now = new Date();
  const isCurrent = step === 0 && now >= windowStart && now <= windowEnd;

  return { zoom, step, windowStart, windowEnd, label, isCurrent };
}

/** Axis tick labels for the time axis (mono, uppercase, 6am/12pm/6pm/12am). */
export function getAxisTicks(zoom: Zoom, step: number): { label: string; date: Date }[] {
  const { windowStart, windowEnd } = computeSymphonyWindow(zoom, step);

  if (zoom === 'today') {
    return [0, 6, 12, 18].map((h) => {
      const d = new Date(windowStart);
      d.setHours(h, 0, 0, 0);
      const suffix = h < 12 ? 'am' : 'pm';
      const h12 = ((h + 11) % 12) + 1;
      return { label: `${h12}${suffix}`, date: d };
    });
  }
  if (zoom === 'all') {
    // 5 evenly spaced markers across the full window
    const ticks: { label: string; date: Date }[] = [];
    const range = windowEnd.getTime() - windowStart.getTime();
    for (let i = 0; i < 5; i++) {
      const d = new Date(windowStart.getTime() + (range * i) / 4);
      ticks.push({ label: formatDayMonth(d), date: d });
    }
    return ticks;
  }
  // 'week' or 'month' — show 7 evenly-spaced dates
  const ticks: { label: string; date: Date }[] = [];
  const stepCount = zoom === 'week' ? 6 : 6;
  const range = windowEnd.getTime() - windowStart.getTime();
  for (let i = 0; i <= stepCount; i++) {
    const d = new Date(windowStart.getTime() + (range * i) / stepCount);
    ticks.push({ label: formatDayMonth(d), date: d });
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// useSymphonyConversations
//
// Returns conversations in the selected window, ordered ASCENDING by
// `last_message_at` (oldest → newest) so the river flows left-to-right.
// Uses the same latest-message attachment helper as the inbox queries.
// ---------------------------------------------------------------------------

export function useSymphonyConversations(
  orgId: string | undefined,
  zoom: Zoom,
  step: number,
) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.symphonyConversations(orgId ?? '', `${zoom}:${step}`),
    queryFn: async () => {
      if (!orgId) return [] as ConversationListItem[];
      const { windowStart, windowEnd } = computeSymphonyWindow(zoom, step);

      let query = insforge.database
        .from('conversations')
        .select('*, contacts(*)')
        .eq('organization_id', orgId)
        .order('last_message_at', { ascending: true });

      if (zoom !== 'all') {
        query = query
          .gte('last_message_at', windowStart.toISOString())
          .lte('last_message_at', windowEnd.toISOString());
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const conversations = Array.isArray(data) ? data : data ? [data] : [];
      const ids = conversations
        .map((c) => (c as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string');

      if (ids.length === 0) {
        return [] as ConversationListItem[];
      }

      const messages = await fetchLatestMessagesForConversations(ids);
      return attachLatestMessages(
        conversations as ConversationListRow[],
        messages as MessageListRow[],
      );
    },
    enabled: authReady && !!orgId,
  });
}

// ---------------------------------------------------------------------------
// useSymphonyCounts
//
// Stream / drafting / escalated counts for the topbar stats. Stream = total
// non-resolved conversations in window; drafting = ai_state='drafted';
// escalated = status='escalated'. Mirrors design-mock-3.html sidebar logic.
// ---------------------------------------------------------------------------

export function useSymphonyCounts(
  orgId: string | undefined,
  zoom: Zoom,
  step: number,
) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.symphonyCounts(orgId ?? '', `${zoom}:${step}`),
    queryFn: async () => {
      if (!orgId) return { stream: 0, drafting: 0, escalated: 0 };
      const { windowStart, windowEnd } = computeSymphonyWindow(zoom, step);
      const range = zoom === 'all'
        ? null
        : { start: windowStart.toISOString(), end: windowEnd.toISOString() };

      const buildBase = () => {
        let q = insforge.database
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId);
        if (range) {
          q = q.gte('last_message_at', range.start).lte('last_message_at', range.end);
        }
        return q;
      };

      const { count: stream } = await buildBase().neq('status', 'resolved');
      const { count: drafting } = await buildBase().eq('ai_state', 'drafted');
      const { count: escalated } = await buildBase().eq('status', 'escalated');

      return {
        stream: stream ?? 0,
        drafting: drafting ?? 0,
        escalated: escalated ?? 0,
      };
    },
    enabled: authReady && !!orgId,
  });
}

// ---------------------------------------------------------------------------
// Helpers used by the river (UI-side formatters)
// ---------------------------------------------------------------------------

export function relativeTimeLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = t - now.getTime();
  const absMin = Math.abs(diff) / 60_000;
  if (absMin < 1) return 'now';
  if (diff > 0 && absMin < 60) return `+${Math.round(absMin)}m`;
  if (diff > 0 && absMin < 60 * 24) return `+${Math.round(absMin / 60)}h`;
  if (diff > 0) return `+${Math.round(absMin / (60 * 24))}d`;
  if (absMin < 60) return `${Math.round(absMin)}m`;
  if (absMin < 60 * 24) return `${Math.round(absMin / 60)}h`;
  if (absMin < 60 * 24 * 7) return `${Math.round(absMin / (60 * 24))}d`;
  return formatHourLabel(new Date(t));
}

export function conversationInitial(contactName: string | null | undefined, fallback: string = '?'): string {
  const trimmed = (contactName ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.charAt(0).toUpperCase();
}

export function truncate(text: string | null | undefined, max: number = 200): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

/** Map (ai_state, status) → pill text and tone. Mirrors plan's mapping table. */
export interface PillDescriptor {
  text: string;
  tone: 'sent' | 'drafting' | 'thinking' | 'escalated' | 'failed' | 'resolved' | 'idle';
}

export function pillForAiState(
  aiState: string | null | undefined,
  status: string | null | undefined,
): PillDescriptor {
  const ai = aiState ?? 'idle';
  const st = status ?? 'open';
  if (ai === 'thinking') return { text: 'thinking', tone: 'thinking' };
  if (ai === 'drafted') return { text: 'drafting', tone: 'drafting' };
  if (ai === 'auto_replied') return { text: 'sent · auto', tone: 'sent' };
  if (ai === 'failed') return { text: 'failed', tone: 'failed' };
  if (ai === 'needs_human' || st === 'escalated') return { text: 'escalated', tone: 'escalated' };
  if (st === 'resolved') return { text: 'resolved', tone: 'resolved' };
  return { text: 'sent', tone: 'sent' };
}

/** Map (ai_state, status) → mini-map bar tone. */
export type BarTone = 'sent' | 'drafting' | 'escalated' | 'idle';

export function barToneForAiState(
  aiState: string | null | undefined,
  status: string | null | undefined,
): BarTone {
  const ai = aiState ?? 'idle';
  const st = status ?? 'open';
  if (ai === 'drafted') return 'drafting';
  if (ai === 'needs_human' || st === 'escalated') return 'escalated';
  if (ai === 'auto_replied' || ai === 'idle') return 'sent';
  if (ai === 'thinking' || ai === 'failed') return 'idle';
  return 'sent';
}

/** Position (0..100) of a timestamp inside a window, clamped. */
export function positionPct(iso: string | null | undefined, start: Date, end: Date): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const range = end.getTime() - start.getTime();
  if (range <= 0) return 0;
  const pct = ((t - start.getTime()) / range) * 100;
  return Math.max(0.5, Math.min(99.5, pct));
}
