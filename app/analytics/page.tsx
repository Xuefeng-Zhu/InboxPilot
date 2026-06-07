'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { insforge, getAccessToken } from '@/lib/insforge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Metrics {
  totalConversations: number;
  openConversations: number;
  resolvedConversations: number;
  escalatedConversations: number;
  pendingConversations: number;
  aiProcessedConversations: number;
  aiAutoRepliedConversations: number;
  aiAutoReplyRate: number | null;
  averageResponseTimeMs: number | null;
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

/**
 * Resolve the org the current user wants to view analytics for.
 *
 * The inbox sidebar already picks the first organization_members row
 * (see `components/inbox/ConversationList.tsx:48-55` + MEDIUM-11), so
 * we mirror that here — same query, same "first row wins" semantics.
 * A future org-switcher should be the single source of truth for both
 * the inbox and the analytics page; this is the smallest change that
 * closes HIGH-8 without inventing a new UI surface.
 */
async function fetchUserOrganizationId(): Promise<string | null> {
  const { data: { user } } = await insforge.auth.getCurrentUser();
  const userId = user?.id;
  if (!userId) return null;
  const { data, error } = await insforge.database
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : null;
  return row?.organization_id ?? null;
}

/**
 * POST the analytics request to the server-side aggregation function.
 *
 * HIGH-8 fix: the page used to compute metrics by reading up to 10k
 * conversations and 5k messages in the browser and filtering in JS.
 * That was unbounded-then-truncated: with >10k conversations in the
 * period, the totals were silently wrong, and the response-time
 * average was computed over the first 100 conversations.
 *
 * The new path is a single round-trip to a serverless function that
 * calls `analytics_overview(p_org, p_start, p_end)` (migration 005).
 * All date filtering and the response-time LATERAL join run in SQL.
 * The page no longer touches `conversations` or `messages` directly
 * — see `insforge/migrations/005_analytics_aggregation.sql` for the
 * full SQL.
 */
async function fetchAnalytics(
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<Metrics> {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';
  const token = getAccessToken();
  const res = await fetch(`${baseUrl}/functions/v1/analytics-overview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ organizationId, startDate, endDate }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    status?: string;
    data?: Metrics;
    error?: string;
  };

  if (!res.ok || payload.status !== 'ok' || !payload.data) {
    throw new Error(payload.error ?? `Analytics request failed (HTTP ${res.status})`);
  }
  return payload.data;
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
      const organizationId = await fetchUserOrganizationId();
      if (!organizationId) {
        setError('Could not resolve an organization for the current user');
        return;
      }
      const data = await fetchAnalytics(organizationId, startDate, endDate);
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute analytics');
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
