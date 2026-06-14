'use client';

import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { getAccessToken } from '@/lib/insforge';
import type { MemberRole } from '@support-core/types';

const ROLE_OPTIONS: ReadonlyArray<{ value: MemberRole; label: string; description: string }> = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full access — can manage members, settings, and all conversations',
  },
  {
    value: 'agent',
    label: 'Agent',
    description: 'Can view and reply to conversations; cannot manage members or settings',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Read-only access to conversations and knowledge base',
  },
];
// 'owner' is excluded — ownership is transferred via changeMemberRole, not invite.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254; // RFC 5321 max email length

interface InviteMemberModalProps {
  orgId: string;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteMemberModal({ orgId, onClose, onInvited }: InviteMemberModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('agent');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = email.trim();
  const emailValid =
    trimmed.length > 0 &&
    trimmed.length <= EMAIL_MAX_LENGTH &&
    EMAIL_REGEX.test(trimmed);

  const handleInvite = async () => {
    if (!emailValid) {
      setError('Enter a valid email address');
      return;
    }
    setInviting(true);
    setError(null);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/functions/invite-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organizationId: orgId, email: trimmed, role }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }

      onInvited();
    } catch {
      setError('Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  const selectedRoleDescription =
    ROLE_OPTIONS.find((o) => o.value === role)?.description ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--m03-line)] bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)]">
        <h2 className="m-0 mb-1 text-[16px] font-semibold text-[var(--m03-fg)]">
          Invite member
        </h2>
        <p className="m-0 mb-4 text-[13px] text-[var(--m03-fg-2)]">
          Add an existing InboxPilot user to this organization. The user must
          already have an account — invitations are not sent by email.
        </p>

        {error && (
          <p className="mb-3 text-[12px] text-[var(--m03-red)]">{error}</p>
        )}

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@example.com"
          autoFocus
          autoComplete="email"
        />

        <div className="mt-3">
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <p className="mt-1 text-[12px] text-[var(--m03-fg-2)]">
            {selectedRoleDescription}
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={inviting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleInvite}
            disabled={inviting || !emailValid}
          >
            {inviting ? 'Inviting…' : 'Add to team'}
          </Button>
        </div>
      </div>
    </div>
  );
}
