'use client';

import { useCallback, useEffect, useState } from 'react';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { MetricCard, Card } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Conversation {
  id: string;
  status: string;
  ai_state: string;
  created_at: string;
  last_message_at: string | null;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function getDefaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const computeMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch conversations within date range
      const startIso = new Date(startDate).toISOString();
      const endIso = new Date(endDate + 'T23:59:59.999Z').toISOString();

      const { data: conversations, error: convError } = await insforge.database
        .from('conversations')
        .select('id,status,ai_state,created_at,last_message_at')
        .gte('created_at', startIso)
        .limit(10000);

      if (convError) {
        setError(convError.message);
        return;
      }

      const convList = Array.isArray(conversations) ? (conversations as Conversation[]) : [];
      // Filter by end date client-side
      const filtered = convList.filter((c) => new Date(c.created_at) <= new Date(endIso));

      const totalConversations = filtered.length;
      const openConversations = filtered.filter((c) => c.status === 'open').length;
      const resolvedConversations = filtered.filter((c) => c.status === 'resolved').length;
      const escalatedConversations = filtered.filter((c) => c.status === 'escalated').length;

      // Compute AI auto-reply rate
      const aiProcessed = filtered.filter(
        (c) => c.ai_state === 'auto_replied' || c.ai_state === 'drafted' || c.ai_state === 'needs_human',
      );
      const autoReplied = filtered.filter((c) => c.ai_state === 'auto_replied');
      const aiAutoReplyRate =
        aiProcessed.length > 0 ? autoReplied.length / aiProcessed.length : null;

      // Resolution rate — ratio of resolved to total conversations
      const resolutionRate = totalConversations > 0
        ? resolvedConversations / totalConversations
        : null;

      // Compute average response time from messages
      let averageResponseTimeMs: number | null = null;
      if (filtered.length > 0) {
        // Fetch messages for these conversations to compute response times
        const convIds = filtered.slice(0, 100).map((c) => c.id); // Limit for performance
        const { data: messages } = await insforge.database
          .from('messages')
          .select('id,conversation_id,sender_type,direction,created_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: true })
          .limit(5000);

        if (messages && Array.isArray(messages)) {
          // Group messages by conversation
          const byConvo = new Map<string, Message[]>();
          for (const msg of messages as Message[]) {
            const list = byConvo.get(msg.conversation_id) ?? [];
            list.push(msg);
            byConvo.set(msg.conversation_id, list);
          }

          // Calculate response times: time between inbound and first outbound reply
          const responseTimes: number[] = [];
          for (const [, msgs] of byConvo) {
            for (let i = 0; i < msgs.length; i++) {
              if (msgs[i].direction === 'inbound') {
                // Find next outbound message
                for (let j = i + 1; j < msgs.length; j++) {
                  if (msgs[j].direction === 'outbound') {
                    const inTime = new Date(msgs[i].created_at).getTime();
                    const outTime = new Date(msgs[j].created_at).getTime();
                    const diff = outTime - inTime;
                    if (diff > 0) {
                      responseTimes.push(diff);
                    }
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

  // Loading state
  if (loading) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Analytics</h1>
          <p className="mt-4 text-body-md text-gray-500">Loading analytics…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-container-margin">
        <h1 className="text-headline-sm text-gray-900">Analytics</h1>
        <p className="mt-1 text-body-md text-gray-600">
          Monitor support performance and AI metrics.
        </p>

        {/* Date Range Filter */}
        <div className="mt-6 flex flex-wrap items-end gap-element-gap">
          <div>
            <label htmlFor="start-date" className="block text-label-md text-gray-700">
              Start Date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block rounded border border-surface-border px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-1"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-label-md text-gray-700">
              End Date
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block rounded border border-surface-border px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-1"
            />
          </div>
          <button
            type="button"
            onClick={computeMetrics}
            className="cursor-pointer rounded bg-primary px-4 py-2 text-body-md font-medium text-white hover:bg-primary-600 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-2"
          >
            Apply
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-body-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Metrics Grid */}
        {metrics && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-element-gap">
            <MetricCard
              label="Total Conversations"
              value={String(metrics.totalConversations)}
              trend={
                metrics.totalConversations > 0
                  ? { direction: 'up', value: `${metrics.totalConversations} total` }
                  : undefined
              }
              accentColor="primary"
            />
            <MetricCard
              label="Avg Response Time"
              value={formatDuration(metrics.averageResponseTimeMs)}
              trend={
                metrics.averageResponseTimeMs !== null
                  ? metrics.averageResponseTimeMs < 60000
                    ? { direction: 'up', value: 'Under 1m' }
                    : { direction: 'down', value: 'Over 1m' }
                  : undefined
              }
              accentColor="primary"
            />
            <MetricCard
              label="Resolution Rate"
              value={formatCsat(metrics.resolutionRate)}
              trend={
                metrics.resolutionRate !== null
                  ? metrics.resolutionRate >= 0.5
                    ? { direction: 'up', value: formatCsat(metrics.resolutionRate) }
                    : { direction: 'down', value: formatCsat(metrics.resolutionRate) }
                  : undefined
              }
              accentColor="status-resolved"
            />
            <MetricCard
              label="AI Resolution Rate"
              value={formatPercent(metrics.aiAutoReplyRate)}
              trend={
                metrics.aiAutoReplyRate !== null
                  ? metrics.aiAutoReplyRate >= 0.5
                    ? { direction: 'up', value: formatPercent(metrics.aiAutoReplyRate) }
                    : { direction: 'down', value: formatPercent(metrics.aiAutoReplyRate) }
                  : undefined
              }
              accentColor="ai"
            />
          </div>
        )}

        {/* Secondary metrics */}
        {metrics && (
          <div className="mt-element-gap grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-element-gap">
            <MetricCard
              label="Open Conversations"
              value={String(metrics.openConversations)}
              accentColor="status-open"
            />
            <MetricCard
              label="Resolved"
              value={String(metrics.resolvedConversations)}
              accentColor="status-resolved"
            />
            <MetricCard
              label="Escalated"
              value={String(metrics.escalatedConversations)}
              trend={
                metrics.escalatedConversations > 0
                  ? { direction: 'down', value: `${metrics.escalatedConversations} escalated` }
                  : undefined
              }
              accentColor="status-open"
            />
          </div>
        )}

        {!metrics && !error && (
          <Card className="mt-8 text-center">
            <p className="text-body-md text-gray-500">No analytics data available for the selected period.</p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
