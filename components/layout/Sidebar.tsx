'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useQuery } from '@tanstack/react-query';
import { insforge } from '@/lib/insforge';
import { queryKeys, useOrgMembership } from '@/lib/queries';
import { cn } from '@/components/ui/cn';

// ---------------------------------------------------------------------------
// Sidebar — M03 monochrome (design-mock-3.html lines 73-93)
//
// Sections:
//   WORKSPACE  → Inbox, Escalated, Mine*, Unassigned*
//   CHANNELS   → SMS, Email, Webchat
//   MANAGE     → Knowledge, Customers, Analytics
//   footer     → user chip
//
// * Mine / Unassigned are dimmed with a "Coming soon" tooltip until the
//   `?assigned=` URL param is wired into app/inbox/page.tsx (tracked in
//   TODO(3.2): plumb `assigned_to` filter from sidebar URL params).
// ---------------------------------------------------------------------------

interface SectionLink {
  href: string;
  label: string;
  count?: number;
  countTone?: 'default' | 'escalated';
  icon: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  dividerBefore?: boolean;
}

interface Section {
  label?: string;
  links: SectionLink[];
  topRule?: boolean;
}

// 12px inline SVG icons at strokeWidth=1.5 — consistent with the rest of the app.
const Icon = {
  inbox: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="8" height="6" rx="1" />
      <polyline points="2,4.5 6,7 10,4.5" />
    </svg>
  ),
  bolt: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="7,1 2,7 6,7 5,11 10,5 6,5" />
    </svg>
  ),
  user: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="4.5" r="2" />
      <path d="M2 10.5c0-2 1.7-3.5 4-3.5s4 1.5 4 3.5" />
    </svg>
  ),
  userPlus: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="4" r="1.8" />
      <path d="M1.5 10.2c0-1.8 1.5-3.2 3.5-3.2s3.5 1.4 3.5 3.2" />
      <line x1="10" y1="4" x2="10" y2="7" />
      <line x1="8.5" y1="5.5" x2="11.5" y2="5.5" />
    </svg>
  ),
  sms: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="9" height="7" rx="1.5" />
      <line x1="3" y1="5" x2="9" y2="5" />
      <line x1="3" y1="7" x2="7" y2="7" />
    </svg>
  ),
  mail: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="9" height="7" rx="1" />
      <polyline points="1.5,3.5 6,7 10.5,3.5" />
    </svg>
  ),
  chat: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 4.5c0-1 .8-2 2-2h5c1.1 0 2 .9 2 2v3c0 1.1-.9 2-2 2H5l-2.5 2v-2H3.5c-1.1 0-2-.9-2-2v-3z" />
    </svg>
  ),
  book: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2.5h3.5a1.5 1.5 0 0 1 1.5 1.5v6a1 1 0 0 0-1-1H2z" />
      <path d="M10 2.5H6.5A1.5 1.5 0 0 0 5 4v6a1 1 0 0 1 1-1h4z" />
    </svg>
  ),
  chart: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
      <line x1="3.5" y1="8.5" x2="3.5" y2="6" />
      <line x1="6" y1="8.5" x2="6" y2="4" />
      <line x1="8.5" y1="8.5" x2="8.5" y2="5" />
    </svg>
  ),
  cog: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2" />
      <path d="M6 1.5v1.5M6 9v1.5M1.5 6h1.5M9 6h1.5M3 3l1 1M8 8l1 1M3 9l1-1M8 4l1-1" />
    </svg>
  ),
  wave: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 7c1 0 1-2 2-2s1 2 2 2 1-2 2-2 1 2 2 2 1-2 2-2" />
    </svg>
  ),
  kanban: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="3" height="3" rx="0.5" />
      <rect x="4.5" y="1" width="3" height="3" rx="0.5" />
      <rect x="8" y="1" width="3" height="3" rx="0.5" />
      <rect x="1" y="4.5" width="3" height="3" rx="0.5" />
      <rect x="4.5" y="4.5" width="3" height="3" rx="0.5" />
      <rect x="8" y="4.5" width="3" height="3" rx="0.5" />
      <rect x="1" y="8" width="3" height="3" rx="0.5" />
      <rect x="4.5" y="8" width="3" height="3" rx="0.5" />
      <rect x="8" y="8" width="3" height="3" rx="0.5" />
    </svg>
  ),
};

function NavRow({
  href,
  label,
  icon,
  isActive,
  count,
  countTone,
  disabled,
  disabledReason,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive?: boolean;
  count?: number;
  countTone?: 'default' | 'escalated';
  disabled?: boolean;
  disabledReason?: string;
  onClick?: () => void;
}) {
  const baseRow =
    'flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] transition-colors';
  const stateRow = disabled
    ? 'cursor-not-allowed text-[var(--m03-fg-3)] opacity-50'
    : isActive
      ? 'bg-[var(--m03-fg)] text-[var(--m03-bg)]'
      : 'text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)]';

  const iconWrap = cn(
    'flex h-3.5 w-3.5 shrink-0 items-center justify-center',
    disabled
      ? 'text-[var(--m03-fg-3)]'
      : isActive
        ? 'text-[var(--m03-bg)]'
        : 'text-[var(--m03-fg-3)]',
  );

  const inner = (
    <>
      <span className={iconWrap} aria-hidden="true">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span
          title={countTone === 'escalated' ? 'Escalated conversations' : 'Open conversations'}
          className={cn(
            'ml-auto rounded-full px-1.5 font-mono text-[10px] font-semibold',
            isActive
              ? 'bg-transparent text-[var(--m03-bg)] opacity-70'
              : countTone === 'escalated'
                ? 'bg-[var(--m03-red)] text-white'
                : 'bg-[var(--m03-fg)] text-[var(--m03-bg)]',
          )}
        >
          {count}
        </span>
      )}
    </>
  );

  if (disabled) {
    return (
      <div
        title={disabledReason}
        aria-disabled="true"
        className={cn(baseRow, stateRow)}
      >
        {inner}
      </div>
    );
  }

  return (
    <a href={href} onClick={onClick} className={cn(baseRow, stateRow)}>
      {inner}
    </a>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1.5 pt-3 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--m03-fg-3)]">
      {label}
    </div>
  );
}

// Counts query — best-effort; falls back to 0 for unknown orgs.
function useSidebarCounts(orgId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.conversationCounts(orgId ?? ''),
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return { inbox: 0, escalated: 0 };
      const { count: inbox } = await insforge.database
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .neq('status', 'resolved');
      const { count: escalated } = await insforge.database
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'escalated');
      return {
        inbox: inbox ?? 0,
        escalated: escalated ?? 0,
      };
    },
    staleTime: 30_000,
  });
}

function userInitial(email: string | undefined | null): string {
  if (!email) return '?';
  return email.trim().charAt(0).toUpperCase() || '?';
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  const { data: counts } = useSidebarCounts(orgId);

  const INBOX_FILTER_KEYS = ['view', 'assigned', 'status', 'channel'] as const;

  function hasActiveInboxFilter(): boolean {
    for (const k of INBOX_FILTER_KEYS) {
      if (searchParams.get(k)) return true;
    }
    return false;
  }

  function isLinkActive(href: string): boolean {
    const [path, query] = href.split('?');
    if (!path) return false;
    if (pathname !== path) return false;

    if (!query) {
      // Bare /inbox highlights only when no filter param is set.
      return !hasActiveInboxFilter();
    }

    const params = new URLSearchParams(query);
    for (const [k, v] of params) {
      if (searchParams.get(k) !== v) return false;
    }
    return true;
  }

  const workspaceSection: Section = {
    label: 'Workspace',
    links: [
      { href: '/inbox', label: 'Inbox', icon: Icon.inbox, count: counts?.inbox },
      {
        href: '/inbox?status=escalated',
        label: 'Escalated',
        icon: Icon.bolt,
        count: counts?.escalated,
        countTone: 'escalated',
      },
      {
        href: '/symphony',
        label: 'Symphony',
        icon: Icon.wave,
      },
      {
        href: '/inbox/kanban',
        label: 'Kanban',
        icon: Icon.kanban,
      },
      {
        href: '/inbox?assigned=me',
        label: 'Mine',
        icon: Icon.user,
        disabled: true,
        disabledReason: 'Coming soon — wire ?assigned= into the inbox page',
      },
      {
        href: '/inbox?assigned=none',
        label: 'Unassigned',
        icon: Icon.userPlus,
        disabled: true,
        disabledReason: 'Coming soon — wire ?assigned= into the inbox page',
      },
    ],
  };

  const channelsSection: Section = {
    label: 'Channels',
    topRule: true,
    links: [
      { href: '/inbox?channel=sms', label: 'SMS', icon: Icon.sms },
      { href: '/inbox?channel=email', label: 'Email', icon: Icon.mail },
      { href: '/inbox?channel=webchat', label: 'Webchat', icon: Icon.chat },
    ],
  };

  const manageSection: Section = {
    label: 'Manage',
    topRule: true,
    links: [
      { href: '/knowledge', label: 'Knowledge', icon: Icon.book },
      { href: '/customers', label: 'Customers', icon: Icon.user },
      { href: '/analytics', label: 'Analytics', icon: Icon.chart },
      { href: '/settings', label: 'Settings', icon: Icon.cog },
    ],
  };

  function renderSection(section: Section, key: string) {
    return (
      <div key={key}>
        {section.topRule && <div className="my-2 mx-2 border-t border-[var(--m03-line)]" />}
        {section.label && <SectionHeader label={section.label} />}
        <div className="flex flex-col gap-0.5">
          {section.links.map((l) => (
            <div key={`${key}-${l.href}-${l.label}`}>
              {l.dividerBefore && (
                <div className="mx-2 my-1 border-t border-[var(--m03-line)]" />
              )}
              <NavRow
                href={l.href}
                label={l.label}
                icon={l.icon}
                isActive={isLinkActive(l.href)}
                count={l.count}
                countTone={l.countTone}
                disabled={l.disabled}
                disabledReason={l.disabledReason}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-sidebar-w shrink-0 flex-col border-r border-[var(--m03-line)] bg-white py-3.5 px-2 text-[13px]">
      <div className="flex-1 overflow-y-auto">
        {renderSection(workspaceSection, 'ws')}
        {renderSection(channelsSection, 'ch')}
        {renderSection(manageSection, 'manage')}
      </div>

      <div className="border-t border-[var(--m03-line)] pt-2">
        <div className="mt-1 flex items-center gap-2 rounded px-2 py-2">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--m03-fg)] font-mono text-[11px] font-semibold text-[var(--m03-bg)]"
          >
            {userInitial(user?.email)}
          </span>
          <span className="truncate text-[12.5px] text-[var(--m03-fg-2)]">
            {user?.email ?? 'Signed in'}
          </span>
        </div>
      </div>
    </aside>
  );
}
