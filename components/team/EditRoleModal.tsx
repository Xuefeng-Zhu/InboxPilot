'use client';

import { useMemo, useState } from 'react';
import { Button, Select } from '@/components/ui';
import { getAccessToken } from '@/lib/insforge';
import type { MemberRole } from '@support-core/types';

export interface EditableMember {
  id: string;
  user_id: string;
  /** Display name from the InsForge auth profile. */
  name: string | null;
  /** Email from the InsForge auth profile. */
  email: string | null;
  role: MemberRole;
}

interface EditRoleModalProps {
  member: EditableMember;
  orgId: string;
  /**
   * The role of the currently signed-in user. The 'Owner' option is hidden
   * for anyone other than the current owner — owner promotion is a separate
   * ownership-transfer flow gated server-side.
   */
  currentUserRole: MemberRole;
  onClose: () => void;
  onSaved: () => void;
}

const ALL_ROLE_OPTIONS: ReadonlyArray<{ value: MemberRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'agent', label: 'Agent' },
  { value: 'viewer', label: 'Viewer' },
];

export function EditRoleModal({
  member,
  orgId,
  currentUserRole,
  onClose,
  onSaved,
}: EditRoleModalProps) {
  // 'Owner' is only assignable by the current owner. For anyone else we
  // hide it from the dropdown so the option is never even visible.
  const roleOptions = useMemo(
    () =>
      currentUserRole === 'owner'
        ? ALL_ROLE_OPTIONS
        : ALL_ROLE_OPTIONS.filter((o) => o.value !== 'owner'),
    [currentUserRole],
  );

  const [newRole, setNewRole] = useState<MemberRole>(member.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = newRole !== member.role;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/functions/change-member-role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          organizationId: orgId,
          memberId: member.id,
          newRole,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }

      onSaved();
    } catch {
      setError('Failed to update role');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--m03-line)] bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)]">
        <h2 className="m-0 mb-1 text-[16px] font-semibold text-[var(--m03-fg)]">
          Edit role
        </h2>
        <p className="m-0 mb-1 truncate text-[13px] text-[var(--m03-fg-2)]">
          {member.name ?? member.email ?? member.user_id}
        </p>
        {member.name && member.email && (
          <p className="m-0 mb-4 truncate text-[12px] text-[var(--m03-fg-2)]">
            {member.email}
          </p>
        )}
        {(!member.name || !member.email) && (
          <p className="m-0 mb-4 truncate font-mono text-[11px] text-[var(--m03-fg-3)]">
            {member.user_id}
          </p>
        )}

        {error && (
          <p className="mb-3 text-[12px] text-[var(--m03-red)]">{error}</p>
        )}

        <Select
          label="Role"
          value={newRole}
          onValueChange={(v) => setNewRole(v as MemberRole)}
          options={roleOptions.map((o) => ({ value: o.value, label: o.label }))}
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
