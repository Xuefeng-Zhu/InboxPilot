'use client';

import { useAuth } from '@/lib/auth-context';
import { useTeamMembers } from '@/lib/queries';
import { AppShell } from '@/components/layout';
import { Button, Card } from '@/components/ui';

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
  const { user, loading: authLoading } = useAuth();
  const { data: members = [], isLoading, error } = useTeamMembers();

  if (authLoading || isLoading) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Team</h1>
          <p className="mt-1 text-body-md text-gray-500">Manage your team members and roles.</p>
          <p className="mt-4 text-body-md text-gray-500">Loading team members…</p>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Team</h1>
          <p className="mt-1 text-body-md text-gray-500">Manage your team members and roles.</p>
          <p className="mt-4 text-body-md text-red-600">Please sign in to manage your team.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-container-margin">
        {/* Page header */}
        <h1 className="text-headline-sm text-gray-900">Team</h1>
        <p className="mt-1 text-body-md text-gray-500">Manage your team members and roles.</p>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-body-md text-red-700">{error.message}</p>
          </div>
        )}

        {/* Team Members List */}
        <div className="mt-6 space-y-element-gap">
          {members.length === 0 ? (
            <div className="rounded-lg border border-dashed border-surface-border p-8 text-center">
              <p className="text-body-md text-gray-500">No team members found.</p>
              <p className="mt-1 text-body-sm text-gray-400">
                Invite team members to start collaborating.
              </p>
            </div>
          ) : (
            members.map((member) => (
              <Card key={(member as TeamMember).id}>
                <div className="flex items-center justify-between gap-element-gap">
                  <div className="flex-1 min-w-0">
                    <p className="text-body-md font-medium text-gray-900 truncate">
                      {(member as TeamMember).user_id}
                    </p>
                    <p className="text-body-sm text-gray-500">
                      {formatRole((member as TeamMember).role)} · Joined {formatDate((member as TeamMember).created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-tight-gap flex-shrink-0">
                    <Button variant="secondary" size="sm">
                      Edit Role
                    </Button>
                    <Button variant="secondary" size="sm">
                      Remove
                    </Button>
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
