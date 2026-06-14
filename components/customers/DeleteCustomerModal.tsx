'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { insforge } from '@/lib/insforge';

interface DeleteCustomerModalProps {
  customerId: string;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteCustomerModal({ customerId, onClose, onDeleted }: DeleteCustomerModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const { error: deleteError } = await insforge.database
        .from('contacts')
        .delete()
        .eq('id', customerId);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      onDeleted();
    } catch {
      setError('Failed to delete customer');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-[var(--m03-line)] bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)]">
        <h2 className="m-0 text-[16px] font-semibold text-[var(--m03-fg)]">Delete customer</h2>
        <p className="mt-2 mb-0 text-[13px] text-[var(--m03-fg-2)]">
          Are you sure you want to delete this customer? This action cannot be undone.
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
