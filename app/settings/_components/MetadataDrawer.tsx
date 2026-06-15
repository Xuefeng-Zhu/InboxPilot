'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { AuditLogRow } from '@/lib/queries';
import { Button } from '@/components/ui';

interface MetadataDrawerProps {
  row: AuditLogRow | null;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// MetadataDrawer
//
// Right-side slide-in panel that shows the full JSON metadata of a single
// audit log row. Mirrors the drawer pattern in `components/inbox/RightPanel.tsx`
// (fixed right-anchored, backdrop, ESC + backdrop close, slide-in transition)
// so the visual language stays consistent with the rest of the app.
// ---------------------------------------------------------------------------

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
}

function actorLabel(row: AuditLogRow): string {
  if (row.actor_type === 'system') return 'system';
  if (row.actor_type === 'ai') return 'ai';
  return row.actor_id ?? '—';
}

export function MetadataDrawer({ row, onClose }: MetadataDrawerProps) {
  const open = row !== null;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 right-0 z-50 w-[440px] max-w-[90vw] transform bg-white shadow-level-3 transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Audit log metadata"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-[var(--m03-line)] px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[var(--m03-fg)]">Metadata</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[var(--m03-fg-3)] transition-colors hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
              aria-label="Close metadata"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {row && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[12px]">
                <dt className="text-[var(--m03-fg-3)]">When</dt>
                <dd className="m-0 text-[var(--m03-fg)]">{formatTimestamp(row.created_at)}</dd>

                <dt className="text-[var(--m03-fg-3)]">Actor</dt>
                <dd className="m-0 font-mono text-[12px] text-[var(--m03-fg)] break-all">
                  {actorLabel(row)}
                </dd>

                <dt className="text-[var(--m03-fg-3)]">Type</dt>
                <dd className="m-0 font-mono text-[12px] text-[var(--m03-fg)]">{row.actor_type}</dd>

                <dt className="text-[var(--m03-fg-3)]">Action</dt>
                <dd className="m-0 font-mono text-[12px] text-[var(--m03-fg)] break-all">
                  {row.action}
                </dd>

                <dt className="text-[var(--m03-fg-3)]">Resource</dt>
                <dd className="m-0 text-[var(--m03-fg)] break-all">
                  <div>{row.resource_type}</div>
                  {row.resource_id && (
                    <div className="font-mono text-[11px] text-[var(--m03-fg-3)]">
                      {row.resource_id}
                    </div>
                  )}
                </dd>
              </dl>

              <div>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  Raw metadata
                </h3>
                <pre className="max-h-[60vh] overflow-auto rounded border border-[var(--m03-line)] bg-[var(--m03-line-2)] p-3 font-mono text-[12px] leading-relaxed text-[var(--m03-fg)]">
                  {JSON.stringify(row.metadata ?? {}, null, 2)}
                </pre>
              </div>

              <div className="mt-auto flex justify-end">
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
