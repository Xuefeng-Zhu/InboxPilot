'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

// ---------------------------------------------------------------------------
// Topbar — M03 global topbar (logo · search · avatar)
// Matches design-mock-3.html lines 43-63
// ---------------------------------------------------------------------------

function getInitials(value: string | null | undefined): string {
  if (!value) return 'U';
  const trimmed = value.trim();
  if (!trimmed) return 'U';
  const parts = trimmed.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export interface TopbarNavItem {
  label: string;
  href: string;
}

interface TopbarProps {
  /** Optional nav links rendered between the brand and the search. */
  nav?: TopbarNavItem[];
}

export function Topbar({ nav }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!pathname.startsWith('/inbox')) {
      setSearch('');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get('q') ?? '');
  }, [pathname]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `/inbox?q=${encodeURIComponent(q)}` : '/inbox');
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b border-[var(--m03-line)] bg-white px-6">
      <Link
        href="/"
        className="flex items-center gap-2 text-[14px] font-medium tracking-[-0.02em] text-[var(--m03-fg)]"
      >
        <span className="text-[11px] leading-none" aria-hidden="true">
          ▲
        </span>
        InboxPilot
      </Link>

      {nav && nav.length > 0 && (
        <nav className="flex items-center gap-4" aria-label="Section nav">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[13px] text-[var(--m03-fg-2)] hover:text-[var(--m03-fg)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex-1" />

      <form
        role="search"
        onSubmit={handleSubmit}
        className="relative"
        aria-label="Global search"
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search messages, contacts…"
          className="h-8 w-[280px] rounded-md border border-transparent bg-[var(--m03-line-2)] px-3 text-[13px] text-[var(--m03-fg-2)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:bg-white focus:outline-none"
        />
      </form>

      <div
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--m03-fg)] text-[11px] font-semibold text-white"
        aria-label={user?.email ?? 'User avatar'}
      >
        {getInitials(user?.email)}
      </div>
    </header>
  );
}
