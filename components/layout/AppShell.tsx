'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { cn } from '../ui/cn';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
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
    <div className="flex h-screen">
      {/* Desktop sidebar — visible at xl (1280px) and above */}
      <div className="hidden xl:block">
        <Sidebar />
      </div>

      {/* Mobile overlay sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 xl:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          {/* Slide-over sidebar */}
          <div className="relative z-50 h-full w-sidebar-w">
            <Sidebar />
          </div>
        </div>
      )}

      {/* Main content area */}
      <main className="flex-1 overflow-auto bg-surface-background">
        {/* Mobile hamburger button */}
        <button
          className={cn(
            'fixed top-3 left-3 z-30 p-2 rounded-md bg-white border border-surface-border shadow-sm cursor-pointer transition-colors duration-150 hover:bg-gray-50',
            'xl:hidden'
          )}
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="15" x2="17" y2="15" />
          </svg>
        </button>

        {children}
      </main>
    </div>
  );
}
