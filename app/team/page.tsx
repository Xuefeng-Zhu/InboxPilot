'use client';

import { useTeamMembers } from '@/lib/queries';
import { AppShell } from '@/components/layout';
import { Card } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'agent' | 'viewer';
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TeamPage() {
  const { data: members = [], isLoading, error } = useTeamMembers();

  if (isLoading) {
    return (
      <AppShell>
        <div>
          <h1 className="m-0 text-[24px] font-medium tracking-[-0.02em]">Team</h1>
          <p className="mt-1 mb-0 text-[13px] text-[var(--m03-fg-2)]">Manage your team members and roles.</p>
          <p className="mt-4 text-[13px] text-[var(--m03-fg-2)]">Loading team members…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div>
        <h1 className="m-0 text-[24px] font-medium tracking-[-0.02em]">Team</h1>
        <p className="mt-1 mb-0 text-[13px] text-[var(--m03-fg-2)]">Manage your team members and roles.</p>

        {error && (
          <div
            className="mt-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]"
            role="alert"
          >
            {error.message}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {members.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--m03-line)] p-8 text-center">
              <p className="text-[13px] text-[var(--m03-fg-2)]">No team members found.</p>
              <p className="mt-1 text-[12px] text-[var(--m03-fg-3)]">
                Invite team members to start collaborating.
              </p>
            </div>
          ) : (
            members.map((member) => (
              <Card key={(member as TeamMember).id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-[var(--m03-fg)]">
                      {(member as TeamMember).user_id}
                    </p>
                    <p className="text-[12px] text-[var(--m03-fg-2)]">
                      {formatRole((member as TeamMember).role)} · Joined {formatDate((member as TeamMember).created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] font-medium text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]"
                    >
                      Edit Role
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] font-medium text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
