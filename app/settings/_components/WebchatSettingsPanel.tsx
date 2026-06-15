'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useOrgMembership } from '@/lib/queries';
import { useWebchatWidgets } from './useWebchatWidgets';
import { CreateWidgetModal } from './CreateWidgetModal';
import { WidgetCard } from './WidgetCard';

export default function WebchatSettingsPanel() {
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  const { widgets, loading, error, refresh, deleteWidget } = useWebchatWidgets(orgId ?? null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">Web Chat Widgets</h2>
          <p className="mt-1 text-[13px] text-[var(--m03-fg-2)]">
            Create embeddable chat widgets for your websites.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 py-1.5 text-[13px] font-medium text-[var(--m03-bg)] transition-colors hover:bg-[var(--m03-fg-2)]"
        >
          Create Widget
        </button>
      </header>

      {error && (
        <div role="alert" className="mt-6 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-8 flex justify-center">
          <p className="text-[13px] text-[var(--m03-fg-2)]">Loading widgets…</p>
        </div>
      ) : widgets.length === 0 ? (
        <div className="mt-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--m03-line-2)]">
            <svg className="h-6 w-6 text-[var(--m03-fg-3)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
            </svg>
          </div>
          <p className="mt-3 text-[14px] font-medium text-[var(--m03-fg-2)]">No widgets yet</p>
          <p className="mt-1 text-[12px] text-[var(--m03-fg-3)]">Create a widget to embed live chat on your website.</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {widgets.map((widget) => (
            <WidgetCard key={widget.id} widget={widget} onRefresh={refresh} onDelete={deleteWidget} />
          ))}
        </div>
      )}

      {showCreate && orgId && (
        <CreateWidgetModal
          orgId={orgId}
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      )}
    </>
  );
}
