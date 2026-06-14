'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  queryKeys,
  useCurrentMembership,
  useTeamMemberInfo,
  useTeamMembers,
} from '@/lib/queries';
import { Button, Card, Tooltip } from '@/components/ui';
import { EditRoleModal, type EditableMember } from './EditRoleModal';
import { InviteMemberModal } from './InviteMemberModal';
import { RemoveMemberModal, type RemovableMember } from './RemoveMemberModal';
import type { MemberRole } from '@support-core/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  updated_at: string;
}

interface MemberDisplayInfo {
  name: string | null;
  email: string | null;
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

/** Truncate a UUID-like user_id to a short, scannable form. */
function shortUserId(userId: string): string {
  if (userId.length <= 12) return userId;
  return `${userId.slice(0, 8)}…${userId.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Self-contained team panel — members list with Edit Role / Remove / Invite
 * actions. Reused in two places:
 *   - `app/team/page.tsx` (the /team page)
 *   - `app/settings/page.tsx` (the "Team" tab inside Settings)
 *
 * Modals are rendered as siblings of the Card so the overlay covers the full
 * viewport regardless of where the panel is mounted.
 */
export function TeamPanel() {
  const { data: members = [], isLoading, error } = useTeamMembers();
  const { data: memberInfo = [] } = useTeamMemberInfo();
  const { user } = useAuth();
  const { data: currentMembership } = useCurrentMembership(user?.id);
  const currentOrgId = currentMembership?.organizationId;
  const currentUserRole = currentMembership?.role;
  const queryClient = useQueryClient();

  // Map user_id → display info (name + email) for fast lookup at render time.
  const infoByUserId = useMemo(() => {
    const map = new Map<string, MemberDisplayInfo>();
    for (const info of memberInfo) {
      map.set(info.id, { name: info.name, email: info.email });
    }
    return map;
  }, [memberInfo]);

  const [editingMember, setEditingMember] = useState<EditableMember | null>(null);
  const [removingMember, setRemovingMember] = useState<RemovableMember | null>(null);
  const [invitingOpen, setInvitingOpen] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.teamMemberInfo(currentOrgId ?? '') });
  };

  const isSelf = (member: TeamMember) => member.user_id === user?.id;

  /**
   * Display label priority:
   *   1. name (from profile)
   *   2. email
   *   3. short user_id (last resort)
   */
  const displayLabel = (userId: string): string => {
    const info = infoByUserId.get(userId);
    if (info?.name && info.name.trim().length > 0) return info.name;
    if (info?.email && info.email.trim().length > 0) return info.email;
    return shortUserId(userId);
  };

  /**
   * Secondary line payload — what to render as the disambiguator under the
   * primary label. Returns null when there's nothing meaningful to show.
   */
  const secondaryLine = (userId: string): string | null => {
    const info = infoByUserId.get(userId);
    if (info?.name && info.name.trim().length > 0) {
      // Name is shown — display email (if any) as the disambiguator.
      return info.email ?? shortUserId(userId);
    }
    // No name to show — already showing email or shortId as the primary
    // label, so nothing to add.
    return null;
  };

  return (
    <>
      <Card
        header={
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m03-fg)]">
              Team
            </h2>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setInvitingOpen(true)}
            >
              Invite member
            </Button>
          </div>
        }
      >
        <p className="m-0 text-[13px] text-[var(--m03-fg-2)]">
          Manage members and their roles.
        </p>

        {isLoading ? (
          <p className="mt-4 text-[13px] text-[var(--m03-fg-2)]">Loading team members…</p>
        ) : error ? (
          <div
            className="mt-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]"
            role="alert"
          >
            {error.message}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {members.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--m03-line)] p-8 text-center">
                <p className="text-[13px] text-[var(--m03-fg-2)]">No team members found.</p>
                <p className="mt-1 text-[12px] text-[var(--m03-fg-3)]">
                  Add a teammate by email to get started.
                </p>
              </div>
            ) : (
              members.map((member) => {
                const m = member as TeamMember;
                const info = infoByUserId.get(m.user_id);
                const removeButton = (
                  <button
                    type="button"
                    disabled={isSelf(m)}
                    onClick={() => {
                      if (!isSelf(m)) {
                        setRemovingMember({
                          id: m.id,
                          user_id: m.user_id,
                          name: info?.name ?? null,
                          email: info?.email ?? null,
                        });
                      }
                    }}
                    className="rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] font-medium text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                );

                return (
                  <Card key={m.id}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-[14px] font-medium text-[var(--m03-fg)]"
                          title={m.user_id}
                        >
                          {displayLabel(m.user_id)}
                        </p>
                        <p className="truncate text-[12px] text-[var(--m03-fg-2)]">
                          {formatRole(m.role)} · Joined {formatDate(m.created_at)}
                          {secondaryLine(m.user_id) && (
                            <>
                              {' · '}
                              <span className="text-[var(--m03-fg-3)]">
                                {secondaryLine(m.user_id)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingMember({
                              id: m.id,
                              user_id: m.user_id,
                              name: info?.name ?? null,
                              email: info?.email ?? null,
                              role: m.role,
                            })
                          }
                          className="rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] font-medium text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]"
                        >
                          Edit Role
                        </button>
                        {isSelf(m) ? (
                          <Tooltip content="You cannot remove yourself">
                            {removeButton}
                          </Tooltip>
                        ) : (
                          removeButton
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        )}
      </Card>

      {editingMember && currentOrgId && currentUserRole && (
        <EditRoleModal
          member={editingMember}
          orgId={currentOrgId}
          currentUserRole={currentUserRole}
          onClose={() => setEditingMember(null)}
          onSaved={() => {
            setEditingMember(null);
            invalidate();
          }}
        />
      )}

      {removingMember && currentOrgId && (
        <RemoveMemberModal
          member={removingMember}
          orgId={currentOrgId}
          onClose={() => setRemovingMember(null)}
          onRemoved={() => {
            setRemovingMember(null);
            invalidate();
          }}
        />
      )}

      {invitingOpen && currentOrgId && (
        <InviteMemberModal
          orgId={currentOrgId}
          onClose={() => setInvitingOpen(false)}
          onInvited={() => {
            setInvitingOpen(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}
