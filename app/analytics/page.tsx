'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge } from '@/lib/insforge';

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
  const { user, loading: authLoading } = useAuth();

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

      const { data: conversations, error: convError } = await insforge.from<Conversation>(
        'conversations',
        {
          select: 'id,status,ai_state,created_at,last_message_at',
          filter: {
            created_at: `gte.${startIso}`,
          },
          limit: 10000,
        },
      );

      if (convError) {
        setError(convError.message);
        return;
      }

      const convList = Array.isArray(conversations) ? conversations : [];
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

      // Compute average response time from messages
      let averageResponseTimeMs: number | null = null;
      if (filtered.length > 0) {
        // Fetch messages for these conversations to compute response times
        const convIds = filtered.slice(0, 100).map((c) => c.id); // Limit for performance
        const { data: messages } = await insforge.from<Message>('messages', {
          select: 'id,conversation_id,sender_type,direction,created_at',
          filter: {
            conversation_id: `in.(${convIds.join(',')})`,
          },
          order: 'created_at.asc',
          limit: 5000,
        });

        if (messages && Array.isArray(messages)) {
          // Group messages by conversation
          const byConvo = new Map<string, Message[]>();
          for (const msg of messages) {
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
      });
    } catch {
      setError('Failed to compute analytics');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (!authLoading && user) {
      computeMetrics();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, computeMetrics]);

  // Loading state
  if (authLoading || loading) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="mt-4 text-sm text-gray-500">Loading analytics…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="mt-4 text-sm text-red-600">Please sign in to view analytics.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="mt-1 text-sm text-gray-600">
          Monitor support performance and AI metrics.
        </p>

        {/* Date Range Filter */}
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="start-date" className="block text-sm font-medium text-gray-700">
              Start Date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-sm font-medium text-gray-700">
              End Date
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={computeMetrics}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Apply
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Metrics Cards */}
        {metrics && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Total Conversations"
              value={String(metrics.totalConversations)}
              description="All conversations in the selected period"
            />
            <MetricCard
              label="Open"
              value={String(metrics.openConversations)}
              description="Currently open conversations"
              color="blue"
            />
            <MetricCard
              label="Resolved"
              value={String(metrics.resolvedConversations)}
              description="Successfully resolved conversations"
              color="green"
            />
            <MetricCard
              label="Escalated"
              value={String(metrics.escalatedConversations)}
              description="Conversations escalated to human agents"
              color="yellow"
            />
            <MetricCard
              label="Avg Response Time"
              value={formatDuration(metrics.averageResponseTimeMs)}
              description="Average time to first reply"
            />
            <MetricCard
              label="AI Auto-Reply Rate"
              value={formatPercent(metrics.aiAutoReplyRate)}
              description="Percentage of AI-processed conversations auto-replied"
              color="purple"
            />
          </div>
        )}

        {!metrics && !error && (
          <div className="mt-8 rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500">No analytics data available for the selected period.</p>
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// MetricCard sub-component
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  description,
  color = 'gray',
}: {
  label: string;
  value: string;
  description: string;
  color?: 'gray' | 'blue' | 'green' | 'yellow' | 'purple';
}) {
  const borderColors: Record<string, string> = {
    gray: 'border-gray-200',
    blue: 'border-blue-200',
    green: 'border-green-200',
    yellow: 'border-yellow-200',
    purple: 'border-purple-200',
  };

  const valueColors: Record<string, string> = {
    gray: 'text-gray-900',
    blue: 'text-blue-700',
    green: 'text-green-700',
    yellow: 'text-yellow-700',
    purple: 'text-purple-700',
  };

  return (
    <div className={`rounded-lg border ${borderColors[color]} bg-white p-4 shadow-sm`}>
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${valueColors[color]}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-400">{description}</p>
    </div>
  );
}
