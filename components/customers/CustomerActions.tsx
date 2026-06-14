'use client';

import { useState } from 'react';

interface CustomerActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  customerName: string;
}

export function CustomerActions({ onEdit, onDelete, customerName }: CustomerActionsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`More actions for ${customerName}`}
        aria-expanded={open}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)]"
      >
        <svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor">
          <circle cx="7.5" cy="3" r="1.2" />
          <circle cx="7.5" cy="7.5" r="1.2" />
          <circle cx="7.5" cy="12" r="1.2" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-md border border-[var(--m03-line)] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
            <button
              type="button"
              onClick={() => { setOpen(false); onEdit(); }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 2.5l3 3M2 9l6.5-6.5 3 3L5 12H2V9z" />
              </svg>
              Edit
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onDelete(); }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--m03-red)] hover:bg-[var(--m03-line-2)]"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4v8a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4" />
                <line x1="6" y1="6.5" x2="6" y2="10.5" />
                <line x1="8" y1="6.5" x2="8" y2="10.5" />
              </svg>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
