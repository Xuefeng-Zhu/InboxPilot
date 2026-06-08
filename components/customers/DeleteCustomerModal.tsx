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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-surface-border bg-white p-6 shadow-level-2">
        <h2 className="text-headline-sm text-gray-900">Delete Customer</h2>
        <p className="mt-2 text-body-md text-gray-600">
          Are you sure you want to delete this customer? This action cannot be undone.
        </p>

        {error && (
          <p className="mt-3 text-body-sm text-red-600">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleDelete}
            disabled={deleting}
            className="!bg-red-600 hover:!bg-red-700"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
