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
  const { widgets, loading, error, refresh } = useWebchatWidgets(orgId ?? null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between pl-12 xl:pl-0">
        <div>
          <h2 className="text-headline-sm text-gray-900">Web Chat Widgets</h2>
          <p className="mt-1 text-body-md text-gray-500">
            Create embeddable chat widgets for your websites.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-primary px-4 py-2 text-body-sm font-medium text-white hover:bg-primary-600 transition-colors"
        >
          Create Widget
        </button>
      </header>

      {error && (
        <div role="alert" className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-8 flex justify-center">
          <p className="text-body-sm text-gray-500">Loading widgets…</p>
        </div>
      ) : widgets.length === 0 ? (
        <div className="mt-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
            <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
            </svg>
          </div>
          <p className="mt-3 text-body-md font-medium text-gray-500">No widgets yet</p>
          <p className="mt-1 text-body-sm text-gray-400">Create a widget to embed live chat on your website.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {widgets.map((widget) => (
            <WidgetCard key={widget.id} widget={widget} onRefresh={refresh} />
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
