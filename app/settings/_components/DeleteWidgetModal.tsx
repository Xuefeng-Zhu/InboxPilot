'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

interface DeleteWidgetModalProps {
  widgetName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteWidgetModal({ widgetName, onClose, onConfirm }: DeleteWidgetModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete widget');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-[var(--m03-line)] bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)]">
        <h2 className="m-0 text-[16px] font-semibold text-[var(--m03-fg)]">Delete widget</h2>
        <p className="mt-2 mb-0 text-[13px] text-[var(--m03-fg-2)]">
          Are you sure you want to delete <strong className="font-medium text-[var(--m03-fg)]">{widgetName}</strong>?
          This will permanently remove the widget, all of its chat threads, and any
          conversations and contacts that came through it. This action cannot be undone.
        </p>

        {error && (
          <p className="mt-3 text-[12px] text-[var(--m03-red)]">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={deleting}>Cancel</Button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="cursor-pointer rounded-md border border-transparent bg-[var(--m03-red)] px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
