'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { AuthGuard } from './AuthGuard';
import { cn } from '../ui/cn';

interface AppShellProps {
  children: React.ReactNode;
  /**
   * Opt out of the default content padding. The inbox owns its own
   * 4-column grid and renders its own internal padding, so it
   * passes `noPadding` to keep the shell from adding gutters.
   */
  noPadding?: boolean;
}

export function AppShell({ children, noPadding = false }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  return (
    <div className="flex h-screen flex-col">
      <Topbar />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar — visible at xl (1280px) and above */}
        <div className="hidden xl:block">
          <Sidebar />
        </div>

        {/* Mobile overlay sidebar */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 xl:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <div className="relative z-50 h-full">
              <Sidebar />
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <button
            className={cn(
              'fixed top-3 left-3 z-30 rounded border border-[var(--m03-line)] bg-white p-2 shadow-sm transition-colors hover:bg-[var(--m03-line-2)]',
              'xl:hidden',
            )}
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="4.5" x2="15" y2="4.5" />
              <line x1="3" y1="9" x2="15" y2="9" />
              <line x1="3" y1="13.5" x2="15" y2="13.5" />
            </svg>
          </button>

          <main
            className={cn(
              'flex-1 overflow-auto bg-white',
              !noPadding && 'px-10 py-8',
            )}
          >
            <AuthGuard>{children}</AuthGuard>
          </main>
        </div>
      </div>
    </div>
  );
}
