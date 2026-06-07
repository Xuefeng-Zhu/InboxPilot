'use client';

import { usePathname } from 'next/navigation';
import { NavItem } from './NavItem';
import { useAuth } from '@/lib/auth-context';
import { Logo } from '@/components/ui/Logo';

const navRoutes = [
  {
    href: '/inbox',
    label: 'Inbox',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="14" height="12" rx="2" />
        <polyline points="3,6 10,11 17,6" />
      </svg>
    ),
  },
  {
    href: '/knowledge',
    label: 'Knowledge Base',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2h8l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
        <polyline points="12,2 12,6 16,6" />
        <line x1="6" y1="10" x2="14" y2="10" />
        <line x1="6" y1="13" x2="12" y2="13" />
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'Analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="16" x2="5" y2="10" />
        <line x1="10" y1="16" x2="10" y2="4" />
        <line x1="15" y1="16" x2="15" y2="8" />
      </svg>
    ),
  },
  {
    href: '/customers',
    label: 'Customers',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="3" />
        <path d="M2 17c0-3 2.5-5 5-5s5 2 5 5" />
        <circle cx="14" cy="6" r="2.5" />
        <path d="M14 11c2 0 4 1.5 4 4" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="3" />
        <path d="M10 2v2M10 16v2M4 4l1.5 1.5M14.5 14.5L16 16M2 10h2M16 10h2M4 16l1.5-1.5M14.5 5.5L16 4" />
      </svg>
    ),
  },
  {
    href: '/team',
    label: 'Team',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="6" r="3" />
        <path d="M4 18c0-3.5 2.5-6 6-6s6 2.5 6 6" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="4" cy="6" r="2" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  return (
    <aside className="flex flex-col h-full w-sidebar-w border-r border-surface-border bg-white">
      {/* Top: Logo + workspace name */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-surface-border">
        <Logo size="md" />
        <span className="text-headline-sm text-gray-900">InboxPilot</span>
      </div>

      {/* Middle: Navigation links */}
      <nav className="flex-1 overflow-y-auto py-2" aria-label="Main navigation">
        {navRoutes.map((route) => (
          <NavItem
            key={route.href}
            href={route.href}
            icon={route.icon}
            label={route.label}
            isActive={pathname.startsWith(route.href)}
          />
        ))}
      </nav>

      {/* Bottom: User avatar + sign-out */}
      <div className="border-t border-surface-border px-4 py-3 flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 text-gray-600 text-label-md">
          {user?.email?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm text-gray-900 truncate">
            {user?.email ?? 'User'}
          </p>
        </div>
        <button
          onClick={signOut}
          className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors duration-150"
          aria-label="Sign out"
          title="Sign out"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2" />
            <polyline points="10,5 14,9 10,13" />
            <line x1="14" y1="9" x2="7" y2="9" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
