'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { insforge } from '@/lib/insforge';
import { DashboardShell } from '@/components/DashboardShell';
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

function formatPercent(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatCsat(score: number | null): string {
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

export default function AnalyticsPage() {
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  const { data: org } = useOrganization(orgId ?? undefined);
  const [range, setRange] = useState<RangeKey>('30d');
  const { start: startDate, end: endDate } = useMemo(() => rangeToDates(range), [range]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [weeklyVolume, setWeeklyVolume] = useState<number[]>([]);
  const [channelSplit, setChannelSplit] = useState<{ email: number; sms: number; webchat: number }>({
    email: 0,
    sms: 0,
    webchat: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const computeMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const startIso = new Date(startDate).toISOString();
      const endIso = new Date(endDate + 'T23:59:59.999Z').toISOString();

      const { data: conversations, error: convError } = await insforge.database
        .from('conversations')
        .select('id,status,ai_state,created_at,last_message_at,channel')
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

      // 12-week conversation volume (independent of selected range)
      const twelveWeeksAgo = new Date();
      twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);
      const weekly = new Array(12).fill(0) as number[];
      for (const c of convList) {
        const t = new Date(c.created_at).getTime();
        if (Number.isNaN(t)) continue;
        if (t < twelveWeeksAgo.getTime()) continue;
        const weeksAgo = Math.floor((Date.now() - t) / (7 * 24 * 60 * 60 * 1000));
        const idx = 11 - weeksAgo;
        if (idx >= 0 && idx < 12) weekly[idx] += 1;
      }
      setWeeklyVolume(weekly);

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
    }
  }, [startDate, endDate]);

  useEffect(() => {
    computeMetrics();
  }, [computeMetrics]);

  const channelTotal = channelSplit.email + channelSplit.sms + channelSplit.webchat || 1;
  const channelPct = {
    email: Math.round((channelSplit.email / channelTotal) * 100),
    sms: Math.round((channelSplit.sms / channelTotal) * 100),
    webchat: Math.round((channelSplit.webchat / channelTotal) * 100),
  };
  const maxWeekly = Math.max(1, ...weeklyVolume);

  const subline = `${endDate}${org?.name ? ` · ${org.name} workspace` : ''}`;

  return (
    <DashboardShell>
      <div
        style={{
          fontFamily: 'var(--font-inter), Inter, system-ui, -apple-system, sans-serif',
        }}
      >
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
                className="cursor-pointer"
                style={{ all: 'unset', cursor: 'pointer' }}
              >
                7 days
              </button>
            </Pill>
            <Pill active={range === '30d'}>
              <button
                type="button"
                onClick={() => setRange('30d')}
                style={{ all: 'unset', cursor: 'pointer' }}
              >
                30 days
              </button>
            </Pill>
            <Pill active={range === 'quarter'}>
              <button
                type="button"
                onClick={() => setRange('quarter')}
                style={{ all: 'unset', cursor: 'pointer' }}
              >
                Quarter
              </button>
            </Pill>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        {loading && !metrics ? (
          <p className="text-[13px] text-[var(--m03-fg-2)]">Loading analytics…</p>
        ) : (
          metrics && (
            <>
              {/* Metric cards */}
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Open conversations" value={String(metrics.openConversations)} />
                <StatCard label="Resolved" value={String(metrics.resolvedConversations)} />
                <StatCard
                  label="AI auto-reply rate"
                  value={formatCsat(metrics.aiAutoReplyRate)}
                />
                <StatCard
                  label="First response"
                  value={formatDuration(metrics.averageResponseTimeMs)}
                />
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
                {/* Weekly volume */}
                <div className="rounded-lg border border-[var(--m03-line)] bg-white p-[18px]">
                  <div className="mb-3.5 flex items-center justify-between">
                    <h2 className="m-0 text-[14px] font-semibold">Conversation volume</h2>
                    <Pill active>Last 12 weeks</Pill>
                  </div>
                  <div className="flex h-[140px] items-end gap-1.5">
                    {weeklyVolume.length === 0
                      ? Array.from({ length: 12 }).map((_, i) => (
                          <div
                            key={i}
                            style={{ height: `${20 + i * 6}%` }}
                            className="min-h-[6px] flex-1 rounded-t bg-[var(--m03-fg)]"
                          />
                        ))
                      : weeklyVolume.map((v, i) => (
                          <div
                            key={i}
                            style={{ height: `${Math.max(6, (v / maxWeekly) * 100)}%` }}
                            className="min-h-[6px] flex-1 rounded-t bg-[var(--m03-fg)]"
                            title={`Week ${i + 1}: ${v}`}
                          />
                        ))}
                  </div>
                  <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--m03-fg-3)]">
                    <span>W1</span>
                    <span>W3</span>
                    <span>W5</span>
                    <span>W7</span>
                    <span>W9</span>
                    <span>W11</span>
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
                <StatCard label="Total conversations" value={String(metrics.totalConversations)} />
                <StatCard
                  label="Resolution rate"
                  value={formatCsat(metrics.resolutionRate)}
                />
                <StatCard label="Escalated" value={String(metrics.escalatedConversations)} />
              </div>
            </>
          )
        )}
      </div>
    </DashboardShell>
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
