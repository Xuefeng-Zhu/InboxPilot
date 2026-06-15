'use client';

import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { Card, Input, Select, Tooltip } from '@/components/ui';
import { useAuditLogs, type AuditLogRow } from '@/lib/queries';
import { MetadataDrawer } from './MetadataDrawer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Use a non-empty sentinel for "no filter" — Radix's <Select.Item> rejects
// empty-string values (it reserves the empty string to clear selection).
const ALL_ACTORS = 'all';

const ACTOR_TYPE_OPTIONS = [
  { value: ALL_ACTORS, label: 'All actors' },
  { value: 'user', label: 'User' },
  { value: 'system', label: 'System' },
  { value: 'ai', label: 'AI' },
];

const ACTOR_TYPE_BADGE: Record<'user' | 'system' | 'ai', string> = {
  user: 'bg-[var(--m03-line-2)] text-[var(--m03-fg-2)] border border-[var(--m03-line)]',
  system: 'bg-[var(--m03-line-2)] text-[var(--m03-fg-3)] border border-[var(--m03-line)]',
  ai: 'bg-[var(--m03-blue-fill)] text-[var(--m03-blue)] border border-[var(--m03-blue-line)]',
};

type ActorTypeFilter = 'all' | 'user' | 'system' | 'ai';

function isActorTypeFilter(value: string): value is ActorTypeFilter {
  return value === 'all' || value === 'user' || value === 'system' || value === 'ai';
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function truncateId(id: string | null): string {
  if (!id) return '—';
  if (id.length <= 12) return id;
  return `${id.slice(0, 12)}…`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function actorDisplay(row: AuditLogRow): string {
  if (row.actor_type === 'system') return 'system';
  if (row.actor_type === 'ai') return 'ai';
  return truncateId(row.actor_id);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AuditLogSettingsPanel() {
  const [actorType, setActorType] = useState<ActorTypeFilter>('all');
  const [search, setSearch] = useState('');
  const [openRow, setOpenRow] = useState<AuditLogRow | null>(null);

  const filters = useMemo(
    () => ({
      ...(actorType !== 'all' ? { actorType } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    [actorType, search],
  );

  const { data, isLoading, error } = useAuditLogs(filters);
  const rows: AuditLogRow[] = Array.isArray(data) ? data : [];

  const errorMessage =
    error instanceof Error ? error.message : error ? 'Failed to load audit log.' : null;

  return (
    <Card
      header={
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">
            Audit Log
          </h2>
          <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">
            Append-only record of every AI decision, escalation, and credential change.
            Showing the most recent 100 events for your organization.
          </p>
        </div>
      }
    >
      {errorMessage && (
        <div
          className="mb-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3"
          role="alert"
        >
          <p className="text-[14px] text-[var(--m03-red)]">{errorMessage}</p>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-[180px_1fr]">
        <Select
          id="audit-actor-type"
          label="Actor"
          value={actorType}
          onValueChange={(v) => {
            if (isActorTypeFilter(v)) setActorType(v);
          }}
          options={ACTOR_TYPE_OPTIONS}
        />
        <Input
          id="audit-search"
          label="Search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by action or resource type"
        />
      </div>

      {isLoading ? (
        <div className="py-8 text-center">
          <p className="text-[14px] text-[var(--m03-fg-2)]">Loading audit log…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-[14px] text-[var(--m03-fg-2)]">No audit log entries yet.</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-md border border-[var(--m03-line)]">
          <table className="w-full min-w-[960px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  When
                </th>
                <th className="border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  Actor
                </th>
                <th className="border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  Type
                </th>
                <th className="border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  Action
                </th>
                <th className="border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  Resource
                </th>
                <th className="border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  Metadata
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--m03-line)] align-top last:border-b-0"
                >
                  <td
                    className="px-3 py-2.5 whitespace-nowrap text-[var(--m03-fg-2)]"
                    title={row.created_at}
                  >
                    {formatTimestamp(row.created_at)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--m03-fg-2)]">
                    {actorDisplay(row)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-[3px] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.04em] ${ACTOR_TYPE_BADGE[row.actor_type]}`}
                    >
                      {row.actor_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--m03-fg)]">
                    {row.action}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--m03-fg-2)]">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px]">{row.resource_type}</span>
                      {row.resource_id && (
                        <span className="font-mono text-[11px] text-[var(--m03-fg-3)]">
                          {truncateId(row.resource_id)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Tooltip content="View metadata" side="left">
                      <button
                        type="button"
                        onClick={() => setOpenRow(row)}
                        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-[var(--m03-fg-3)] transition-colors hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
                        aria-label={`View metadata for ${row.action} (${row.id.slice(-8)})`}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MetadataDrawer row={openRow} onClose={() => setOpenRow(null)} />
    </Card>
  );
}
