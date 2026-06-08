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
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
        aria-label={`More actions for ${customerName}`}
        aria-expanded={open}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
          <circle cx="7.5" cy="3" r="1.2" />
          <circle cx="7.5" cy="7.5" r="1.2" />
          <circle cx="7.5" cy="12" r="1.2" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-40 rounded border border-surface-border bg-white py-1 shadow-level-2">
            <button
              onClick={() => { setOpen(false); onEdit(); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-body-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 2.5l3 3M2 9l6.5-6.5 3 3L5 12H2V9z" />
              </svg>
              Edit
            </button>
            <button
              onClick={() => { setOpen(false); onDelete(); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-body-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
