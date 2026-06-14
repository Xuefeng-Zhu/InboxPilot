'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { getAccessToken } from '@/lib/insforge';

export interface RemovableMember {
  id: string;
  user_id: string;
  /** Display name from the InsForge auth profile. */
  name: string | null;
  /** Email from the InsForge auth profile. */
  email: string | null;
}

interface RemoveMemberModalProps {
  member: RemovableMember;
  orgId: string;
  onClose: () => void;
  onRemoved: () => void;
}

export function RemoveMemberModal({ member, orgId, onClose, onRemoved }: RemoveMemberModalProps) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/functions/remove-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          organizationId: orgId,
          memberId: member.id,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }

      onRemoved();
    } catch {
      setError('Failed to remove member');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-[var(--m03-line)] bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)]">
        <h2 className="m-0 text-[16px] font-semibold text-[var(--m03-fg)]">
          Remove {member.name ?? member.email ?? member.user_id}?
        </h2>
        <p className="mt-2 mb-0 text-[13px] text-[var(--m03-fg-2)]">
          They will lose access to the organization. This action cannot be undone.
        </p>
        {member.email && member.name && (
          <p className="mt-2 mb-0 truncate text-[12px] text-[var(--m03-fg-2)]">
            {member.email}
          </p>
        )}
        {(!member.name || !member.email) && (
          <p className="mt-2 mb-0 truncate font-mono text-[11px] text-[var(--m03-fg-3)]">
            {member.user_id}
          </p>
        )}

        {error && (
          <p className="mt-3 text-[12px] text-[var(--m03-red)]">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={removing}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            className="cursor-pointer rounded-md border border-transparent bg-[var(--m03-red)] px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}
