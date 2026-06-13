'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { AuthGuard } from '@/components/layout/AuthGuard';
import { BrandMark } from './BrandMark';
import { cn } from '@/components/ui/cn';

interface DashboardShellProps {
  children: React.ReactNode;
  topbarCta?: React.ReactNode;
}

const sidebarSections: Array<{
  label: string;
  items: Array<{ href: string; label: string; icon?: string; badge?: string }>;
}> = [
  {
    label: 'Workspace',
    items: [
      { href: '/inbox', label: 'Inbox', icon: '▶', badge: '24' },
      { href: '/inbox?view=mentions', label: 'Mentions', icon: '★' },
      { href: '/inbox?view=snoozed', label: 'Snoozed', icon: '⏱' },
      { href: '/inbox?view=done', label: 'Done', icon: '✓' },
    ],
  },
  {
    label: 'Views',
    items: [
      { href: '/inbox?view=mine', label: 'Mine' },
      { href: '/inbox?view=unassigned', label: 'Unassigned' },
      { href: '/inbox?view=escalated', label: 'Escalated', badge: '3' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/knowledge', label: 'Knowledge' },
      { href: '/customers', label: 'Customers' },
      { href: '/analytics', label: 'Analytics' },
      { href: '/team', label: 'Team' },
      { href: '/settings', label: 'Settings' },
    ],
  },
];

function isActiveRoute(pathname: string, href: string): boolean {
  const [path] = href.split('?');
  if (path === '/inbox') return pathname.startsWith('/inbox');
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function DashboardShell({ children, topbarCta }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  const initials = user?.email?.[0]?.toUpperCase() ?? 'U';

  return (
    <div
      className="m03 flex min-h-screen flex-col bg-white text-[var(--m03-fg)]"
      style={{
        fontFamily: 'var(--font-inter), Inter, system-ui, -apple-system, sans-serif',
        fontFeatureSettings: "'cv02', 'cv03', 'cv04', 'cv11'",
      }}
    >
      {/* Top bar */}
      <header className="flex items-center gap-6 border-b border-[var(--m03-line)] bg-white px-6 h-14">
        <Link href="/" className="flex items-center gap-2 font-medium text-[14px] tracking-tight">
          <BrandMark size={16} className="text-[var(--m03-fg)]" />
          InboxPilot
        </Link>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {topbarCta ?? (
            <>
              <Link
                href="/knowledge"
                className="rounded px-3 py-1.5 text-[13px] font-medium text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)]"
              >
                Docs
              </Link>
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--m03-line-2)] text-[11px] font-medium text-[var(--m03-fg-2)]"
                title={user?.email ?? 'User'}
              >
                {initials}
              </div>
              <button
                onClick={handleSignOut}
                className="cursor-pointer rounded px-3 py-1.5 text-[13px] font-medium text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)]"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 items-stretch">
        {/* Sidebar */}
        <aside className="hidden md:flex w-[220px] shrink-0 flex-col border-r border-[var(--m03-line)] bg-white py-3.5 px-2 text-[13px]">
          {sidebarSections.map((section) => (
            <div key={section.label} className="mb-2">
              <div className="px-3 pt-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-3)]">
                {section.label}
              </div>
              {section.items.map((item) => {
                const active = isActiveRoute(pathname, item.href);
                return (
                  <Link
                    key={`${section.label}-${item.href}`}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded px-2.5 py-1.5',
                      active
                        ? 'bg-[var(--m03-fg)] text-[var(--m03-bg)]'
                        : 'text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)]',
                    )}
                  >
                    {item.icon && (
                      <span className={cn('w-3.5 text-[12px]', active ? 'text-[var(--m03-bg)]' : 'text-[var(--m03-fg-3)]')}>
                        {item.icon}
                      </span>
                    )}
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span
                        className={cn(
                          'text-[10px] font-mono',
                          active ? 'text-[var(--m03-bg)] opacity-70' : 'text-[var(--m03-fg-3)]',
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-auto bg-white px-10 py-8">
          <AuthGuard>{children}</AuthGuard>
        </main>
      </div>
    </div>
  );
}
