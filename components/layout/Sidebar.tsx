'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useQuery } from '@tanstack/react-query';
import { insforge } from '@/lib/insforge';
import { queryKeys, useOrgMembership } from '@/lib/queries';
import { cn } from '@/components/ui/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { SidebarCollapseToggle } from './SidebarCollapseToggle';

// ---------------------------------------------------------------------------
// Sidebar — M03 monochrome (design-mock-3.html lines 73-93)
//
// Sections:
//   WORKSPACE  → Inbox, Escalated, Symphony, Kanban
//   CHANNELS   → SMS, Email, Webchat
//   MANAGE     → Knowledge, Customers, Analytics, Settings
//   footer     → user chip
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
  collapsed = false,
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
  collapsed?: boolean;
}) {
  const baseRow = cn(
    'flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] transition-colors min-h-[32px]',
    collapsed && 'justify-center',
  );
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
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && typeof count === 'number' && count > 0 && (
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

  const link = (
    <a href={href} onClick={onClick} className={cn(baseRow, stateRow)}>
      {inner}
    </a>
  );

  if (collapsed) {
    return (
      <Tooltip content={label} side="right">
        {link}
      </Tooltip>
    );
  }

  return link;
}

function SectionHeader({ label, collapsed = false }: { label: string; collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="px-3 pb-1 pt-2">
        <div className="mx-auto h-px w-6 bg-[var(--m03-line)]" />
      </div>
    );
  }
  return (
    <div className="px-3 pb-1 pt-2 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--m03-fg-3)]">
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

// ---------------------------------------------------------------------------
// Sidebar content (module-level) — shared by Body and Fallback
// ---------------------------------------------------------------------------
// Extracted to avoid duplicating nav data and the user chip in both the
// `useSearchParams`-driven body and the static Suspense fallback.

const WORKSPACE_LINKS: SectionLink[] = [
  { href: '/inbox', label: 'Inbox', icon: Icon.inbox },
  {
    href: '/inbox?status=escalated',
    label: 'Escalated',
    icon: Icon.bolt,
    countTone: 'escalated',
  },
  { href: '/symphony', label: 'Symphony', icon: Icon.wave },
  { href: '/inbox/kanban', label: 'Kanban', icon: Icon.kanban },
];

const CHANNELS_LINKS: SectionLink[] = [
  { href: '/inbox?channel=sms', label: 'SMS', icon: Icon.sms },
  { href: '/inbox?channel=email', label: 'Email', icon: Icon.mail },
  { href: '/inbox?channel=webchat', label: 'Webchat', icon: Icon.chat },
];

const MANAGE_LINKS: SectionLink[] = [
  { href: '/knowledge', label: 'Knowledge', icon: Icon.book },
  { href: '/customers', label: 'Customers', icon: Icon.user },
  { href: '/analytics', label: 'Analytics', icon: Icon.chart },
  { href: '/settings', label: 'Settings', icon: Icon.cog },
];

function UserChip({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  return (
    <div className="border-t border-[var(--m03-line)] pt-2">
      <div className="mt-1 flex items-center gap-2 rounded px-2 py-2">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--m03-fg)] font-mono text-[11px] font-semibold text-[var(--m03-bg)]"
        >
          {userInitial(user?.email)}
        </span>
        <span
          className={cn(
            'truncate text-[12.5px] text-[var(--m03-fg-2)]',
            collapsed && 'invisible w-0 overflow-hidden',
          )}
        >
          {user?.email ?? 'Signed in'}
        </span>
      </div>
    </div>
  );
}

function renderSection(
  section: Section,
  key: string,
  isLinkActive: (href: string) => boolean,
  collapsed: boolean = false,
) {
  return (
    <div key={key}>
      {section.topRule && (
        collapsed ? (
          <div className="mx-auto my-2 h-px w-6 bg-[var(--m03-line)]" />
        ) : (
          <div className="my-2 mx-2 border-t border-[var(--m03-line)]" />
        )
      )}
      {section.label && <SectionHeader label={section.label} collapsed={collapsed} />}
      <div className="flex flex-col gap-0.5">
        {section.links.map((l) => (
          <div key={`${key}-${l.href}-${l.label}`} className="w-full">
            {l.dividerBefore && (
              collapsed ? (
                <div className="mx-auto my-1 h-px w-6 bg-[var(--m03-line)]" />
              ) : (
                <div className="mx-2 my-1 border-t border-[var(--m03-line)]" />
              )
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
              collapsed={collapsed}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// Internal — the part of Sidebar that calls `useSearchParams`. Next.js 16
// requires `useSearchParams` consumers to be wrapped in a `<Suspense>`
// boundary, otherwise static prerendering of any page that renders Sidebar
// (e.g. /analytics) bails out and the production build fails.
function SidebarBody({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
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

  // Apply counts to the workspace links (the only section that uses them).
  const workspaceLinks: SectionLink[] = WORKSPACE_LINKS.map((l) => {
    if (l.href === '/inbox') return { ...l, count: counts?.inbox };
    if (l.href === '/inbox?status=escalated') return { ...l, count: counts?.escalated };
    return l;
  });

  const sections: Section[] = [
    { label: 'Workspace', links: workspaceLinks },
    { label: 'Channels', links: CHANNELS_LINKS },
    { label: 'Manage', topRule: true, links: MANAGE_LINKS },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {sections.map((s, i) => renderSection(s, String(i), isLinkActive, collapsed))}
      </div>
      {onToggle && (
        <div className="mt-auto border-t border-[var(--m03-line)] pt-1.5">
          <SidebarCollapseToggle collapsed={collapsed} onToggle={onToggle} />
        </div>
      )}
      <UserChip collapsed={collapsed} />
    </div>
  );
}

// Suspense fallback — same shell, no active highlighting, no counts. Shown
// during prerender or while the client is hydrating; the real SidebarBody
// swaps in immediately after.
function SidebarFallback({ collapsed = false }: { collapsed?: boolean }) {
  const sections: Section[] = [
    { label: 'Workspace', links: WORKSPACE_LINKS },
    { label: 'Channels', links: CHANNELS_LINKS },
    { label: 'Manage', topRule: true, links: MANAGE_LINKS },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {sections.map((s, i) => renderSection(s, String(i), () => false, collapsed))}
      </div>
      <UserChip collapsed={collapsed} />
    </div>
  );
}

export function Sidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  return (
    <aside
      id="primary-sidebar"
      aria-label="Primary navigation"
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-[var(--m03-line)] bg-white py-3.5 text-[13px] transition-none',
        collapsed ? 'w-sidebar-collapsed-w px-1.5' : 'w-sidebar-w px-2',
      )}
    >
      <Suspense fallback={<SidebarFallback collapsed={collapsed} />}>
        <SidebarBody collapsed={collapsed} onToggle={onToggle} />
      </Suspense>
    </aside>
  );
}
