'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { BrandMark } from '@/components/BrandMark';

// ---------------------------------------------------------------------------
// Topbar — M03 global topbar (logo · search · avatar menu)
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
  const { user, signOut } = useAuth();
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pathname.startsWith('/inbox')) {
      setSearch('');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get('q') ?? '');
  }, [pathname]);

  // Close the user menu on outside click + Escape.
  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `/inbox?q=${encodeURIComponent(q)}` : '/inbox');
  }

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    router.push('/login');
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--m03-line)] bg-white px-3 pl-14 sm:gap-6 sm:px-6 sm:pl-14 xl:pl-6">
      <Link
        href="/"
        className="flex items-center gap-2 text-[14px] font-medium tracking-[-0.02em] text-[var(--m03-fg)]"
      >
        <BrandMark size={26} className="text-[var(--m03-fg)]" />
        InboxPilot
      </Link>

      {nav && nav.length > 0 && (
        <nav className="hidden items-center gap-4 md:flex" aria-label="Section nav">
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
        className="relative hidden md:block"
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

      {user && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={user.email ?? 'Open user menu'}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--m03-fg)] text-[11px] font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--m03-fg)] focus-visible:ring-offset-2"
          >
            {getInitials(user.email)}
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label="User menu"
              className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-md border border-[var(--m03-line)] bg-white shadow-lg"
            >
              <div className="border-b border-[var(--m03-line)] px-3 py-2.5">
                <div className="truncate text-[12px] font-medium text-[var(--m03-fg)]">
                  {user.email}
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--m03-fg-2)] transition-colors hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)] focus:bg-[var(--m03-line-2)] focus:outline-none"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4.5 10H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h1.5" />
                  <polyline points="7,4 9.5,6 7,8" />
                  <line x1="9.5" y1="6" x2="4.5" y2="6" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
