'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { Pill } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useOrgMembership, useOrganization } from '@/lib/queries';

interface Conversation {
  id: string;
  status: string;
  ai_state: string;
  created_at: string;
  last_message_at: string | null;
  channel?: string;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_type: string;
  direction: string;
  created_at: string;
}

interface Metrics {
  totalConversations: number;
  openConversations: number;
  resolvedConversations: number;
  escalatedConversations: number;
  averageResponseTimeMs: number | null;
  aiAutoReplyRate: number | null;
  resolutionRate: number | null;
}

interface VolumeBucket {
  label: string;
  from: number;
  to: number;
  count: number;
}

type RangeKey = '7d' | '30d' | 'quarter';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

function formatRate(score: number | null): string {
  if (score === null) return '—';
  return `${(score * 100).toFixed(1)}%`;
}

function rangeToDates(range: RangeKey): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  if (range === '7d') start.setDate(start.getDate() - 7);
  else if (range === '30d') start.setDate(start.getDate() - 30);
  else start.setMonth(start.getMonth() - 3);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

function buildVolume(
  conversations: Conversation[],
  range: RangeKey,
  now: Date,
): VolumeBucket[] {
  const rangeStart = rangeStartMs(range, now);
  const startOfFirstDay = new Date(rangeStart);
  startOfFirstDay.setHours(0, 0, 0, 0);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;

  if (range === '7d' || range === '30d') {
    const numDays = range === '7d' ? 7 : 30;
    // Anchor on today: the last bucket is the partial day [today 00:00, now),
    // earlier buckets are full days. This gives exactly N buckets where N
    // matches the range label, not N+1.
    const startOfFirstBucket = new Date(now);
    startOfFirstBucket.setDate(startOfFirstBucket.getDate() - (numDays - 1));
    startOfFirstBucket.setHours(0, 0, 0, 0);

    const buckets: VolumeBucket[] = [];
    for (let i = 0; i < numDays; i++) {
      const from = new Date(startOfFirstBucket);
      from.setDate(from.getDate() + i);
      const isLast = i === numDays - 1;
      const to = isLast ? new Date(now) : new Date(from.getTime() + dayMs);
      buckets.push({
        label: from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        from: from.getTime(),
        to: to.getTime(),
        count: 0,
      });
    }
    for (const c of conversations) {
      const t = new Date(c.created_at).getTime();
      if (Number.isNaN(t)) continue;
      const b = buckets.find((b) => t >= b.from && t < b.to);
      if (b) b.count += 1;
    }
    return buckets;
  }

  // quarter: weekly buckets from the start of the range
  const numWeeks = computeVolumeBucketCount(range, now);
  const buckets: VolumeBucket[] = [];
  for (let i = 0; i < numWeeks; i++) {
    const from = new Date(startOfFirstDay);
    from.setDate(from.getDate() + i * 7);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    buckets.push({ label: `W${i + 1}`, from: from.getTime(), to: to.getTime(), count: 0 });
  }
  for (const c of conversations) {
    const t = new Date(c.created_at).getTime();
    if (Number.isNaN(t)) continue;
    const b = buckets.find((b) => t >= b.from && t < b.to);
    if (b) b.count += 1;
  }
  return buckets;
}

function rangeStartMs(range: RangeKey, now: Date): number {
  const d = new Date(now);
  if (range === '7d') d.setDate(d.getDate() - 7);
  else if (range === '30d') d.setDate(d.getDate() - 30);
  else d.setMonth(d.getMonth() - 3);
  return d.getTime();
}

function computeVolumeBucketCount(range: RangeKey, now: Date): number {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  // quarter: no fixed count in the label, align to the KPI range
  const rangeStart = rangeStartMs(range, now);
  const startDay = new Date(rangeStart);
  startDay.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((today.getTime() - startDay.getTime()) / (7 * dayMs)) + 1);
}

export default function AnalyticsPage() {
  const { user, loading: authLoading } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  const { data: org } = useOrganization(orgId ?? undefined);
  const authReady = !authLoading && !!user;
  const analyticsReady = authReady && !!orgId;
  const [range, setRange] = useState<RangeKey>('30d');
  const { start: startDate, end: endDate } = useMemo(() => rangeToDates(range), [range]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [volumeBuckets, setVolumeBuckets] = useState<VolumeBucket[]>([]);
  const [channelSplit, setChannelSplit] = useState<{ email: number; sms: number; webchat: number }>({
    email: 0,
    sms: 0,
    webchat: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metricsRef = useRef<Metrics | null>(null);
  metricsRef.current = metrics;

  const computeMetrics = useCallback(async () => {
    const isRefresh = metricsRef.current !== null;
    if (isRefresh) {
      setRefreshing(true);
      setMetrics(null);
      setVolumeBuckets([]);
      setChannelSplit({ email: 0, sms: 0, webchat: 0 });
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const startIso = new Date(startDate).toISOString();
      const endIso = new Date(endDate + 'T23:59:59.999Z').toISOString();

      const { data: conversations, error: convError } = await insforge.database
        .from('conversations')
        .select('id,status,ai_state,created_at,last_message_at,channel')
        .eq('organization_id', orgId!)
        .gte('created_at', startIso)
        .limit(10000);

      if (convError) {
        setError(convError.message);
        return;
      }

      const convList = Array.isArray(conversations) ? (conversations as Conversation[]) : [];
      const filtered = convList.filter((c) => new Date(c.created_at) <= new Date(endIso));

      const totalConversations = filtered.length;
      const openConversations = filtered.filter((c) => c.status === 'open').length;
      const resolvedConversations = filtered.filter((c) => c.status === 'resolved').length;
      const escalatedConversations = filtered.filter((c) => c.status === 'escalated').length;

      const aiProcessed = filtered.filter(
        (c) => c.ai_state === 'auto_replied' || c.ai_state === 'drafted' || c.ai_state === 'needs_human',
      );
      const autoReplied = filtered.filter((c) => c.ai_state === 'auto_replied');
      const aiAutoReplyRate =
        aiProcessed.length > 0 ? autoReplied.length / aiProcessed.length : null;

      const resolutionRate =
        totalConversations > 0 ? resolvedConversations / totalConversations : null;

      // Channel split
      const channelCounts = { email: 0, sms: 0, webchat: 0 };
      for (const c of filtered) {
        const ch = (c.channel ?? '').toLowerCase();
        if (ch === 'email' || ch === 'sms' || ch === 'webchat') {
          channelCounts[ch as keyof typeof channelCounts] += 1;
        }
      }
      setChannelSplit(channelCounts);

      // Conversation volume — bucketed per selected range
      setVolumeBuckets(buildVolume(filtered, range, new Date()));

      // Average response time from messages
      let averageResponseTimeMs: number | null = null;
      if (filtered.length > 0) {
        const convIds = filtered.slice(0, 100).map((c) => c.id);
        const { data: messages } = await insforge.database
          .from('messages')
          .select('id,conversation_id,sender_type,direction,created_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: true })
          .limit(5000);

        if (messages && Array.isArray(messages)) {
          const byConvo = new Map<string, Message[]>();
          for (const msg of messages as Message[]) {
            const list = byConvo.get(msg.conversation_id) ?? [];
            list.push(msg);
            byConvo.set(msg.conversation_id, list);
          }

          const responseTimes: number[] = [];
          for (const [, msgs] of byConvo) {
            for (let i = 0; i < msgs.length; i++) {
              if (msgs[i].direction === 'inbound') {
                for (let j = i + 1; j < msgs.length; j++) {
                  if (msgs[j].direction === 'outbound') {
                    const inTime = new Date(msgs[i].created_at).getTime();
                    const outTime = new Date(msgs[j].created_at).getTime();
                    const diff = outTime - inTime;
                    if (diff > 0) responseTimes.push(diff);
                    break;
                  }
                }
              }
            }
          }

          if (responseTimes.length > 0) {
            averageResponseTimeMs =
              responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;
          }
        }
      }

      setMetrics({
        totalConversations,
        openConversations,
        resolvedConversations,
        escalatedConversations,
        averageResponseTimeMs,
        aiAutoReplyRate,
        resolutionRate,
      });
    } catch {
      setError('Failed to compute analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [startDate, endDate, orgId, range]);

  useEffect(() => {
    if (!analyticsReady) return;
    computeMetrics();
  }, [analyticsReady, computeMetrics]);

  const channelTotal = channelSplit.email + channelSplit.sms + channelSplit.webchat || 1;
  const channelPct = {
    email: Math.round((channelSplit.email / channelTotal) * 100),
    sms: Math.round((channelSplit.sms / channelTotal) * 100),
    webchat: Math.round((channelSplit.webchat / channelTotal) * 100),
  };
  const maxVolume = Math.max(1, ...volumeBuckets.map((b) => b.count));
  const volumePlaceholderCount =
    volumeBuckets.length > 0
      ? volumeBuckets.length
      : computeVolumeBucketCount(range, new Date());
  const rangeDisabled = loading || refreshing;

  const subline = `${endDate}${org?.name ? ` · ${org.name} workspace` : ''}`;

  return (
    <AppShell>
      <div>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="m-0 text-[24px] font-medium tracking-[-0.02em]">Analytics</h1>
            <p className="mt-1 mb-0 text-[13px] text-[var(--m03-fg-2)]">{subline}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Pill active={range === '7d'} tone="default">
              <button
                type="button"
                onClick={() => setRange('7d')}
                disabled={rangeDisabled}
                className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                style={{ all: 'unset', cursor: 'pointer' }}
              >
                7 days
              </button>
            </Pill>
            <Pill active={range === '30d'}>
              <button
                type="button"
                onClick={() => setRange('30d')}
                disabled={rangeDisabled}
                style={{ all: 'unset', cursor: 'pointer', opacity: rangeDisabled ? 0.6 : 1 }}
              >
                30 days
              </button>
            </Pill>
            <Pill active={range === 'quarter'}>
              <button
                type="button"
                onClick={() => setRange('quarter')}
                disabled={rangeDisabled}
                style={{ all: 'unset', cursor: 'pointer', opacity: rangeDisabled ? 0.6 : 1 }}
              >
                Quarter
              </button>
            </Pill>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]">
            {error}
          </div>
        )}

        {loading && !metrics && !refreshing ? (
          <p className="text-[13px] text-[var(--m03-fg-2)]">Loading analytics…</p>
        ) : (
          <>
            {/* Metric cards */}
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Open conversations"
                value={refreshing || !metrics ? '—' : String(metrics.openConversations)}
              />
              <StatCard
                label="Resolved"
                value={refreshing || !metrics ? '—' : String(metrics.resolvedConversations)}
              />
              <StatCard
                label="AI auto-reply rate"
                value={formatRate(refreshing ? null : (metrics?.aiAutoReplyRate ?? null))}
              />
              <StatCard
                label="First response"
                value={formatDuration(refreshing ? null : (metrics?.averageResponseTimeMs ?? null))}
              />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
              {/* Weekly volume */}
              <div className="rounded-lg border border-[var(--m03-line)] bg-white p-[18px]">
                <div className="mb-3.5 flex items-center justify-between">
                  <h2 className="m-0 text-[14px] font-semibold">Conversation volume</h2>
                  <Pill active>
                    {range === '7d'
                      ? 'Last 7 days'
                      : range === '30d'
                        ? 'Last 30 days'
                        : 'Last quarter'}
                  </Pill>
                </div>
                <div className="flex h-[140px] items-end gap-1.5">
                  {refreshing || volumeBuckets.length === 0
                    ? Array.from({ length: volumePlaceholderCount }).map((_, i) => (
                        <div
                          key={i}
                          className="min-h-[6px] flex-1 animate-pulse rounded-t bg-[var(--m03-line-2)]"
                        />
                      ))
                    : volumeBuckets.map((b, i) => (
                        <div
                          key={i}
                          style={{ height: `${Math.max(6, (b.count / maxVolume) * 100)}%` }}
                          className="min-h-[6px] flex-1 rounded-t bg-[var(--m03-fg)]"
                          title={`${b.label}: ${b.count}`}
                        />
                      ))}
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--m03-fg-3)]">
                  {range === 'quarter' ? (
                    <>
                      <span>W1</span>
                      <span>W3</span>
                      <span>W5</span>
                      <span>W7</span>
                      <span>W9</span>
                      <span>W11</span>
                    </>
                  ) : (
                    <>
                      <span>{volumeBuckets[0]?.label ?? ''}</span>
                      <span>
                        {volumeBuckets[Math.floor(volumeBuckets.length / 2)]?.label ?? ''}
                      </span>
                      <span>{volumeBuckets[volumeBuckets.length - 1]?.label ?? ''}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Channel split */}
              <div className="rounded-lg border border-[var(--m03-line)] bg-white p-[18px]">
                <div className="mb-3.5 flex items-center justify-between">
                  <h2 className="m-0 text-[14px] font-semibold">Channel split</h2>
                </div>
                <div className="flex flex-col gap-2.5">
                  <ChannelBar label="Email" pct={channelPct.email} shade="fg" />
                  <ChannelBar label="SMS" pct={channelPct.sms} shade="fg-2" />
                  <ChannelBar label="Webchat" pct={channelPct.webchat} shade="fg-4" />
                </div>
              </div>
            </div>

              {/* Secondary metrics row */}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard
                  label="Total conversations"
                  value={refreshing || !metrics ? '—' : String(metrics.totalConversations)}
                />
                <StatCard
                  label="Resolution rate"
                  value={formatRate(refreshing ? null : (metrics?.resolutionRate ?? null))}
                />
                <StatCard
                  label="Escalated"
                  value={refreshing || !metrics ? '—' : String(metrics.escalatedConversations)}
                />
              </div>
            </>
          )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--m03-line)] bg-white p-[18px]">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
        {label}
      </div>
      <div className="mt-1.5 text-[32px] font-medium leading-none tracking-[-0.03em] text-[var(--m03-fg)] tabular-nums">
        {value}
      </div>
    </div>
  );
}

function ChannelBar({
  label,
  pct,
  shade,
}: {
  label: string;
  pct: number;
  shade: 'fg' | 'fg-2' | 'fg-4';
}) {
  const color =
    shade === 'fg'
      ? 'var(--m03-fg)'
      : shade === 'fg-2'
        ? 'var(--m03-fg-2)'
        : 'var(--m03-fg-4)';
  return (
    <div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-[var(--m03-fg-2)]">{label}</span>
        <span className="text-[var(--m03-fg)]">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-sm bg-[var(--m03-line-2)]">
        <div
          className="h-1.5 rounded-sm"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
